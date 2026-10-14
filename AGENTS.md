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
  is used exclusively by the Edge Function.
