-- ============================================================================
-- Khuruj (خروج) — 0002 privileged RPCs (server-enforced state transitions)
-- ----------------------------------------------------------------------------
-- Every sensitive change (submit, approve, reject, cancel, gate-out, gate-in,
-- role management) happens here. Each function:
--   * verifies the caller with auth.uid();
--   * re-reads the caller's roles from public.user_roles (never the client);
--   * locks the affected row (FOR UPDATE) so concurrent scans cannot race;
--   * writes an audit row.
-- Clients are never granted direct INSERT/UPDATE on pass_requests or
-- gate_events, so a forged request body cannot bypass these checks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Student: submit a pass request
-- ---------------------------------------------------------------------------
create or replace function public.submit_pass_request(
  p_request_type        public.request_type,
  p_purpose             text,
  p_requested_departure timestamptz,
  p_requested_return    timestamptz,
  p_destination         text default null,
  p_reason              text default null,
  p_valid_from          timestamptz default null,
  p_valid_until         timestamptz default null
) returns public.pass_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_adm   text := app.current_admission_number();
  v_from  timestamptz := coalesce(p_valid_from, p_requested_departure);
  v_until timestamptz := coalesce(p_valid_until, p_requested_return);
  v_row   public.pass_requests;
  v_dow   int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_adm is null then
    raise exception 'ACCOUNT_NOT_LINKED' using errcode = 'P0001';
  end if;
  if p_purpose is null or length(btrim(p_purpose)) = 0 then
    raise exception 'PURPOSE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_requested_departure is null or p_requested_return is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if v_until <= v_from or p_requested_return <= p_requested_departure then
    raise exception 'INVALID_WINDOW' using errcode = 'P0001';
  end if;

  -- Thursday/Friday permissions must actually fall on a Thursday or Friday.
  if p_request_type = 'thursday_friday' then
    v_dow := extract(dow from (p_requested_departure at time zone app.campus_timezone()))::int;
    if v_dow not in (4, 5) then
      raise exception 'INVALID_DAY' using errcode = 'P0001';
    end if;
  end if;

  if p_request_type = 'medical'
     and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pass_requests (
    admission_number, student_user_id, request_type, purpose, destination, reason,
    requested_departure, requested_return, valid_from, valid_until, approval_status
  ) values (
    v_adm, v_uid, p_request_type, btrim(p_purpose),
    nullif(btrim(coalesce(p_destination, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_requested_departure, p_requested_return, v_from, v_until, 'pending'
  )
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Student: cancel own pending request
-- ---------------------------------------------------------------------------
create or replace function public.cancel_pass_request(p_request_id uuid)
returns public.pass_requests
language plpgsql security definer set search_path = ''
as $$
declare v_row public.pass_requests;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row from public.pass_requests where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.student_user_id is distinct from auth.uid() and not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_row.approval_status <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  update public.pass_requests
     set approval_status = 'cancelled',
         decided_at = now(),
         remarks = coalesce(remarks, 'Cancelled by student')
   where id = p_request_id
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Approver: approve
-- ---------------------------------------------------------------------------
create or replace function public.approve_pass_request(
  p_request_id uuid, p_remarks text default null
) returns public.pass_requests
language plpgsql security definer set search_path = ''
as $$
declare v_row public.pass_requests;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row from public.pass_requests where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.approval_status <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  -- Server-side scope check: only the configured approver role (or admin).
  if not app.can_decide(v_row.request_type) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Nobody approves their own request.
  if v_row.student_user_id = auth.uid() then
    raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.pass_requests
     set approval_status = 'approved',
         approver_id   = auth.uid(),
         approver_role = app.required_approver(v_row.request_type),
         decided_at    = now(),
         remarks       = nullif(btrim(coalesce(p_remarks, '')), '')
   where id = p_request_id
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Approver: reject
-- ---------------------------------------------------------------------------
create or replace function public.reject_pass_request(
  p_request_id uuid, p_remarks text default null
) returns public.pass_requests
language plpgsql security definer set search_path = ''
as $$
declare v_row public.pass_requests;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row from public.pass_requests where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.approval_status <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  if not app.can_decide(v_row.request_type) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_remarks is null or length(btrim(p_remarks)) = 0 then
    raise exception 'REMARKS_REQUIRED' using errcode = 'P0001';
  end if;

  update public.pass_requests
     set approval_status = 'rejected',
         approver_id   = auth.uid(),
         approver_role = app.required_approver(v_row.request_type),
         decided_at    = now(),
         remarks       = btrim(p_remarks)
   where id = p_request_id
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Gate security: explicit Gate-Out
--   * Requires gate_security or admin.
--   * Requires an approved pass inside its validity window.
--   * Refuses when the student is already outside (duplicate exit).
-- ---------------------------------------------------------------------------
create or replace function public.record_gate_out(
  p_request_id uuid, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pass   public.pass_requests;
  v_status public.student_campus_status;
  v_event  public.gate_events;
  v_now    timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not app.has_role('gate_security'::public.app_role, 'admin'::public.app_role) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_pass from public.pass_requests where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_pass.approval_status <> 'approved' then
    raise exception 'PASS_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if v_now < v_pass.valid_from then
    raise exception 'PASS_NOT_YET_VALID' using errcode = 'P0001';
  end if;
  if v_now > v_pass.valid_until then
    raise exception 'PASS_EXPIRED' using errcode = 'P0001';
  end if;

  -- Lock (and lazily create) the student's campus-status row.
  insert into public.student_campus_status (admission_number)
  values (v_pass.admission_number)
  on conflict (admission_number) do nothing;

  select * into v_status
    from public.student_campus_status
   where admission_number = v_pass.admission_number
   for update;

  if v_status.status = 'outside' then
    raise exception 'ALREADY_OUTSIDE' using errcode = 'P0001';
  end if;

  insert into public.gate_events
    (admission_number, pass_request_id, event_type, gate_user_id, occurred_at, note, is_open_exit)
  values
    (v_pass.admission_number, v_pass.id, 'gate_out', auth.uid(), v_now,
     nullif(btrim(coalesce(p_note, '')), ''), true)
  returning * into v_event;

  update public.student_campus_status
     set status = 'outside', active_pass_id = v_pass.id, since = v_now
   where admission_number = v_pass.admission_number;

  update public.pass_requests
     set last_gate_out_at = v_now
   where id = v_pass.id;

  return jsonb_build_object(
    'event_id',         v_event.id,
    'event_type',       'gate_out',
    'admission_number', v_pass.admission_number,
    'pass_request_id',  v_pass.id,
    'occurred_at',      v_now
  );
end $$;

-- ---------------------------------------------------------------------------
-- Gate security: explicit Gate-In
--   * Requires gate_security or admin.
--   * Refuses a return when there is no recorded open exit.
--   * Remains available after the pass has expired.
-- ---------------------------------------------------------------------------
create or replace function public.record_gate_in(
  p_admission_number text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_adm    text := btrim(p_admission_number);
  v_status public.student_campus_status;
  v_open   public.gate_events;
  v_pass   uuid;
  v_event  public.gate_events;
  v_now    timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not app.has_role('gate_security'::public.app_role, 'admin'::public.app_role) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_adm is null or length(v_adm) = 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.students s where s.admission_number = v_adm) then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.student_campus_status (admission_number)
  values (v_adm)
  on conflict (admission_number) do nothing;

  select * into v_status
    from public.student_campus_status
   where admission_number = v_adm
   for update;

  if v_status.status <> 'outside' then
    raise exception 'NOT_OUTSIDE' using errcode = 'P0001';
  end if;

  -- Close the outstanding exit, if one is on record.
  select * into v_open
    from public.gate_events
   where admission_number = v_adm and is_open_exit
   order by occurred_at desc
   limit 1
   for update;

  if found then
    update public.gate_events set is_open_exit = false where id = v_open.id;
    v_pass := v_open.pass_request_id;
  else
    v_pass := v_status.active_pass_id;
  end if;

  insert into public.gate_events
    (admission_number, pass_request_id, event_type, gate_user_id, occurred_at, note)
  values
    (v_adm, v_pass, 'gate_in', auth.uid(), v_now,
     nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_event;

  update public.student_campus_status
     set status = 'on_campus', active_pass_id = null, since = v_now
   where admission_number = v_adm;

  if v_pass is not null then
    update public.pass_requests set last_gate_in_at = v_now where id = v_pass;
  end if;

  return jsonb_build_object(
    'event_id',         v_event.id,
    'event_type',       'gate_in',
    'admission_number', v_adm,
    'pass_request_id',  v_pass,
    'occurred_at',      v_now
  );
end $$;

-- ---------------------------------------------------------------------------
-- Gate security: single-call lookup (student + best pass + campus status)
-- ---------------------------------------------------------------------------
create or replace function public.gate_lookup(p_admission_number text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_adm  text := btrim(p_admission_number);
  v_stu  public.students;
  v_pass public.pass_requests;
  v_stat public.student_campus_status;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not app.has_role('gate_security'::public.app_role, 'admin'::public.app_role) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_stu from public.students where admission_number = v_adm;
  if not found then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Prefer a currently valid approved pass, else the most recent approved one.
  select * into v_pass
    from public.pass_requests
   where admission_number = v_adm and approval_status = 'approved'
   order by
     case when now() between valid_from and valid_until then 0 else 1 end,
     valid_until desc
   limit 1;

  select * into v_stat from public.student_campus_status where admission_number = v_adm;

  return jsonb_build_object(
    'student', jsonb_build_object(
      'id',               v_stu.id,
      'admission_number', v_stu.admission_number,
      'full_name',        v_stu.full_name,
      'department',       v_stu.department,
      'program',          v_stu.program
    ),
    'campus_status', coalesce(v_stat.status::text, 'on_campus'),
    'outside_since', v_stat.since,
    'active_pass_id', v_stat.active_pass_id,
    'pass', case when v_pass.id is null then null else to_jsonb(v_pass) end,
    'pass_is_valid', coalesce(now() between v_pass.valid_from and v_pass.valid_until, false),
    'pass_expired',  coalesce(now() > v_pass.valid_until, false)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Admin: role management
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(
  p_user_id uuid, p_role public.app_role
) returns public.user_roles
language plpgsql security definer set search_path = ''
as $$
declare v_row public.user_roles;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_user_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (p_user_id, p_role, auth.uid())
  on conflict (user_id, role) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.user_roles
     where user_id = p_user_id and role = p_role;
  end if;

  return v_row;
end $$;

create or replace function public.admin_revoke_user_role(
  p_user_id uuid, p_role public.app_role
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_admins int;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Never remove the final administrator.
  if p_role = 'admin' then
    select count(*) into v_admins from public.user_roles where role = 'admin';
    if v_admins <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id and role = p_role;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: student records + account linking
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_student(
  p_admission_number text,
  p_full_name        text,
  p_department       text default null,
  p_program          text default null,
  p_academic_year    int  default null,
  p_email            text default null,
  p_phone            text default null
) returns public.students
language plpgsql security definer set search_path = ''
as $$
declare v_row public.students;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_admission_number is null or length(btrim(p_admission_number)) = 0 then
    raise exception 'ADMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.students as s
    (admission_number, full_name, department, program, academic_year, email, phone)
  values
    (btrim(p_admission_number), p_full_name, p_department, p_program,
     p_academic_year, p_email, p_phone)
  on conflict (admission_number) do update
    set full_name     = coalesce(excluded.full_name, s.full_name),
        department    = coalesce(excluded.department, s.department),
        program       = coalesce(excluded.program, s.program),
        academic_year = coalesce(excluded.academic_year, s.academic_year),
        email         = coalesce(excluded.email, s.email),
        phone         = coalesce(excluded.phone, s.phone),
        updated_at    = now()
  returning * into v_row;

  perform app.write_audit('student_upserted', 'student', v_row.id::text,
    v_row.admission_number, jsonb_build_object('full_name', v_row.full_name));

  return v_row;
end $$;

create or replace function public.admin_link_student_account(
  p_admission_number text, p_user_id uuid
) returns public.students
language plpgsql security definer set search_path = ''
as $$
declare v_row public.students;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.students
     set user_id = p_user_id
   where admission_number = btrim(p_admission_number)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform app.write_audit('student_linked', 'student', v_row.id::text,
    v_row.admission_number, jsonb_build_object('user_id', p_user_id));

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: approval routing rules
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_approval_rule(
  p_request_type public.request_type, p_approver_role public.app_role,
  p_is_active boolean default true
) returns public.approval_rules
language plpgsql security definer set search_path = ''
as $$
declare v_row public.approval_rules;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_approver_role in ('admin', 'gate_security', 'student') then
    raise exception 'INVALID_APPROVER_ROLE' using errcode = 'P0001';
  end if;

  insert into public.approval_rules as r (request_type, approver_role, is_active, updated_by)
  values (p_request_type, p_approver_role, p_is_active, auth.uid())
  on conflict (request_type) do update
    set approver_role = excluded.approver_role,
        is_active     = excluded.is_active,
        updated_by    = auth.uid(),
        updated_at    = now()
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: only signed-in users may call these; anon has no access at all.
-- ---------------------------------------------------------------------------
revoke all on function public.submit_pass_request(public.request_type, text, timestamptz, timestamptz, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_pass_request(uuid) from public, anon;
revoke all on function public.approve_pass_request(uuid, text) from public, anon;
revoke all on function public.reject_pass_request(uuid, text) from public, anon;
revoke all on function public.record_gate_out(uuid, text) from public, anon;
revoke all on function public.record_gate_in(text, text) from public, anon;
revoke all on function public.gate_lookup(text) from public, anon;
revoke all on function public.admin_set_user_role(uuid, public.app_role) from public, anon;
revoke all on function public.admin_revoke_user_role(uuid, public.app_role) from public, anon;
revoke all on function public.admin_upsert_student(text, text, text, text, int, text, text) from public, anon;
revoke all on function public.admin_link_student_account(text, uuid) from public, anon;
revoke all on function public.admin_set_approval_rule(public.request_type, public.app_role, boolean) from public, anon;

grant execute on function public.submit_pass_request(public.request_type, text, timestamptz, timestamptz, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_pass_request(uuid) to authenticated;
grant execute on function public.approve_pass_request(uuid, text) to authenticated;
grant execute on function public.reject_pass_request(uuid, text) to authenticated;
grant execute on function public.record_gate_out(uuid, text) to authenticated;
grant execute on function public.record_gate_in(text, text) to authenticated;
grant execute on function public.gate_lookup(text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_revoke_user_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_upsert_student(text, text, text, text, int, text, text) to authenticated;
grant execute on function public.admin_link_student_account(text, uuid) to authenticated;
grant execute on function public.admin_set_approval_rule(public.request_type, public.app_role, boolean) to authenticated;
