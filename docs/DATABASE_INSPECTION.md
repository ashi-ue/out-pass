# Khuruj — Database inspection & implementation plan

Project ref: `nvjhyzqbfmnzohlvgdca`
URL: `https://nvjhyzqbfmnzohlvgdca.supabase.co`

## 1. What was inspected

### Pass 1 — before credentials were available

| Check | Command / method | Result |
| --- | --- | --- |
| Repo contents | `git ls-files`, `ls` | Only `README.md` and `LICENSE`. No existing application code, no migrations, no `.env`. |
| Credentials present | checked every Supabase env var name | **None set.** No secret mounts, no `.env`, no config file with a key. |
| Network reachability | `curl .../auth/v1/.well-known/jwks.json` | **200** — the project exists and is reachable. |
| REST reachability | `curl .../rest/v1/` | **401** `No API key found in request` — reachable, but anonymous access is denied (expected). |
| JWKS | `curl .../auth/v1/.well-known/jwks.json` | ES256 signing key returned, so **asymmetric JWT verification is supported**. |

### Pass 2 — after the project's API keys were supplied

Credentials were then configured in `.env.local` (gitignored) and the live
project was queried read-only with the secret key.

| Check | Command / method | Result |
| --- | --- | --- |
| Publishable key accepted | `POST /auth/v1/token?grant_type=password` | **400** `invalid_credentials` — the key is valid and Auth is reachable. |
| Secret key accepted | `GET /auth/v1/admin/users` | **200** |
| Exposed schema | `GET /rest/v1/` (OpenAPI) | **`definitions: {}`** — the `public` schema exposes **no tables or views**. |
| Candidate tables | `GET /rest/v1/{students,pass_requests,user_roles,profiles}` | **404** `PGRST205` on every one — none exist. |
| Auth users | `GET /auth/v1/admin/users` | **0 users.** |
| Storage buckets | `GET /storage/v1/bucket` | **`[]`** — none. |
| Postgres version | OpenAPI `info.version` | **14.18** |

## 2. What this means

**The hosted project is empty.** There is no existing Shuhood schema, no
`students` table, no student records, no admission numbers and no barcodes in
this project. The brief's instruction to "reuse compatible existing tables and
student records" therefore has nothing to reuse here, and there was no
pre-existing data to preserve — which also means the migrations cannot collide
with, overwrite or drop anything.

Two consequences worth flagging:

1. **The Shuhood attendance data is not in this project.** Either it lives in a
   different Supabase project, or it has not been migrated yet. Until it is,
   Khuruj's `students` table is the only student source, and it will need to be
   populated (by import, or by the admin UI). This is the single most important
   item to resolve before go-live — see section 6.
2. **The project's Postgres is 14.18**, while `supabase/config.toml` declares
   `major_version = 17` for the local stack and the test harness runs PostgreSQL
   17. The migrations use nothing newer than 14, so this is not a blocker, but the
   local/remote version gap should be closed to avoid surprises.

The migrations are still written defensively (section 3) so they remain safe if a
`students` table is later imported from Shuhood, or if the schema is populated by
a `supabase db pull` from elsewhere.

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

## 5. Inspection queries (run against the live project)

These are the queries to re-run after any import, to confirm the schema state.

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

Result as of this inspection: **no tables, no columns, no duplicates, no
policies** — the schema is empty.

## 6. Data-quality items to confirm before go-live

1. **Locate the Shuhood student data.** It is not in this project. Import it, or
   create students through the admin UI. The `students` table will otherwise be
   empty and no barcode will resolve.
2. **Confirm which column holds the ID-card barcode.** The brief states the
   barcode value *is* the admission number, and Khuruj is built on that
   assumption. If an imported schema uses a different column name (for example
   `barcode` or `roll_number`), map it to `admission_number` — the column is added
   defensively, so this is a small change to `0001`.
3. **Resolve any duplicate admission numbers** so the unique index can be applied.
   A duplicate would otherwise let two students share one barcode.
4. **Link each student login to a student row** (`user_id`) via the admin UI or
   `admin_link_student_account`.
5. **Seed at least one administrator** (migration `0003`).
