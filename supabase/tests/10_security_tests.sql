-- ============================================================================
-- Khuruj — functional tests for the security-critical rules
-- ----------------------------------------------------------------------------
-- Run against a plain Postgres after 00_harness.sql and the three migrations.
-- Records a pass/fail row per check, then prints a summary and raises an
-- exception if anything failed (so the runner exits non-zero).
--
-- The RPCs are SECURITY DEFINER owned by the superuser, so calling them from a
-- restricted role exercises exactly the server-side checks that guard the real
-- API. RLS is tested by querying tables directly as `authenticated`.
-- ============================================================================

drop table if exists public.test_results;
create table public.test_results (
  id       serial primary key,
  name     text,
  expected text,
  actual   text,
  passed   boolean
);

-- Record a result from anywhere.
create or replace function public.test_record(
  p_name text, p_expected text, p_actual text, p_passed boolean
) returns void language sql as $$
  insert into public.test_results (name, expected, actual, passed)
  values (p_name, p_expected, p_actual, p_passed);
$$;

-- Expect a specific error code from a statement executed in a subtransaction.
create or replace function public.test_expect_error(
  p_name text, p_code text, p_sql text
) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.test_record(p_name, p_code, 'no error raised', false);
  exception when others then
    perform public.test_record(
      p_name, p_code, sqlerrm, position(p_code in sqlerrm) > 0);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
truncate public.audit_log, public.gate_events, public.student_campus_status,
         public.pass_requests, public.user_roles, public.profiles,
         public.students, auth.users restart identity cascade;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'student@uni.edu',    '{"full_name":"Student One"}'),
  ('22222222-2222-2222-2222-222222222222', 'mentor@uni.edu',     '{"full_name":"Mentor"}'),
  ('33333333-3333-3333-3333-333333333333', 'classteacher@uni.edu','{"full_name":"Class Teacher"}'),
  ('44444444-4444-4444-4444-444444444444', 'medical@uni.edu',    '{"full_name":"Medical Approver"}'),
  ('55555555-5555-5555-5555-555555555555', 'duty@uni.edu',       '{"full_name":"Duty Teacher"}'),
  ('66666666-6666-6666-6666-666666666666', 'gate@uni.edu',       '{"full_name":"Gate Security"}'),
  ('77777777-7777-7777-7777-777777777777', 'admin@uni.edu',      '{"full_name":"Administrator"}'),
  ('88888888-8888-8888-8888-888888888888', 'student2@uni.edu',   '{"full_name":"Student Two"}');

-- The auth trigger already inserted a student role for everyone; add the rest.
insert into public.user_roles (user_id, role) values
  ('22222222-2222-2222-2222-222222222222', 'mentor'),
  ('33333333-3333-3333-3333-333333333333', 'class_teacher'),
  ('44444444-4444-4444-4444-444444444444', 'medical_approver'),
  ('55555555-5555-5555-5555-555555555555', 'duty_teacher'),
  ('66666666-6666-6666-6666-666666666666', 'gate_security'),
  ('77777777-7777-7777-7777-777777777777', 'admin');

insert into public.students (admission_number, full_name, department, user_id) values
  ('2023CS1001', 'Student One', 'Computer Science', '11111111-1111-1111-1111-111111111111'),
  ('2023CS1002', 'Student Two', 'Computer Science', '88888888-8888-8888-8888-888888888888');

-- The cascading truncate above also empties approval_rules (it references
-- auth.users). Restore the routing table the migration seeded.
insert into public.approval_rules (request_type, approver_role, is_active) values
  ('going_home',      'class_teacher',    true),
  ('afternoon_out',   'mentor',           true),
  ('medical',         'medical_approver', true),
  ('thursday_friday', 'duty_teacher',     true)
on conflict (request_type) do update
  set approver_role = excluded.approver_role, is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- 1. RLS: clients cannot write protected tables directly
