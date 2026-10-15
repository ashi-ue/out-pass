-- ============================================================================
-- Khuruj (خروج) — hosted project setup bundle
-- ----------------------------------------------------------------------------
-- GENERATED FILE — do not edit by hand. It is a straight concatenation of
-- supabase/migrations/0001..0005 plus a bootstrap call. Regenerate with:
--
--   cat supabase/migrations/000{1..5}_*.sql > supabase/setup_hosted.sql
--
-- then re-add this header and the bootstrap footer at the end.
--
-- Purpose: provision the EXISTING Supabase project nvjhyzqbfmnzohlvgdca with
-- the Khuruj schema, RLS policies, RPCs and the first administrator.
--
-- How to run: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- Safe: additive and idempotent. It never drops, truncates or overwrites
-- tables or data. Re-running is harmless. Verified by applying it twice in a
-- row against a throwaway Postgres.
--
-- The final statement grants the first admin to the username `admin`. That auth
-- account must already exist; create it first (see README setup section).
-- ============================================================================

-- ============================================================================
-- Khuruj (خروج) — 0001 core schema, RLS policies and helper functions
-- ----------------------------------------------------------------------------
-- SAFETY CONTRACT
--   * Additive and repeatable (idempotent). Never drops, truncates or
--     overwrites existing tables or data.
--   * REUSES the existing public.students table when present; only adds the
--     nullable columns Khuruj needs. Creates it only when absent.
--   * The student ID-card barcode IS the admission number. Khuruj stores it as
--     text and never regenerates barcodes.
--   * Approval state (pass_requests.approval_status) is tracked separately from
--     physical campus state (student_campus_status.status).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Private helper schema
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum (
    'admin', 'mentor', 'class_teacher', 'medical_approver', 'duty_teacher',
    'gate_security', 'student'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_type as enum (
    'going_home', 'afternoon_out', 'medical', 'thursday_friday'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum (
    'pending', 'approved', 'rejected', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.campus_status as enum ('on_campus', 'outside');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gate_event_type as enum ('gate_out', 'gate_in');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Identity: profiles + user_roles (server-enforced RBAC source of truth)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);
create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

comment on table public.user_roles is
  'Authoritative role grants. Never trust a role supplied by the client.';

-- ---------------------------------------------------------------------------
-- 3. Students — reuse existing table, extend defensively
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'students'
  ) then
    create table public.students (
      id               uuid primary key default gen_random_uuid(),
      admission_number text,
      full_name        text,
      department       text,
      program          text,
      academic_year    int,
      email            text,
      phone            text,
      is_active        boolean not null default true,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now()
    );
  end if;
end $$;

alter table public.students add column if not exists admission_number text;
alter table public.students add column if not exists full_name        text;
alter table public.students add column if not exists department       text;
alter table public.students add column if not exists program          text;
alter table public.students add column if not exists academic_year    int;
alter table public.students add column if not exists email            text;
alter table public.students add column if not exists phone            text;
alter table public.students add column if not exists user_id          uuid;
alter table public.students add column if not exists is_active        boolean default true;
alter table public.students add column if not exists created_at       timestamptz default now();
alter table public.students add column if not exists updated_at       timestamptz default now();

-- Link a login to a student record without ever duplicating the student.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass and contype = 'f'
      and conname = 'students_user_id_fkey'
  ) then
    begin
      alter table public.students
        add constraint students_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete set null;
    exception when others then
      raise notice 'Khuruj: skipped students_user_id_fkey (%).', sqlerrm;
    end;
  end if;
end $$;

-- De-duplicate admission numbers. If legacy data already holds duplicates the
-- index is skipped with a loud warning instead of failing the whole migration.
do $$
begin
  begin
    create unique index if not exists students_admission_number_key
      on public.students (admission_number)
      where admission_number is not null;
  exception when others then
    raise warning 'Khuruj: could not enforce uniqueness on students.admission_number (%). Resolve duplicates then re-run.', sqlerrm;
  end;
