# Khuruj ‚Äî setup instructions

## 1. Prerequisites

- Node.js 20.19+ (Node 24 tested)
- The Supabase CLI (`npm i -g supabase` or `npx supabase`)
- Access to the existing Supabase project `nvjhyzqbfmnzohlvgdca`

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the real values from
**Supabase Dashboard ‚Üí Project Settings ‚Üí API Keys**.

```bash
cp .env.example .env.local
```

| Variable | Scope | Where to get it |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | `https://nvjhyzqbfmnzohlvgdca.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser | Settings ‚Üí API Keys ‚Üí Publishable (`sb_publishable_‚Ä¶`). The legacy `anon` key also works. |
| `SUPABASE_SECRET_KEY` | Backend only | Settings ‚Üí API Keys ‚Üí Secret (`sb_secret_‚Ä¶`). **Never** add a `VITE_` prefix. |
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

Migrations are additive, idempotent and non-destructive. **They are not applied
yet** ‚Äî the hosted project currently has no tables.

### Option A ‚Äî Supabase CLI (recommended)

Needs a **personal access token** (Dashboard ‚Üí Account ‚Üí Access Tokens), which is
separate from the API keys above.

```bash
supabase login
supabase link --project-ref nvjhyzqbfmnzohlvgdca
supabase db push          # applies 0001, 0002, 0003
```

### Option B ‚Äî SQL editor (no access token)

Paste the three files from `supabase/migrations/` into the dashboard's SQL
editor **in order** and run them:

1. `0001_core_schema.sql`
2. `0002_rpc.sql`
3. `0003_bootstrap_admin.sql`

Both options are safe to re-run: every statement is `if not exists` /
`create or replace` / `drop policy if exists ‚Ä¶ create policy`.

Before pushing, read `docs/DATABASE_INSPECTION.md`. If a `students` table is ever
imported with duplicate admission numbers, the unique index is skipped with a
warning ‚Äî resolve the duplicates and re-run `0001`.

## 5. Create the first administrator

1. Create a user in **Authentication ‚Üí Users** (or let them sign up).
2. Promote them once, from the SQL editor (runs as `service_role`):

```sql
select public.bootstrap_admin('admin@university.edu');
```

The function refuses to run if an administrator already exists. After this, all
further role changes happen in **Admin ‚Üí Users**.

## 6. Deploy the Edge Function (optional)

The function uses `@supabase/server` (`withSupabase`) for JWT verification, client
creation and CORS. On Edge Functions it is imported directly with no install
step:

```ts
import { withSupabase } from 'npm:@supabase/server@1'
```

It is also a dev dependency (`npm install @supabase/server`) so it type-checks
and can run locally with `deno serve`.

```bash
supabase secrets set SUPABASE_SECRET_KEY=sb_secret_... \
                     KHURUJ_ALLOWED_ORIGIN=https://your-frontend-origin
supabase functions deploy report-summary
```

`SUPABASE_URL` and the publishable key are provided automatically to Edge
Functions; only the secret key and the allowed origin need to be set.

`verify_jwt = true` is correct here because the function uses `auth: 'user'`. If
you add a function using `auth: 'publishable'`, `'secret'` or `'none'`, set
`verify_jwt = false` for that function in `supabase/config.toml`, otherwise the
platform rejects the request before the handler runs.

To run the function locally against the live project:

```bash
deno serve -A --port 8787 supabase/functions/report-summary/index.ts
```

## 7. Configure Auth redirects

In **Authentication ‚Üí URL Configuration**, set the Site URL and add your frontend
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

## 9c. Local demo data (optional)

To try the whole workflow without touching real student records, run the seed
against a **local** Supabase stack. It creates one account per role and three
students whose admission numbers are the barcode values on their ID cards.

```bash
supabase start
supabase db reset          # applies migrations, then supabase/seed.sql
```

Every demo account uses the password `Khuruj#2026`:

| Email | Role |
| --- | --- |
| `admin@khuruj.test` | admin |
| `mentor@khuruj.test` | mentor (afternoon outings) |
| `teacher@khuruj.test` | class teacher (going home) |
| `medical@khuruj.test` | medical approver |
| `duty@khuruj.test` | duty teacher (Thursday/Friday) |
| `gate@khuruj.test` | gate security |
| `student@khuruj.test` | student ‚Äî `2023CS1042` |
| `student2@khuruj.test` | student ‚Äî `2023EC2087` |
| `student3@khuruj.test` | student ‚Äî `2022ME3311` |

`supabase/seed.sql` is demo data for a local stack only. Never run it against a
hosted project that holds real records. The seed is re-runnable: it reuses any
account that already exists and never deletes data.

## 10. Deploy the frontend (Vercel)

The Vercel project `khuruj` builds the app from `main` and serves it at
`https://khuruj.vercel.app`. Vite reads environment variables at **build time**,
and only exposes names prefixed with `VITE_` to the browser. The deploy therefore
needs its own `VITE_`-prefixed variables; the plain `SUPABASE_*` names already in
the project are not visible to client code.

Set these on the Vercel project (Settings → Environment Variables), for both
Production and Preview:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://nvjhyzqbfmnzohlvgdca.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
| `VITE_CAMPUS_TZ` | `Asia/Kolkata` (optional; defaults to this) |

The publishable key is designed for the browser and is safe here. Never add a
`VITE_` prefix to `SUPABASE_SECRET_KEY` — that would ship the secret to every
visitor. The Edge Function reads the secret from its own Supabase secrets.

Adding a variable does not rebuild the site. Redeploy after any change:

```bash
vercel --prod          # or: Deployments → Redeploy (uncheck "use existing build")
```

**Symptom of a missing variable:** the login page shows "Supabase is not
configured", because `isSupabaseConfigured` was resolved to false during the
build. Confirm with:

```bash
curl -s https://khuruj.vercel.app/ | grep -o '/assets/index-[^"]*\.js'
curl -s https://khuruj.vercel.app/assets/<that-file> | grep -c nvjhyzqbfmnzohlvgdca
```

A count of `0` means the build had no `VITE_SUPABASE_URL`. A configured build
contains the URL.

## 11. Remaining configuration tasks

- [x] Provide the publishable and secret keys (configured in `.env.local`,
      which is git-ignored; the secret key is backend-only).
- [ ] Inspect the live schema and confirm the barcode column name
      (`docs/DATABASE_INSPECTION.md`).
- [ ] Resolve duplicate admission numbers, if any.
- [ ] Run the manual test plan (`docs/TEST_PLAN.md`).
- [ ] Seed administrators and link real student accounts on the hosted project.
      Demo accounts already exist for the local stack (`9c` above).
- [ ] Set the production origin in Auth redirects and in
      `KHURUJ_ALLOWED_ORIGIN`.
