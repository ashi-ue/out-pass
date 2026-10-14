# AGENTS.md

Repository-specific knowledge for Khuruj (خروج), a university out-pass and
gate-management app that complements the Shuhood (شهود) attendance system.

## Commands

```bash
npm install
npm run dev            # http://localhost:12000
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run test:run       # vitest, frontend unit tests
npm run build          # tsc --noEmit && vite build

./supabase/tests/run.sh   # database tests in a throwaway Postgres (needs Docker)
```

Run `supabase/tests/run.sh` after **any** migration change. It applies the real
migrations to PostgreSQL 17 and checks 43 security rules; it exits non-zero on
failure. It never touches the hosted project.

## Layout

- `src/auth/` — session, roles, route guards. `useAuth` lives in `context.ts`,
  not `AuthProvider.tsx`, so the provider file only exports a component
  (react-refresh rule).
- `src/lib/` — Supabase client, API wrappers, types, timezone helpers, error
  translation.
- `supabase/migrations/` — `0001` schema + RLS, `0002` privileged RPCs,
  `0003` first-admin bootstrap.
- `supabase/tests/` — `00_harness.sql` fakes the Supabase environment, then the
  test suite runs.

## Invariants — do not break these

1. **All sensitive writes go through `SECURITY DEFINER` RPCs.** `pass_requests`,
   `gate_events`, `student_campus_status` and `audit_log` have no INSERT/UPDATE
   policy for clients. Never add one.
2. **Roles are read from `public.user_roles` on the server.** Never trust a
   role, approval status or gate status sent from the client.
3. **`app.can_decide` must fail closed.** It returned `NULL` historically, and
   `if not NULL` is `NULL`, so the guard was skipped and anyone could approve.
   Keep the `is not null` check. `src/auth/roles.ts` mirrors this — a populated
   rule set with a missing type means "no".
4. **Approval ≠ left campus.** `approve_pass_request` must never touch
   `student_campus_status`. Only `record_gate_out` does.
5. **Gate-In must work after expiry.** `record_gate_in` never checks
   `valid_until`. `record_gate_out` does.
6. **Gate events are audited by trigger**, not by the RPC, so exactly one audit
   row is written per movement regardless of insert path.
7. **Never regenerate a student barcode.** `admission_number` is the ID-card
   barcode value and is the join key everywhere.
8. **Migrations are additive and idempotent.** No `DROP`/`TRUNCATE` on
   pre-existing data. The unique index on `admission_number` is skipped with a
   warning if legacy duplicates exist.

## Gotchas

- Tailwind v4 cannot `@apply` a custom class from another custom class. Button
  variants in `src/index.css` each repeat the shared base utilities.
- `truncate ... cascade` on `auth.users` also empties `approval_rules` and
  `app_settings` (they have FKs to it). Re-seed them in test fixtures.
- Trigger functions must not reference a column that only exists on one of the
  tables they serve. `app.audit_config_change` reads keys via `to_jsonb(new)`
  because `approval_rules` has `request_type` and `app_settings` has `key`.
- Supabase secrets: only `VITE_`-prefixed vars reach the browser. The secret key
  is used exclusively by the Edge Function. `.env.local` is gitignored; never
  commit real keys.
- **The hosted project (`nvjhyzqbfmnzohlvgdca`) is empty** — no tables, no auth
  users, no buckets, Postgres 14.18. There is no Shuhood schema here to reuse.
  Re-verify with `GET /rest/v1/` (OpenAPI `definitions`) before assuming
  otherwise. See `docs/DATABASE_INSPECTION.md`.
- Edge Functions use `@supabase/server`: `withSupabase({ auth: 'user' }, …)`.
  The handler only runs after the JWT is verified against the project's JWKS.
  Keep reading roles from the **database** via `ctx.supabase`, not from
  `ctx.userClaims`. `verify_jwt = true` is right for `auth: 'user'`; any
  `'publishable'`/`'secret'`/`'none'` function needs `verify_jwt = false`.
- Applying migrations to the hosted project needs a **personal access token**
  (for `supabase db push`). The API keys alone are not enough; the dashboard SQL
  editor is the no-token path.
- **Vite env precedence beats `.env.local`.** A `VITE_SUPABASE_URL` exported in
  the shell overrides the file, so the dev server silently serves the hosted URL
  and every login fails with `invalid_credentials` against the wrong project.
  `unset` those vars (or restart the shell) before `npm run dev` when switching
  between the local stack and the hosted project.
- **Never redirect on `ready` alone.** `ready` is true as soon as the session is
  known, but roles load in a separate query. Redirecting then runs against an
  empty role list and sends everyone to `/student`. Gate redirects on
  `identityReady` (session **and** roles loaded). `src/test/routing.test.tsx`
  covers this; it fails if you revert to `ready`.
- **Seed the cache from mutation results.** A decision mutation that only calls
  `invalidateQueries` leaves the badge on the old value until a refetch lands;
  if the page remounts first, the update is lost and the UI disagrees with the
  database. Call `setQueryData` with the RPC's returned row, then invalidate.
  `src/test/passDetailDecision.test.tsx` freezes reads after the click so the
  badge can only come from the mutation result.
- **The Vercel deploy needs `VITE_`-prefixed vars, and a redeploy to apply
  them.** Vite inlines `import.meta.env` at build time and exposes only `VITE_`
  names to the browser. The `khuruj` Vercel project also has plain
  `SUPABASE_*`/`NEXT_PUBLIC_*` vars, which client code cannot see — so a build
  without `VITE_SUPABASE_URL` bakes in "Supabase is not configured" and the
  login form stays disabled. Setting a variable does not rebuild; trigger a
  production redeploy. `docs/SETUP.md` §10 has the exact vars and a `curl` check
  against the deployed bundle.

## Local demo data and browser testing

- `supabase/seed.sql` creates one account per role and three students with
  barcode admission numbers. Password for every account: `Khuruj#2026`. Apply
  with `supabase db reset`. Local only — never run it against the hosted project.
- To exercise the UI for real, drive Chromium with Playwright
  (`/usr/bin/chromium`, args `--no-sandbox`). Synthetic typing does reach the
  React controlled login inputs; no session injection is needed.
- The default `GITHUB_TOKEN` in this environment is a **read-only** GitHub App
  installation token: it can read the repo but pushing or opening PRs returns
  `403 Resource not accessible by integration`. Use the PAT supplied by the user
  for writes, and re-point `origin` back to the credential-free URL afterwards.