end $$;

create unique index if not exists students_user_id_key
  on public.students (user_id) where user_id is not null;

comment on column public.students.admission_number is
  'Student ID-card barcode value. Reused as the Khuruj natural key.';

-- ---------------------------------------------------------------------------
-- 4. Configuration: approval routing + campus settings
-- ---------------------------------------------------------------------------
create table if not exists public.approval_rules (
  request_type  public.request_type primary key,
  approver_role public.app_role not null,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

insert into public.approval_rules (request_type, approver_role) values
  ('going_home',      'class_teacher'),
  ('afternoon_out',   'mentor'),
  ('medical',         'medical_approver'),
  ('thursday_friday', 'duty_teacher')
on conflict (request_type) do nothing;

create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings (key, value) values
  ('campus_timezone', 'Asia/Kolkata')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Pass requests (approval lifecycle only — not physical presence)
-- ---------------------------------------------------------------------------
create table if not exists public.pass_requests (
  id                  uuid primary key default gen_random_uuid(),
  admission_number    text not null,
  student_user_id     uuid references auth.users(id) on delete set null,
  request_type        public.request_type not null,
  purpose             text not null,
  destination         text,
  reason              text,
  requested_departure timestamptz not null,
  requested_return    timestamptz not null,
  valid_from          timestamptz not null,
  valid_until         timestamptz not null,
  approval_status     public.approval_status not null default 'pending',
  approver_id         uuid references auth.users(id) on delete set null,
  approver_role       public.app_role,
  decided_at          timestamptz,
  remarks             text,
  last_gate_out_at    timestamptz,
  last_gate_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint pass_requests_validity_chk check (valid_until > valid_from),
  constraint pass_requests_window_chk   check (requested_return > requested_departure)
);
create index if not exists pass_requests_admission_idx on public.pass_requests (admission_number, created_at desc);
create index if not exists pass_requests_status_idx    on public.pass_requests (approval_status, valid_until);
create index if not exists pass_requests_student_idx   on public.pass_requests (student_user_id);

comment on table public.pass_requests is
  'Approval state is independent of physical campus state (student_campus_status).';

-- ---------------------------------------------------------------------------
-- 6. Physical campus status (one row per student) + append-only gate log
-- ---------------------------------------------------------------------------
create table if not exists public.student_campus_status (
  admission_number text primary key,
  status           public.campus_status not null default 'on_campus',
  active_pass_id   uuid references public.pass_requests(id) on delete set null,
  since            timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.gate_events (
  id               uuid primary key default gen_random_uuid(),
  admission_number text not null,
  pass_request_id  uuid references public.pass_requests(id) on delete restrict,
  event_type       public.gate_event_type not null,
  gate_user_id     uuid not null references auth.users(id) on delete restrict,
  occurred_at      timestamptz not null default now(),
  note             text,
  -- true only on a gate_out row that has no matching gate_in yet.
  is_open_exit     boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists gate_events_admission_idx on public.gate_events (admission_number, occurred_at desc);
create index if not exists gate_events_pass_idx      on public.gate_events (pass_request_id);

-- At most one open (un-returned) gate-out per student. Enforced by the database
-- so a duplicate exit is impossible even under concurrent requests.
create unique index if not exists gate_events_one_open_exit
  on public.gate_events (admission_number)
  where is_open_exit;

-- ---------------------------------------------------------------------------
-- 7. Audit log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  actor_id         uuid,
  actor_role       public.app_role,
  action           text not null,
  entity_type      text not null,
  entity_id        text,
  admission_number text,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx  on public.audit_log (entity_type, entity_id);

-- ===========================================================================
-- 8. Helper functions (role resolution — never trust client input)
-- ===========================================================================
create or replace function app.has_role(variadic p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid()
      and p.is_active
      and r.role = any(p_roles)
  );
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_role('admin'::public.app_role); $$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role(
    'admin'::public.app_role, 'mentor'::public.app_role,
    'class_teacher'::public.app_role, 'medical_approver'::public.app_role,
    'duty_teacher'::public.app_role, 'gate_security'::public.app_role
  );
$$;

create or replace function app.is_approver() returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role(
    'admin'::public.app_role, 'mentor'::public.app_role,
    'class_teacher'::public.app_role, 'medical_approver'::public.app_role,
    'duty_teacher'::public.app_role
  );
$$;

create or replace function app.current_roles() returns public.app_role[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r.role), '{}'::public.app_role[])
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = auth.uid() and p.is_active;
$$;

create or replace function app.current_admission_number() returns text
language sql stable security definer set search_path = ''
as $$
  select s.admission_number
  from public.students s
  where s.user_id = auth.uid()
  limit 1;
$$;

create or replace function app.campus_timezone() returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select value from public.app_settings where key = 'campus_timezone'),
    'UTC'
  );
