-- ============================================================================
-- Khuruj — LOCAL TEST HARNESS (not applied to the hosted Supabase project)
-- ----------------------------------------------------------------------------
-- The migrations reference Supabase-provided objects (`auth.users`,
-- `auth.uid()`, the `anon` / `authenticated` / `service_role` roles, and the
-- default table grants). This file recreates the minimum of that environment so
-- the migrations and the security rules can be exercised on a plain Postgres.
--
-- It is a test fixture only. Never run this against the real project.
-- ============================================================================

create extension if not exists pgcrypto;

-- Supabase Auth schema -------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- Mirrors Supabase's auth.uid(): the JWT subject, read from request settings.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'role'
  )
$$;

-- Supabase roles -------------------------------------------------------------
do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase grants table privileges broadly and relies on RLS for row access.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Test helper: act as a given user for subsequent statements.
create or replace function public.test_set_user(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end $$;

grant execute on function public.test_set_user(uuid) to authenticated, anon;
