# Khuruj — setup instructions

## 1. Prerequisites

- Node.js 20.19+ (Node 24 tested)
- The Supabase CLI (`npm i -g supabase` or `npx supabase`)
- Access to the existing Supabase project `nvjhyzqbfmnzohlvgdca`

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the real values from
**Supabase Dashboard → Project Settings → API Keys**.

```bash
cp .env.example .env.local
```

| Variable | Scope | Where to get it |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | `https://nvjhyzqbfmnzohlvgdca.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser | Settings → API Keys → Publishable (`sb_publishable_…`). The legacy `anon` key also works. |
| `SUPABASE_SECRET_KEY` | Backend only | Settings → API Keys → Secret (`sb_secret_…`). **Never** add a `VITE_` prefix. |
| `SUPABASE_JWKS_URL` | Backend only | `https://nvjhyzqbfmnzohlvgdca.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_PROJECT_ID` | CLI | `nvjhyzqbfmnzohlvgdca` |
| `VITE_CAMPUS_TZ` | Browser | Display timezone, e.g. `Asia/Kolkata` |

`.env*` is gitignored; `.env.example` is the committed template.

## 3. Install and run the frontend

```bash
npm install
npm run dev        # http://localhost:12000
```

The login screen reports clearly if the Supabase variables are missing, rather
than failing silently.

## 4. Apply the database migrations

Migrations are additive, idempotent and non-destructive.

```bash
supabase login
supabase link --project-ref nvjhyzqbfmnzohlvgdca
supabase db push          # applies 0001, 0002, 0003
```

If you prefer the SQL editor, run the three files in
`supabase/migrations/` **in order**: `0001_core_schema.sql`,
`0002_rpc.sql`, `0003_bootstrap_admin.sql`.

Before pushing, read `docs/DATABASE_INSPECTION.md`. If the existing database has
duplicate admission numbers the unique index is skipped with a warning — resolve
the duplicates and re-run `0001`.

## 5. Create the first administrator

1. Create a user in **Authentication → Users** (or let them sign up).
2. Promote them once, from the SQL editor (runs as `service_role`):

```sql
select public.bootstrap_admin('admin@university.edu');
```

The function refuses to run if an administrator already exists. After this, all
further role changes happen in **Admin → Users**.

## 6. Deploy the Edge Function (optional)

```bash
supabase secrets set SUPABASE_SECRET_KEY=sb_secret_... \
                     KHURUJ_ALLOWED_ORIGIN=https://your-frontend-origin
supabase functions deploy report-summary
```

`SUPABASE_URL` and the publishable key are provided automatically to Edge
Functions; only the secret key and the allowed origin need to be set.

## 7. Configure Auth redirects

In **Authentication → URL Configuration**, set the Site URL and add your frontend
origin to the redirect allow-list so sign-in links work in production.

## 8. Generate typed schema (recommended once connected)

```bash
SUPABASE_PROJECT_ID=nvjhyzqbfmnzohlvgdca npm run gen:types
```

This replaces the hand-maintained types in `src/lib/types.ts` with exact
generated types.

## 9. Quality checks

```bash
npm run typecheck
npm run lint
npm run test:run      # frontend unit tests
npm run build
```

## 9b. Database tests (no Supabase project needed)

The migrations and every security rule can be tested locally against a throwaway
PostgreSQL container. This recreates the minimum Supabase environment and runs 43
checks over the real RPCs and RLS policies.

```bash
./supabase/tests/run.sh        # requires Docker
```

It exits non-zero if any check fails. Run this after changing any migration.

## 10. Remaining configuration tasks

- [ ] Provide the publishable and secret keys (not present in the build
      environment used to create this project).
- [ ] Inspect the live schema and confirm the barcode column name
      (`docs/DATABASE_INSPECTION.md`).
- [ ] Resolve duplicate admission numbers, if any.
- [ ] Run the manual test plan (`docs/TEST_PLAN.md`).
- [ ] Seed administrators and link student accounts.
- [ ] Set the production origin in Auth redirects and in
      `KHURUJ_ALLOWED_ORIGIN`.