$$;

create or replace function app.required_approver(p_type public.request_type)
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select approver_role from public.approval_rules
  where request_type = p_type and is_active
  limit 1;
$$;

-- True when the caller may decide on this request type. Admins may decide any.
-- Fails closed: if no active rule is configured for the type,
-- app.required_approver() returns NULL and no non-admin may decide. Without the
-- explicit `is not null` guard the comparison yields NULL, `not NULL` is NULL,
-- and the `if not ...` checks in the RPCs would silently allow anyone through.
create or replace function app.can_decide(p_type public.request_type)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin() or (
    app.required_approver(p_type) is not null
    and app.required_approver(p_type) = any(app.current_roles())
  );
$$;

create or replace function app.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_admission text, p_details jsonb
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_log
    (actor_id, actor_role, action, entity_type, entity_id, admission_number, details)
  values (
    auth.uid(),
    (select r.role from public.user_roles r
      where r.user_id = auth.uid()
      order by array_position(
        array['admin','gate_security','medical_approver','duty_teacher','mentor','class_teacher','student']::public.app_role[],
        r.role) limit 1),
    p_action, p_entity_type, p_entity_id, p_admission, coalesce(p_details, '{}'::jsonb)
  );
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Guard: Khuruj rows must reference a real student.
create or replace function app.assert_student_exists() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.admission_number is null or length(btrim(new.admission_number)) = 0 then
    raise exception 'ADMISSION_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.students s where s.admission_number = new.admission_number
  ) then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Auto-provision a profile and a default student role for new logins.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict (user_id, role) do nothing;

  return new;
end $$;

drop trigger if exists khuruj_on_auth_user_created on auth.users;
create trigger khuruj_on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Audit triggers for approval decisions and administrative changes.
create or replace function app.audit_pass_request() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('pass_request_created', 'pass_request', new.id::text,
      new.admission_number, jsonb_build_object('approval_status', new.approval_status,
                                               'request_type', new.request_type));
    return new;
  end if;

  if new.approval_status is distinct from old.approval_status then
    v_action := 'pass_request_' || new.approval_status::text;
  elsif new.last_gate_out_at is distinct from old.last_gate_out_at then
    v_action := 'pass_request_gate_out';
  elsif new.last_gate_in_at is distinct from old.last_gate_in_at then
    v_action := 'pass_request_gate_in';
  else
    v_action := 'pass_request_updated';
  end if;

  perform app.write_audit(v_action, 'pass_request', new.id::text, new.admission_number,
    jsonb_build_object(
      'before_status', old.approval_status,
      'after_status',  new.approval_status,
      'remarks',       new.remarks,
      'approver_id',   new.approver_id
    ));
  return new;
end $$;

drop trigger if exists khuruj_audit_pass_request on public.pass_requests;
create trigger khuruj_audit_pass_request
  after insert or update on public.pass_requests
  for each row execute function app.audit_pass_request();

