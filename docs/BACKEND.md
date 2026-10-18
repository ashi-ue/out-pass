# Khuruj — backend design & verification

This document explains how the security model works and exactly what was
verified, so nothing is claimed that has not been tested.

## 1. Where secrets live

| Key | Where it is used | Reaches the browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` | Yes (public) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase.ts` | Yes (public, RLS-guarded) |
| `SUPABASE_SECRET_KEY` | Edge Function only (runtime env) | **Never** |

The frontend never imports the secret key. `src/lib/supabase.ts` reads only
`VITE_`-prefixed variables. The secret key is set with
`supabase secrets set`, which stores it server-side.

`.env.local` holds the real values and is gitignored (`*.local`). `.env.example`
is the committed template and contains placeholders only. A repo-wide scan
confirms no real key value appears in any tracked file.

### Edge Function auth with `@supabase/server`

`supabase/functions/report-summary/index.ts` uses `withSupabase` from
`@supabase/server`, which replaces the hand-rolled JWT verification that was
previously in this function:

```ts
export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => { … }),
}
```

`auth: 'user'` verifies the caller's JWT (against the project's JWKS) *before*
the handler runs, so the handler is never reached without a valid identity. The
context provides `ctx.supabase` (RLS-scoped) and `ctx.supabaseAdmin` (bypasses
RLS). The package also handles CORS.

Crucially, the caller's role is still read **from the database** through the
RLS-scoped client, not from JWT claims or the request body:

```ts
const { data: roles } = await ctx.supabase
  .from('user_roles').select('role').eq('user_id', ctx.userClaims?.id)
```

The `user_roles_select_self_or_admin` policy lets a user read their own roles, so
a non-admin simply sees no `admin` row and is rejected with `403`. The admin
client is only used after that check.

`verify_jwt = true` remains set for this function in `supabase/config.toml`,
which is correct for `auth: 'user'` — the platform-level JWT check and the
package's own verification agree. (For `auth: 'publishable'`, `'secret'` or
`'none'`, `verify_jwt` must be set to `false`.)

## 2. Why RPCs instead of direct table writes

Sensitive tables grant **no** `INSERT`/`UPDATE`/`DELETE` to clients:

- `pass_requests` — select-only for students/approvers/gate; all mutations via RPC.
- `gate_events` — select-only; rows are written only by `record_gate_out` /
  `record_gate_in`.
- `student_campus_status` — select-only; written only by the gate RPCs.
- `audit_log` — select for admins only; written only by triggers and helpers.

Because a forged request body cannot write these tables directly, the only way to
change state is through a `SECURITY DEFINER` function that re-checks the caller.

## 3. How each rule from the brief is enforced

| Rule | Enforcement |
| --- | --- |
| Approval ≠ left campus | `approve_pass_request` only sets `approval_status`; it never touches `student_campus_status`. |
| Scanning ≠ exit | `gate_lookup` is read-only. It returns student + pass + status and records nothing. |
| Explicit Gate-Out | `record_gate_out` requires an approved, in-window pass and inserts a `gate_out` event. |
| Separate Gate-In | `record_gate_in` is a distinct function requiring an open exit. |
| No duplicate exits | Partial unique index `gate_events_one_open_exit` on `(admission_number) where is_open_exit`, plus a `FOR UPDATE` lock on the status row. |
| No return without exit | `record_gate_in` raises `NOT_OUTSIDE` unless status is `outside`. |
| No unauthorized gate actions | Both gate RPCs call `app.has_role('gate_security','admin')`. |
| Warn if already outside | `gate_lookup` returns `campus_status`; the UI shows a warning and disables Gate-Out. |
| Expired pass blocks departure | `record_gate_out` raises `PASS_EXPIRED`. |
| Gate-In works after expiry | `record_gate_in` never checks `valid_until`. |
| Approval vs campus tracked separately | Two tables: `pass_requests.approval_status` and `student_campus_status.status`. |
| Auditable history | `audit_log` is append-only (no update/delete policy) and written by triggers for approvals, rejections, gate events and admin changes. |
| Backend validation | Every RPC re-reads roles via `app.has_role` / `app.can_decide`. |
| Consistent timestamps | Postgres `now()` (UTC) everywhere; display converts to the campus timezone. |

## 4. Role scope matrix

| Role | Can decide | Notes |
| --- | --- | --- |
| `class_teacher` | `going_home` | |
| `mentor` | `afternoon_out` | |
| `medical_approver` | `medical` | |
| `duty_teacher` | `thursday_friday` | |
| `admin` | any type | Also manages users, students, rules, audit. |
| `gate_security` | none | Gate-Out / Gate-In / lookup only. |
| `student` | none | Submits and views own requests. |

