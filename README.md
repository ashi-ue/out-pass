# Khuruj · خروج

A university digital student **out-pass and gate-management** system, built to
complement the existing **Shuhood (شهود)** attendance system.

Khuruj manages the full out-pass lifecycle — request, approval, gate exit and
return — using the barcode already on each student's ID card.

## What it does

- **Students** submit out-pass requests and follow their status and history.
- **Approvers** (mentor, class teacher, medical approver, duty teacher) decide
  the request types they own.
- **Gate security** scans an ID card (or types the admission number), verifies
  the pass, and explicitly records **Gate-Out** and **Gate-In**.
- **Administrators** see who is outside, pending approvals, active passes,
  overdue returns, and a complete audit log.

## Core guarantees

1. Approval does **not** mean the student has left campus.
2. Scanning a card only identifies the student — it never records an exit.
3. Gate-Out and Gate-In are separate, explicit, audited actions.
4. Duplicate exits, returns without an exit, and unauthorized gate actions are
   blocked by the database.
5. An expired pass cannot authorize a departure, but Gate-In still works.
6. Approval status and physical campus status are tracked separately.
7. Every permission is enforced server-side; the UI only reflects it.

## Stack

React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · Supabase (Auth, Postgres,
RLS, Edge Functions) · `@zxing/browser` for barcode scanning.

## Quick start

```bash
npm install
cp .env.example .env.local     # add the Supabase keys
npm run dev                    # http://localhost:12000
```

Then apply the migrations and create the first administrator — see
**[docs/SETUP.md](docs/SETUP.md)**.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Environment variables, migrations, first admin, deployment |
| [docs/DATABASE_INSPECTION.md](docs/DATABASE_INSPECTION.md) | What was inspected, findings, safe-migration strategy |
| [docs/BACKEND.md](docs/BACKEND.md) | Security model, role matrix, what was verified |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Manual test scenarios for every rule |

## Brand

Deep navy `#0B1F3A`, teal blue `#1095AB`, white and light grey. The logo lives at
`public/khuruj-logo.png`.

## Repository layout

```
src/
  auth/          session, roles, route guards
  components/    layout and UI primitives
  lib/           Supabase client, API, types, time, errors
  pages/         login, student, approver, gate, admin
  test/          unit tests
supabase/
  migrations/    versioned, additive schema + RLS + RPCs
  functions/     Edge Functions (secret key, server-side only)
docs/            setup, inspection, backend, test plan
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