create or replace function app.audit_user_roles() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit('role_granted', 'user_role', new.user_id::text, null,
      jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    perform app.write_audit('role_revoked', 'user_role', old.user_id::text, null,
      jsonb_build_object('role', old.role));
    return old;
  end if;
  return new;
end $$;

drop trigger if exists khuruj_audit_user_roles on public.user_roles;
create trigger khuruj_audit_user_roles
  after insert or delete on public.user_roles
  for each row execute function app.audit_user_roles();

create or replace function app.audit_config_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_entity text := tg_table_name;
  v_key    text;
begin
  -- The key column differs per table. Referencing the wrong field on the row
  -- record raises "record new has no field ..." at runtime, which would make
  -- every write to approval_rules / app_settings fail. Read via jsonb instead.
  v_key := case
    when tg_table_name = 'approval_rules' then to_jsonb(new) ->> 'request_type'
    else to_jsonb(new) ->> 'key'
  end;

  perform app.write_audit(
    v_entity || '_changed', v_entity, coalesce(v_key, 'unknown'), null, to_jsonb(new));
  return new;
end $$;

drop trigger if exists khuruj_audit_approval_rules on public.approval_rules;
create trigger khuruj_audit_approval_rules
  after insert or update on public.approval_rules
  for each row execute function app.audit_config_change();

drop trigger if exists khuruj_audit_app_settings on public.app_settings;
create trigger khuruj_audit_app_settings
  after insert or update on public.app_settings
  for each row execute function app.audit_config_change();

-- Gate events are audited by trigger rather than by the RPC, so the record is
-- written no matter which path inserts the row. The RPCs deliberately do not
-- write their own audit entry, which keeps exactly one row per movement.
create or replace function app.audit_gate_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.write_audit(
    new.event_type::text, 'gate_event', new.id::text, new.admission_number,
    jsonb_build_object(
      'pass_request_id', new.pass_request_id,
      'occurred_at',     new.occurred_at,
      'note',            new.note
    ));
  return new;
end $$;

drop trigger if exists khuruj_audit_gate_events on public.gate_events;
create trigger khuruj_audit_gate_events
  after insert on public.gate_events
  for each row execute function app.audit_gate_event();

-- updated_at triggers
drop trigger if exists khuruj_touch_profiles on public.profiles;
create trigger khuruj_touch_profiles before update on public.profiles
  for each row execute function app.touch_updated_at();

drop trigger if exists khuruj_touch_pass_requests on public.pass_requests;
create trigger khuruj_touch_pass_requests before update on public.pass_requests
  for each row execute function app.touch_updated_at();

drop trigger if exists khuruj_touch_students on public.students;
create trigger khuruj_touch_students before update on public.students
  for each row execute function app.touch_updated_at();

-- Student-existence guards
drop trigger if exists khuruj_guard_pass_requests on public.pass_requests;
create trigger khuruj_guard_pass_requests before insert or update on public.pass_requests
  for each row execute function app.assert_student_exists();

drop trigger if exists khuruj_guard_gate_events on public.gate_events;
create trigger khuruj_guard_gate_events before insert or update on public.gate_events
  for each row execute function app.assert_student_exists();

drop trigger if exists khuruj_guard_campus_status on public.student_campus_status;
create trigger khuruj_guard_campus_status before insert or update on public.student_campus_status
  for each row execute function app.assert_student_exists();

-- ===========================================================================
-- 9. Row Level Security
-- ===========================================================================
alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.students              enable row level security;
alter table public.approval_rules        enable row level security;
alter table public.app_settings          enable row level security;
alter table public.pass_requests         enable row level security;
alter table public.student_campus_status enable row level security;
alter table public.gate_events           enable row level security;
alter table public.audit_log             enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select_self_or_staff on public.profiles;
create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated
  using (id = auth.uid() or app.is_staff());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or app.is_admin())
  with check (id = auth.uid() or app.is_admin());

-- user_roles ----------------------------------------------------------------
drop policy if exists user_roles_select_self_or_admin on public.user_roles;
create policy user_roles_select_self_or_admin on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin());

