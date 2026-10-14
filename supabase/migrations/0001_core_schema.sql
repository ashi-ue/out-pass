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