-- ---------------------------------------------------------------------------
set role authenticated;
select public.test_set_user('11111111-1111-1111-1111-111111111111');

select public.test_expect_error(
  'RLS blocks direct pass_requests insert', 'row-level security',
  $$insert into public.pass_requests
      (admission_number, request_type, purpose, requested_departure,
       requested_return, valid_from, valid_until)
    values ('2023CS1001','going_home','direct write', now(),
            now() + interval '2 hours', now(), now() + interval '2 hours')$$);

select public.test_expect_error(
  'RLS blocks direct gate_events insert', 'row-level security',
  $$insert into public.gate_events (admission_number, event_type, gate_user_id)
    values ('2023CS1001','gate_out','66666666-6666-6666-6666-666666666666')$$);

select public.test_expect_error(
  'RLS blocks direct audit_log insert', 'row-level security',
  $$insert into public.audit_log (action, entity_type) values ('forged','test')$$);

select public.test_expect_error(
  'RLS blocks direct campus_status insert', 'row-level security',
  $$insert into public.student_campus_status (admission_number, status)
    values ('2023CS1001','outside')$$);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.pass_requests;
  perform public.test_record(
    'Student sees no passes before submitting', '0', v_count::text, v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Submission validation
-- ---------------------------------------------------------------------------
do $$
declare v_row public.pass_requests;
begin
  v_row := public.submit_pass_request(
    'going_home', 'Family visit',
    now() + interval '10 minutes', now() + interval '5 hours',
    'Home', null, now() - interval '5 minutes', now() + interval '6 hours');
  perform public.test_record('Student submits a request', 'pending',
    v_row.approval_status::text, v_row.approval_status = 'pending');
  perform set_config('test.p1', v_row.id::text, false);
end $$;

select public.test_expect_error('Empty purpose rejected', 'PURPOSE_REQUIRED',
  $$select public.submit_pass_request('going_home','   ',
      now() + interval '1 hour', now() + interval '2 hours')$$);

select public.test_expect_error('Return before departure rejected', 'INVALID_WINDOW',
  $$select public.submit_pass_request('going_home','x',
      now() + interval '3 hours', now() + interval '1 hour')$$);

select public.test_expect_error('Medical trip without reason rejected', 'REASON_REQUIRED',
  $$select public.submit_pass_request('medical','Hospital visit',
      now() + interval '1 hour', now() + interval '2 hours')$$);

-- ---------------------------------------------------------------------------
-- 3. Approval scope is enforced server-side
-- ---------------------------------------------------------------------------
-- Regression: with no active rule for a type, app.can_decide must fail closed.
-- Before the fix it returned NULL, `if not NULL` was NULL, and the guard was
-- skipped — so any authenticated user could approve. This is checked while the
-- request is still pending, before any legitimate decision.
reset role;
update public.approval_rules set is_active = false where request_type = 'going_home';
set role authenticated;

select public.test_set_user('22222222-2222-2222-2222-222222222222');
select public.test_expect_error(
  'No active rule => nobody can approve (fail closed)', 'FORBIDDEN',
  $$select public.approve_pass_request(current_setting('test.p1')::uuid, null)$$);

reset role;
update public.approval_rules set is_active = true where request_type = 'going_home';
set role authenticated;

-- Mentor tries to decide a going_home request (owned by class_teacher).
select public.test_set_user('22222222-2222-2222-2222-222222222222');
select public.test_expect_error('Wrong approver (mentor) blocked', 'FORBIDDEN',
  $$select public.approve_pass_request(current_setting('test.p1')::uuid, null)$$);

-- The student cannot approve their own request.
select public.test_set_user('11111111-1111-1111-1111-111111111111');
select public.test_expect_error('Self-approval blocked', 'FORBIDDEN',
  $$select public.approve_pass_request(current_setting('test.p1')::uuid, null)$$);

-- Gate security cannot approve.
select public.test_set_user('66666666-6666-6666-6666-666666666666');
select public.test_expect_error('Gate security cannot approve', 'FORBIDDEN',
  $$select public.approve_pass_request(current_setting('test.p1')::uuid, null)$$);

-- The owning role succeeds.
select public.test_set_user('33333333-3333-3333-3333-333333333333');
do $$
declare v_row public.pass_requests;
begin
  v_row := public.approve_pass_request(current_setting('test.p1')::uuid, 'Approved');
  perform public.test_record('Class teacher approves going_home', 'approved',
    v_row.approval_status::text,
    v_row.approval_status = 'approved' and v_row.approver_role = 'class_teacher');
end $$;

-- Deciding twice is rejected.
select public.test_expect_error('Double decision blocked', 'ALREADY_DECIDED',
  $$select public.approve_pass_request(current_setting('test.p1')::uuid, null)$$);

-- Rejection requires remarks: submit + reject a second request.
select public.test_set_user('11111111-1111-1111-1111-111111111111');
do $$
declare v_row public.pass_requests;
begin
  v_row := public.submit_pass_request(
    'going_home','Second request',
    now() + interval '20 minutes', now() + interval '4 hours');
  perform set_config('test.p2', v_row.id::text, false);
end $$;
select public.test_set_user('33333333-3333-3333-3333-333333333333');
select public.test_expect_error('Reject without remarks blocked', 'REMARKS_REQUIRED',
  $$select public.reject_pass_request(current_setting('test.p2')::uuid, '')$$);

do $$
declare v_row public.pass_requests;
begin
  v_row := public.reject_pass_request(current_setting('test.p2')::uuid, 'Not this week');
  perform public.test_record('Reject with remarks succeeds', 'rejected',
    v_row.approval_status::text, v_row.approval_status = 'rejected');
end $$;

-- Approval must NOT have changed physical campus status.
reset role;
do $$
declare v_status text;
begin
  select status::text into v_status from public.student_campus_status
   where admission_number = '2023CS1001';
  perform public.test_record('Approval does not mark student outside',
    'on_campus or no row', coalesce(v_status, '(no row)'),
    v_status is null or v_status = 'on_campus');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Gate workflow
-- ---------------------------------------------------------------------------
set role authenticated;
select public.test_set_user('66666666-6666-6666-6666-666666666666');

do $$
declare v jsonb;
begin
  v := public.gate_lookup('2023CS1001');
  perform public.test_record('Gate lookup finds the student',
    'Student One', v->'student'->>'full_name',
    v->'student'->>'full_name' = 'Student One');
  perform public.test_record('Gate lookup reports pass as valid now',
    'true', (v->>'pass_is_valid'), (v->>'pass_is_valid') = 'true');
  perform public.test_record('Gate lookup reports on_campus',
    'on_campus', (v->>'campus_status'), (v->>'campus_status') = 'on_campus');
end $$;

do $$
declare v jsonb;
begin
  v := public.record_gate_out(current_setting('test.p1')::uuid, 'Leaving');
  perform public.test_record('Gate-Out recorded', 'gate_out',
    v->>'event_type', v->>'event_type' = 'gate_out');
end $$;

-- Duplicate exit is refused.
select public.test_expect_error('Duplicate Gate-Out blocked', 'ALREADY_OUTSIDE',
  $$select public.record_gate_out(current_setting('test.p1')::uuid, null)$$);

do $$
declare v jsonb;
begin
  v := public.gate_lookup('2023CS1001');
  perform public.test_record('Lookup shows student outside after Gate-Out',
    'outside', (v->>'campus_status'), (v->>'campus_status') = 'outside');
end $$;

-- Return.
do $$
declare v jsonb;
begin
  v := public.record_gate_in('2023CS1001', 'Returned');
  perform public.test_record('Gate-In recorded', 'gate_in',
    v->>'event_type', v->>'event_type' = 'gate_in');
end $$;

select public.test_expect_error('Gate-In without an open exit blocked', 'NOT_OUTSIDE',
  $$select public.record_gate_in('2023CS1001', null)$$);

-- A student cannot perform gate actions.
select public.test_set_user('11111111-1111-1111-1111-111111111111');
select public.test_expect_error('Student cannot Gate-Out', 'FORBIDDEN',
  $$select public.record_gate_out(current_setting('test.p1')::uuid, null)$$);
select public.test_expect_error('Student cannot Gate-In', 'FORBIDDEN',
  $$select public.record_gate_in('2023CS1001', null)$$);
select public.test_expect_error('Student cannot use gate lookup', 'FORBIDDEN',
  $$select public.gate_lookup('2023CS1001')$$);

-- ---------------------------------------------------------------------------
-- 5. Expiry and validity windows (fixtures inserted as owner)
-- ---------------------------------------------------------------------------
reset role;
-- P3: expired but approved.
insert into public.pass_requests
  (admission_number, student_user_id, request_type, purpose, requested_departure,
   requested_return, valid_from, valid_until, approval_status, approver_role, decided_at)
values
  ('2023CS1001','11111111-1111-1111-1111-111111111111','going_home','Expired pass',
   now() - interval '4 hours', now() - interval '2 hours',
   now() - interval '4 hours', now() - interval '2 hours',
   'approved','class_teacher', now())
returning id::text as id \gset
select set_config('test.p3', :'id', false);

-- P4: approved but not yet valid.
insert into public.pass_requests
  (admission_number, student_user_id, request_type, purpose, requested_departure,
   requested_return, valid_from, valid_until, approval_status, approver_role, decided_at)
values
  ('2023CS1001','11111111-1111-1111-1111-111111111111','going_home','Future pass',
   now() + interval '2 hours', now() + interval '4 hours',
   now() + interval '2 hours', now() + interval '4 hours',
   'approved','class_teacher', now())
returning id::text as id \gset
select set_config('test.p4', :'id', false);

-- P5: still pending.
insert into public.pass_requests
  (admission_number, student_user_id, request_type, purpose, requested_departure,
   requested_return, valid_from, valid_until, approval_status)
values
  ('2023CS1001','11111111-1111-1111-1111-111111111111','going_home','Pending pass',
   now() + interval '1 hour', now() + interval '3 hours',
   now() + interval '1 hour', now() + interval '3 hours', 'pending')
returning id::text as id \gset
select set_config('test.p5', :'id', false);

set role authenticated;
select public.test_set_user('66666666-6666-6666-6666-666666666666');

select public.test_expect_error('Expired pass cannot authorize Gate-Out', 'PASS_EXPIRED',
  $$select public.record_gate_out(current_setting('test.p3')::uuid, null)$$);

select public.test_expect_error('Not-yet-valid pass cannot authorize Gate-Out',
  'PASS_NOT_YET_VALID',
  $$select public.record_gate_out(current_setting('test.p4')::uuid, null)$$);

select public.test_expect_error('Unapproved pass cannot authorize Gate-Out',
  'PASS_NOT_APPROVED',
  $$select public.record_gate_out(current_setting('test.p5')::uuid, null)$$);

-- Simulate the student leaving on the (now expired) P3, then returning.
reset role;
insert into public.gate_events
  (admission_number, pass_request_id, event_type, gate_user_id, occurred_at, is_open_exit)
values
  ('2023CS1001', current_setting('test.p3')::uuid, 'gate_out',
   '66666666-6666-6666-6666-666666666666', now() - interval '3 hours', true);
update public.student_campus_status
   set status = 'outside', active_pass_id = current_setting('test.p3')::uuid,
       since = now() - interval '3 hours'
 where admission_number = '2023CS1001';

set role authenticated;
select public.test_set_user('66666666-6666-6666-6666-666666666666');
do $$
declare v jsonb;
begin
  v := public.record_gate_in('2023CS1001', 'Returned late');
  perform public.test_record('Gate-In works after pass expiry', 'gate_in',
    v->>'event_type', v->>'event_type' = 'gate_in');
end $$;

-- Unknown admission number.
select public.test_expect_error('Unknown barcode rejected', 'STUDENT_NOT_FOUND',
  $$select public.gate_lookup('NOPE-0000')$$);

-- ---------------------------------------------------------------------------
-- 6. Admin role management
-- ---------------------------------------------------------------------------
select public.test_set_user('22222222-2222-2222-2222-222222222222');
select public.test_expect_error('Non-admin cannot grant roles', 'FORBIDDEN',
  $$select public.admin_set_user_role('88888888-8888-8888-8888-888888888888','admin')$$);

select public.test_set_user('77777777-7777-7777-7777-777777777777');
select public.test_expect_error('Cannot revoke the last admin', 'LAST_ADMIN',
  $$select public.admin_revoke_user_role('77777777-7777-7777-7777-777777777777','admin')$$);

do $$
declare v_ok boolean;
begin
  perform public.admin_set_user_role('88888888-8888-8888-8888-888888888888','mentor');
  select exists (select 1 from public.user_roles
    where user_id = '88888888-8888-8888-8888-888888888888' and role = 'mentor')
    into v_ok;
  perform public.test_record('Admin grants a role', 'true', v_ok::text, v_ok);

  perform public.admin_revoke_user_role('88888888-8888-8888-8888-888888888888','mentor');
  select exists (select 1 from public.user_roles
    where user_id = '88888888-8888-8888-8888-888888888888' and role = 'mentor')
    into v_ok;
  perform public.test_record('Admin revokes a role', 'false', v_ok::text, not v_ok);

  -- Regression: the approval_rules audit trigger used to raise
  -- "record new has no field key" on every write, breaking rule management.
  perform public.admin_set_approval_rule('afternoon_out', 'duty_teacher', true);
  select (approver_role = 'duty_teacher')
    into v_ok from public.approval_rules where request_type = 'afternoon_out';
  perform public.test_record('Admin can change an approval rule', 'true',
    coalesce(v_ok::text, 'no row'), coalesce(v_ok, false));
  perform public.admin_set_approval_rule('afternoon_out', 'mentor', true);
end $$;

-- A student cannot read the audit log.
select public.test_set_user('11111111-1111-1111-1111-111111111111');
do $$
declare v_count int;
begin
  select count(*) into v_count from public.audit_log;
  perform public.test_record('Student cannot read the audit log', '0',
    v_count::text, v_count = 0);
end $$;

-- The admin can, and the log captured the workflow.
select public.test_set_user('77777777-7777-7777-7777-777777777777');
do $$
declare v_approved int; v_gate_out int; v_gate_in int;
begin
  select count(*) into v_approved from public.audit_log where action = 'pass_request_approved';
  select count(*) into v_gate_out from public.audit_log where action = 'gate_out';
  select count(*) into v_gate_in   from public.audit_log where action = 'gate_in';
  perform public.test_record('Audit log records approvals', '>=1', v_approved::text, v_approved >= 1);
  perform public.test_record('Audit log records Gate-Out', '>=2', v_gate_out::text, v_gate_out >= 2);
  perform public.test_record('Audit log records Gate-In', '>=1', v_gate_in::text, v_gate_in >= 1);
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
\echo ''
\echo '================= Khuruj test results ================='
select lpad(id::text, 3) as "#",
       case when passed then 'PASS' else 'FAIL' end as result,
       name, expected, left(actual, 48) as actual
  from public.test_results order by id;

\echo ''
select count(*) as total,
       count(*) filter (where passed) as passed,
       count(*) filter (where not passed) as failed
  from public.test_results;

do $$
declare v_failed int;
begin
  select count(*) into v_failed from public.test_results where not passed;
  if v_failed > 0 then
    raise exception 'KHURUJ TESTS FAILED: % check(s) did not pass', v_failed;
  end if;
end $$;
