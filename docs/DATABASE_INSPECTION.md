# Khuruj — Database inspection & implementation plan

Project ref: `nvjhyzqbfmnzohlvgdca`
URL: `https://nvjhyzqbfmnzohlvgdca.supabase.co`

## 1. What was inspected

| Check | Command / method | Result |
| --- | --- | --- |
| Repo contents | `git ls-files`, `ls` | Only `README.md` and `LICENSE`. No existing application code, no migrations, no `.env`. |
| Credentials present | checked every Supabase env var name | **None set.** No secret mounts, no `.env`, no config file with a key. |
| Network reachability | `curl .../auth/v1/.well-known/jwks.json` | **200** — the project exists and is reachable. |
| REST reachability | `curl .../rest/v1/` | **401** `No API key found in request` — reachable, but anonymous access is denied (expected). |
| JWKS | `curl .../auth/v1/.well-known/jwks.json` | ES256 signing key returned, so **asymmetric JWT verification is supported**. |

## 2. What this means

The project is reachable but **no API key was supplied in this environment**, so
the live schema, existing tables, student records, admission-number fields and
barcode values could not be read. Per the task instructions, no successful
connection was fabricated.

The Shuhood attendance system's repository is also **not accessible** with the
provided GitHub token — the only repository reachable is `ashi-ue/out-pass`.
Shuhood's schema therefore could not be inspected directly. The migrations are
written defensively for exactly this reason (see section 3).

To inspect the real schema, set the variables in `.env.example` and run the
inspection queries in section 5, or:

```bash
supabase link --project-ref nvjhyzqbfmnzohlvgdca
supabase db pull          # captures the current remote schema
```

## 3. Design decisions that assume nothing about the live schema

The migrations were written to be **safe whether or not** tables already exist:

- **`public.students` is reused, never replaced.** Migration `0001` checks
  `information_schema.tables`; if the table exists it only adds missing nullable
  columns (`add column if not exists`). If it does not exist, a minimal table is
  created.
- **The barcode is the admission number.** Khuruj stores `admission_number` as
  `text` and never generates or rewrites barcodes.
- **Uniqueness is guarded, not forced.** A unique index on
  `students.admission_number` is created only when the data allows it. If legacy
  duplicates exist the index is skipped with a `RAISE WARNING` instead of failing
  the migration — so a duplicate admission number can never break the deploy, and
  an administrator is told to resolve the duplicates.
- **No destructive statements.** There are no `DROP TABLE`, `TRUNCATE` or
  `DELETE` statements against pre-existing data anywhere in the migrations.
- **Khuruj-owned tables are namespaced** (`pass_requests`, `gate_events`,
  `student_campus_status`, `audit_log`, `profiles`, `user_roles`,
  `approval_rules`, `app_settings`) so they cannot collide with Shuhood tables.
- **Everything is idempotent** (`create table if not exists`,
  `create or replace function`, `drop policy if exists` + `create policy`,
  `do $$ ... exception when duplicate_object`), so re-running is safe.

## 4. Files added

```
supabase/migrations/0001_core_schema.sql      tables, types, helpers, RLS
supabase/migrations/0002_rpc.sql              privileged state transitions
supabase/migrations/0003_bootstrap_admin.sql  first-admin bootstrap + teardown
supabase/functions/report-summary/index.ts    server-side reporting (secret key)
```

## 5. Inspection queries to run once credentials exist

```sql
-- Existing tables and whether RLS is on
select table_name, row_security
from information_schema.tables t
join pg_class c on c.relname = t.table_name
where table_schema = 'public' and t.table_type = 'BASE TABLE'
order by table_name;

-- Student-shaped columns already present
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (column_name ilike '%admission%'
       or column_name ilike '%barcode%'
       or column_name ilike '%roll%'
       or column_name ilike '%student%')
order by table_name, column_name;

-- Duplicate admission numbers (must be empty before the unique index applies)
select admission_number, count(*)
from public.students
group by admission_number
having count(*) > 1;

-- Existing policies on any student table
select schemaname, tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public';
```

## 6. Data-quality items to confirm before go-live

1. Confirm which column holds the ID-card barcode. If it is not
   `admission_number`, add a mapping in `0001` (the column is added defensively,
   so this is a one-line change).
2. Resolve any duplicate admission numbers so the unique index can be applied.
3. Link each student login to a student row (`user_id`) via the admin UI or
   `admin_link_student_account`.
4. Seed at least one administrator (migration `0003`).
