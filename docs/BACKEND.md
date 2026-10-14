# Khuruj — backend design & verification

This document explains how the security model works and exactly what was
verified, so nothing is claimed that has not been tested.

## 1. Where secrets live

| Key | Where it is used | Reaches the browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` | Yes (public) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase.ts` | Yes (public, RLS-guarded) |
| `SUPABASE_SECRET_KEY` | Edge Function only (`Deno.env`) | **Never** |

The frontend never imports the secret key. `src/lib/supabase.ts` reads only
`VITE_`-prefixed variables. The secret key is set with
`supabase secrets set`, which stores it server-side.

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

## 5. What was verified locally

Run with Node 24 / npm 11.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Passes, 0 errors |
| Lint | `npm run lint` | Passes, 0 errors / 0 warnings |
| Production build | `npm run build` | Succeeds |
| Frontend unit tests | `npm run test:run` | 19 tests pass across 3 files |
| Database tests | `supabase/tests/run.sh` | **43/43 pass** on PostgreSQL 17 |

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

### Not yet verified (needs live credentials)

The database logic, RLS and RPCs are verified against a real PostgreSQL 17
instance. What remains needs the hosted Supabase project's keys and could **not**
be executed here:

1. Applying the migrations to the hosted project (`supabase db push`) and
   confirming they coexist with the existing Shuhood schema.
2. Inspecting the live `students` table to confirm the barcode column name.
3. Supabase Auth sign-in flow and JWT claims against the real project.
4. The browser camera path for barcode scanning (needs a camera and HTTPS).
5. The Edge Function deployed with a real secret key.

The manual test plan in `docs/TEST_PLAN.md` covers these.