An approver who tries to decide a type outside their scope gets `FORBIDDEN` from
the database, regardless of what the UI shows. Nobody can decide their own
request (`SELF_APPROVAL_FORBIDDEN`).

## 5. What was verified

### Local (no credentials needed)

Run with Node 24 / npm 11.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Passes, 0 errors |
| Lint | `npm run lint` | Passes, 0 errors / 0 warnings |
| Production build | `npm run build` | Succeeds |
| Frontend unit tests | `npm run test:run` | 19 tests pass across 3 files |
| Database tests | `supabase/tests/run.sh` | **43/43 pass** on PostgreSQL 17 |
| Edge Function type-check | `deno check supabase/functions/report-summary/index.ts` | Passes, 0 errors |

### Against the live project (with the supplied keys)

| Check | Method | Result |
| --- | --- | --- |
| JWKS reachable | `GET /auth/v1/.well-known/jwks.json` | **200**, ES256 key returned |
| Publishable key valid | `POST /auth/v1/token` | **400** `invalid_credentials` (key accepted, Auth reachable) |
| Secret key valid | `GET /auth/v1/admin/users` | **200** |
| Frontend boots configured | login page in the browser | No "Supabase is not configured" warning |
| Live schema | OpenAPI + table probes | **Empty** — see `DATABASE_INSPECTION.md` |
| Edge Function, no credentials | `POST` to local `deno serve` | **401** — handler not reached |
| Edge Function, malformed JWT | `POST` with `Authorization: Bearer not.a.jwt` | **401** |
| Edge Function, **real JWT** | temp user created, signed in, token sent | Handler **ran** (returned `ROLE_LOOKUP_FAILED`, because `user_roles` does not exist yet) |

That last row is the important one: it proves the JWT is verified against the
live project's JWKS and the handler executes for a real signed-in user. The
`500 ROLE_LOOKUP_FAILED` is the correct, expected response on a database with no
schema — it is the role check failing to find its table, not an auth failure.
Once the migrations are applied it becomes `403 FORBIDDEN` for a non-admin.

The temporary user was deleted afterwards; the project is back to 0 users.

### Database tests

`supabase/tests/run.sh` starts a throwaway PostgreSQL 17 container, recreates the
minimum Supabase environment (`auth.users`, `auth.uid()`, the `anon` /
`authenticated` / `service_role` roles) in `00_harness.sql`, applies the three
migrations, then runs `10_security_tests.sql`. The suite exercises the real RPCs
and real RLS policies — no mocks. It exits non-zero if any check fails.

Covered: direct-write denial by RLS on all four protected tables, submission
validation, approval scope for every role, self-approval, fail-closed behaviour
when a rule is disabled, double decisions, rejection remarks, the full
Gate-Out/Gate-In cycle, duplicate exits, Gate-In without an exit, Gate-Out on
expired / not-yet-valid / unapproved passes, Gate-In after expiry, unknown
barcodes, role management and the last-admin guard, and audit-log capture.

### Bugs found and fixed during testing

1. **Fail-open authorization.** `app.can_decide` returned `NULL` when a request
   type had no active approval rule. Because `if not NULL` evaluates to `NULL`
   rather than `true`, the guard was skipped and *any* authenticated user could
   approve that request type. Fixed with an explicit `is not null` check so the
   function fails closed. The frontend mirror in `src/auth/roles.ts` was fixed
   the same way.
2. **Broken rule management.** `app.audit_config_change()` read `new.request_type`
   and `new.key` unconditionally, so the audit trigger raised
   `record "new" has no field "key"` on every write to `approval_rules` and
   `app_settings`. Administrators could not change any rule. Fixed by reading the
   key through `to_jsonb(new)`.
3. **Double-counted gate audit entries.** Gate movements were audited both by the
   RPC and by a trigger. Consolidated into a single trigger so exactly one audit
   row is written per movement.

### Not yet verified

1. **The migrations are not applied to the hosted project.** Applying them needs
   a Supabase personal access token for `supabase db push` (or pasting the SQL
   into the dashboard's SQL editor). The keys supplied do not include one. Until
   this is done, the app has no schema and no screen can load real data.
2. **The live `students` table is empty**, so no barcode resolves yet. See
   `DATABASE_INSPECTION.md` section 6.
3. **The gate reader is a keyboard-wedge scanner.** It types the barcode into
   the focused field, so the page only needs the scan input and a manual
   fallback. There is no camera path to configure, and no camera permission to
   grant.
4. **The Edge Function is not deployed.** It runs and authenticates correctly
   locally against the live JWKS, but `supabase functions deploy` also needs the
   access token.

The manual test plan in `docs/TEST_PLAN.md` covers these.
