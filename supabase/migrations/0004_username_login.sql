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