-- Role changes are validated again by public.admin_set_user_role().
drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write on public.user_roles
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- students ------------------------------------------------------------------
drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (user_id = auth.uid() or app.is_staff());

drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- approval_rules ------------------------------------------------------------
drop policy if exists approval_rules_read on public.approval_rules;
create policy approval_rules_read on public.approval_rules
  for select to authenticated using (true);

drop policy if exists approval_rules_admin_write on public.approval_rules;
create policy approval_rules_admin_write on public.approval_rules
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- app_settings --------------------------------------------------------------
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- pass_requests -------------------------------------------------------------
-- Students see their own; approvers see only the types they own; gate sees
-- approved passes only. INSERT/UPDATE/DELETE are deliberately not granted
-- here — every mutation goes through the validated RPCs in migration 0002.
drop policy if exists pass_requests_select on public.pass_requests;
create policy pass_requests_select on public.pass_requests
  for select to authenticated
  using (
    app.is_admin()
    or student_user_id = auth.uid()
    or admission_number = app.current_admission_number()
    or (app.is_approver() and app.can_decide(request_type))
    or (app.has_role('gate_security'::public.app_role) and approval_status = 'approved')
  );

-- student_campus_status -----------------------------------------------------
drop policy if exists campus_status_select on public.student_campus_status;
create policy campus_status_select on public.student_campus_status
  for select to authenticated
  using (
    app.is_staff()
    or admission_number = app.current_admission_number()
  );

-- gate_events ---------------------------------------------------------------
drop policy if exists gate_events_select on public.gate_events;
create policy gate_events_select on public.gate_events
  for select to authenticated
  using (
    app.is_admin()
    or app.has_role('gate_security'::public.app_role)
    or admission_number = app.current_admission_number()
  );

-- audit_log -----------------------------------------------------------------
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (app.is_admin());

-- ===========================================================================
-- 10. Grants
-- ===========================================================================
grant execute on all functions in schema app to anon, authenticated, service_role;
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
  -- The uniqueness of students.admission_number is a PARTIAL index
  -- (where admission_number is not null), so the conflict target must repeat
  -- that predicate. Without it Postgres cannot infer the index and errors with
  -- "there is no unique or exclusion constraint matching the ON CONFLICT
  -- specification".
  on conflict (admission_number) where admission_number is not null do update
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
-- ============================================================================
-- Khuruj (خروج) — 0003 first administrator bootstrap
-- ----------------------------------------------------------------------------
-- Chicken-and-egg: role management requires an admin, but a fresh database has
-- none. This one-shot helper grants the first admin. It is deliberately:
--   * callable only with the SECRET key (service_role) — never by a browser;
--   * self-disabling once any admin exists.
-- Run it from the Supabase SQL editor (which uses service_role) exactly once.
-- ============================================================================

-- Dropped first so the migration stays repeatable: 0005 renames the input
-- parameter, and Postgres refuses to rename a parameter via `create or replace`.
-- Nothing else calls this function, so the gap is harmless.
drop function if exists public.bootstrap_admin(text);

