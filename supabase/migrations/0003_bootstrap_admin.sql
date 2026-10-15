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
