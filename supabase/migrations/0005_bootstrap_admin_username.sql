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
