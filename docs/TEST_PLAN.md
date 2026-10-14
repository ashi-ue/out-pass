# Khuruj — manual test plan

These scenarios must be run against the live Supabase project before the system
is considered working. Each maps to a rule in the brief.

## Setup

1. Apply migrations (see `docs/SETUP.md`).
2. Create one auth user per role and grant the role in **Admin → Users**.
3. Link the student user to a student row with a known admission number.
4. Sign in as each user in a separate browser profile.

## A. Approval permissions

| # | Steps | Expected |
| --- | --- | --- |
| A1 | Mentor opens a `going_home` request | It is not in their inbox; opening the URL directly is denied or shows no decision controls. |
| A2 | Mentor approves an `afternoon_out` request | Succeeds; status becomes `approved`, `approver_role` = `mentor`. |
| A3 | Class teacher approves a `going_home` request | Succeeds. |
| A4 | Medical approver approves a `medical` request with no reason | Rejected with `REASON_REQUIRED`. |
| A5 | Duty teacher approves a `thursday_friday` request starting on a Wednesday | Rejected with `INVALID_DAY`. |
| A6 | Approver calls `approve_pass_request` for another type via the API (curl) | `FORBIDDEN`. |
| A7 | Student calls `approve_pass_request` on their own request | `FORBIDDEN` / `SELF_APPROVAL_FORBIDDEN`. |
| A8 | Approve an already-decided request | `ALREADY_DECIDED`. |
| A9 | Reject without remarks | `REMARKS_REQUIRED`. |

## B. Gate workflow

| # | Steps | Expected |
| --- | --- | --- |
| B1 | Scan an unapproved pass | Gate-Out disabled; warning shown. |
| B2 | Gate-Out on an approved, in-window pass | Succeeds; confirmation shown; student appears under "Students outside". |
| B3 | Immediately scan again and press Gate-Out | Blocked with "already outside". |
| B4 | Call `record_gate_out` twice via curl | Second call raises `ALREADY_OUTSIDE`. |
| B5 | Gate-In while on campus | Blocked with `NOT_OUTSIDE`. |
| B6 | Gate-In after a valid Gate-Out | Succeeds; student leaves the "outside" list. |
| B7 | Call `record_gate_in` as a student | `FORBIDDEN`. |
| B8 | Scan a student with no approved pass who is on campus | No Gate-Out; message explains why. |

## C. Expiry

| # | Steps | Expected |
| --- | --- | --- |
| C1 | Gate-Out on an expired approved pass | `PASS_EXPIRED`; departure refused. |
| C2 | Gate-In for a student outside with an expired pass | **Succeeds.** Gate-In must remain available after expiry. |
| C3 | Admin dashboard with an outside student whose pass expired | Row highlighted; counted under "Overdue returns". |

## D. Duplicate scans

| # | Steps | Expected |
| --- | --- | --- |
| D1 | Hold a barcode in front of the camera for several seconds | Exactly one lookup (2.5s de-duplication window). |
| D2 | Scan the same card twice quickly | One lookup. |
| D3 | Clear, then scan the same card again | A fresh lookup occurs. |

## E. Data integrity

| # | Steps | Expected |
| --- | --- | --- |
| E1 | Submit a request with no purpose | `PURPOSE_REQUIRED`. |
| E2 | Submit with return before departure | `INVALID_WINDOW`. |
| E3 | Attempt to insert `pass_requests` directly via PostgREST | Denied by RLS (no insert policy). |
| E4 | Attempt to insert `gate_events` directly | Denied by RLS. |
| E5 | Attempt to read `audit_log` as a non-admin | Denied. |
| E6 | Read another student's pass as a student | Denied. |
| E7 | Re-run migration `0001` | Completes without error; no data loss. |
| E8 | Check `audit_log` after A–C | Contains `pass_request_approved`, `pass_request_rejected`, `gate_out`, `gate_in` rows. |

## F. Role management

| # | Steps | Expected |
| --- | --- | --- |
| F1 | Non-admin calls `admin_set_user_role` | `FORBIDDEN`. |
| F2 | Admin revokes the last admin role | `LAST_ADMIN`. |
| F3 | Admin grants and revokes a role | Succeeds; `role_granted` / `role_revoked` appear in the audit log. |

## Automated coverage

Three suites back this plan. All of them must pass before a change ships.

| Suite | Command | Covers | Last result |
| --- | --- | --- | --- |
| Database | `./supabase/tests/run.sh` | Real RPCs and RLS: role scoping, expired passes, duplicate Gate-Out, Gate-In after expiry, audit rows (rules 1–10, E1–E8, F1–F3) | 43 / 43 |
| Frontend unit | `npm run test:run` | Role helpers, pass-validity maths, error messages, route guards | 25 / 25 |
| Browser workflow | Playwright (see below) | Sign-in per role, submit → approve → Gate-Out → Gate-In, expired pass, unknown barcode | 17 / 17 |

The browser workflow drives the real UI against a local stack: sign in as each
role, submit an afternoon outing as a student, approve it as the owning mentor,
look the student up at the gate by barcode, record Gate-Out, confirm the
already-outside warning, then record Gate-In and check the admin audit log.