create or replace function public.bootstrap_admin(p_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'ADMIN_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  select id into v_uid from auth.users where email = lower(btrim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, full_name, email)
  values (v_uid, (select coalesce(raw_user_meta_data->>'full_name', email) from auth.users where id = v_uid),
          (select email from auth.users where id = v_uid))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (v_uid, 'admin')
  on conflict (user_id, role) do nothing;
end $$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ============================================================================
-- Reversible teardown (run manually, only if you truly want to remove Khuruj).
-- Kept commented out on purpose: it drops Khuruj-owned objects and NEVER touches
-- pre-existing Shuhood tables or data. The `students` table is intentionally
-- NOT dropped because it may be shared with the existing system.
-- ----------------------------------------------------------------------------
-- drop function if exists public.bootstrap_admin(text);
-- drop function if exists public.admin_set_approval_rule(public.request_type, public.app_role, boolean);
-- drop function if exists public.admin_link_student_account(text, uuid);
-- drop function if exists public.admin_upsert_student(text, text, text, text, int, text, text);
-- drop function if exists public.admin_revoke_user_role(uuid, public.app_role);
-- drop function if exists public.admin_set_user_role(uuid, public.app_role);
-- drop function if exists public.gate_lookup(text);
-- drop function if exists public.record_gate_in(text, text);
-- drop function if exists public.record_gate_out(uuid, text);
-- drop function if exists public.reject_pass_request(uuid, text);
-- drop function if exists public.approve_pass_request(uuid, text);
-- drop function if exists public.cancel_pass_request(uuid);
-- drop function if exists public.submit_pass_request(public.request_type, text, timestamptz, timestamptz, text, text, timestamptz, timestamptz);
-- drop table if exists public.audit_log;
-- drop table if exists public.gate_events;
-- drop table if exists public.student_campus_status;
-- drop table if exists public.pass_requests;
-- drop table if exists public.app_settings;
-- drop table if exists public.approval_rules;
-- drop table if exists public.user_roles;
-- drop table if exists public.profiles;
-- drop schema if exists app cascade;
-- drop type if exists public.gate_event_type, public.campus_status, public.approval_status, public.request_type, public.app_role;
-- NOTE: public.students is left intact on purpose.
-- ============================================================================
-- Khuruj (خروج) — 0004 username logins and forced password change
-- ----------------------------------------------------------------------------
-- The login model changed: staff sign in with a USERNAME, not an email, and
-- only an administrator may change a username. Students do not sign in at all —
-- they exist as records so staff can raise passes for them.
--
-- SAFETY CONTRACT
--   * Additive and repeatable (idempotent). Never drops, truncates or
--     overwrites existing tables or data.
--   * Supabase Auth is email-based, so a username is stored on `profiles` and
--     mapped to a deterministic synthetic address (`<username>@khuruj.local`)
--     at sign-in. `auth.users.email` still holds that address; no Auth schema
--     change is made.
--   * A new auth user is NO LONGER granted a default `student` role. Roles are
--     granted explicitly (by `bootstrap_admin` or the admin-users function),
--     which fails closed if a user is created without a role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New profile columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.username is
  'Login handle. Staff sign in with this, mapped to <username>@khuruj.local. Only an admin may change it.';
comment on column public.profiles.must_change_password is
  'True after an admin sets or resets the password. Cleared by the user via public.complete_password_change().';

-- Case-insensitive uniqueness, so "Teacher1" and "teacher1" cannot both exist.
do $$
begin
  begin
    create unique index if not exists profiles_username_key
      on public.profiles (lower(username))
      where username is not null;
  exception when others then
    raise warning 'Khuruj: could not enforce uniqueness on profiles.username (%). Resolve duplicates then re-run.', sqlerrm;
  end;
end $$;

-- Lowercase handle, 3-32 chars, starting alphanumeric. Keeps the synthetic
-- email valid and prevents a username that looks like an address.
do $$
begin
  alter table public.profiles add constraint profiles_username_format_chk
    check (
      username is null
      or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
    );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A username may only be changed by an administrator
-- ---------------------------------------------------------------------------
-- RLS cannot compare the old and new row, so the rule lives in a trigger.
-- `auth.uid()` is null for the service role (the admin-users function) and for
-- the SQL editor; those callers are already trusted, and anon is refused by the
-- profiles policies regardless.
create or replace function app.protect_username() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.username is distinct from old.username
     and auth.uid() is not null
     and not app.is_admin() then
    raise exception 'USERNAME_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists khuruj_protect_username on public.profiles;
create trigger khuruj_protect_username
  before update on public.profiles
  for each row execute function app.protect_username();

-- ---------------------------------------------------------------------------
-- 3. New auth users get a profile only — never a default role
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    nullif(lower(btrim(coalesce(new.raw_user_meta_data->>'username', ''))), '')
  )
  on conflict (id) do nothing;

  -- No role is granted here on purpose. Staff are provisioned with an explicit
  -- role by the administrator; a login with no role can reach nothing.
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Clear the forced-change flag for the calling user
-- ---------------------------------------------------------------------------
create or replace function public.complete_password_change()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  update public.profiles
     set must_change_password = false,
         updated_at = now()
   where id = auth.uid();
end $$;

revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- ============================================================================
-- Reversible teardown (run manually).
-- ----------------------------------------------------------------------------
-- drop function if exists public.complete_password_change();
-- drop trigger if exists khuruj_protect_username on public.profiles;
-- drop function if exists app.protect_username();
-- alter table public.profiles drop constraint if exists profiles_username_format_chk;
-- drop index if exists public.profiles_username_key;
-- alter table public.profiles drop column if exists must_change_password;
-- alter table public.profiles drop column if exists username;
-- -- Restore the previous trigger body by re-running 0001_core_schema.sql.
-- ============================================================================
-- ============================================================================
-- Khuruj (خروج) — 0005 bootstrap the first administrator by username
-- ----------------------------------------------------------------------------
-- 0003 granted the first admin by looking the account up by email. Staff no
-- longer sign in with an email — they sign in with a username mapped to
-- `<username>@khuruj.local` — so an operator provisioning the hosted project has
-- no address to pass. This migration teaches `bootstrap_admin` to accept either
-- form, keeping the same single-argument signature.
--
-- Still deliberately:
--   * callable only with the SECRET key (service_role) — never by a browser;
--   * self-disabling once any admin exists.
--
-- Run once from the Supabase SQL editor:
--   select public.bootstrap_admin('ayesha.khan');
--
-- Safe to re-run: it only raises when an admin already exists.
-- ============================================================================

-- The parameter was renamed from `p_email` to `p_login`. Postgres cannot rename
-- an input parameter via `create or replace`, so the old function is dropped
-- first. Nothing else calls it, so the gap is harmless.
drop function if exists public.bootstrap_admin(text);

create or replace function public.bootstrap_admin(p_login text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_uid   uuid;
begin
  if v_login = '' then
    raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'ADMIN_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  -- A value containing '@' is treated as the account address; anything else is
  -- a username. Usernames live on `profiles`, which `handle_new_user` populates
  -- from the account's metadata.
  if position('@' in v_login) > 0 then
    select id into v_uid from auth.users where email = v_login limit 1;
  else
    select p.id into v_uid
    from public.profiles p
    where lower(p.username) = v_login
    limit 1;

    -- The account may exist before its profile is backfilled.
    if v_uid is null then
      select id into v_uid
      from auth.users
      where lower(raw_user_meta_data->>'username') = v_login
      limit 1;
    end if;
  end if;

  if v_uid is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, full_name, email, username)
  select u.id,
         coalesce(u.raw_user_meta_data->>'full_name', u.email),
         u.email,
         nullif(lower(btrim(coalesce(u.raw_user_meta_data->>'username', ''))), '')
  from auth.users u
  where u.id = v_uid
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (v_uid, 'admin')
  on conflict (user_id, role) do nothing;
end $$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ============================================================================
-- Reversible teardown: re-apply 0003 to restore the email-only body.
-- ----------------------------------------------------------------------------
-- The signature is unchanged, so no drop is required.
-- ============================================================================

-- ============================================================================
-- Bootstrap the first administrator (username: admin)
-- ----------------------------------------------------------------------------
-- Self-disabling: raises ADMIN_ALREADY_EXISTS if any admin already exists.
-- Wrapped so re-running this bundle is harmless.
-- ============================================================================
do $$
begin
  perform public.bootstrap_admin('admin');
  raise notice 'bootstrap_admin: granted admin to username "admin"';
exception when others then
  raise notice 'bootstrap_admin skipped: %', sqlerrm;
end $$;
