#!/usr/bin/env bash
#
# Khuruj backend setup: apply the latest migration and deploy the admin-users
# Edge Function to the hosted Supabase project.
#
# Both steps are idempotent, so re-running this script is safe.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/deploy-backend.sh
#
# The token is a Supabase personal access token, created at
# https://supabase.com/dashboard/account/tokens
# It is read from the environment only and never written to disk.
#
# Applying the migration needs only the token (it goes through the Management
# API). Deploying the function additionally needs the Supabase CLI; if that is
# missing the script says so and prints the dashboard alternative.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_ID:-nvjhyzqbfmnzohlvgdca}"
API="${SUPABASE_API_BASE:-https://api.supabase.com/v1/projects/${PROJECT_REF}}"
MIGRATION="supabase/migrations/0006_teacher_roles_and_student_fields.sql"
FUNCTION="admin-users"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  cat >&2 <<'EOF'
error: SUPABASE_ACCESS_TOKEN is not set.

Create a personal access token at
  https://supabase.com/dashboard/account/tokens
then re-run:
  SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/deploy-backend.sh
EOF
  exit 1
fi

if [[ ! -f "$MIGRATION" ]]; then
  echo "error: $MIGRATION not found. Run this script from the repository root." >&2
  exit 1
fi

# Sends SQL read from stdin to the Management API and prints the response body.
run_sql() {
  python3 -c 'import json, sys; print(json.dumps({"query": sys.stdin.read()}))' \
    > /tmp/khuruj_query.json
  local code
  code=$(curl -sS -o /tmp/khuruj_sql.out -w '%{http_code}' \
    -X POST "${API}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data @/tmp/khuruj_query.json)
  rm -f /tmp/khuruj_query.json
  if [[ "$code" != "200" && "$code" != "201" ]]; then
    echo "error: SQL request failed (HTTP $code):" >&2
    cat /tmp/khuruj_sql.out >&2
    rm -f /tmp/khuruj_sql.out
    return 1
  fi
  cat /tmp/khuruj_sql.out
  rm -f /tmp/khuruj_sql.out
}

echo "==> Project ${PROJECT_REF}"

echo "==> Applying ${MIGRATION}"
run_sql < "$MIGRATION" > /dev/null
echo "    done"

echo "==> Deploying the ${FUNCTION} Edge Function"
if command -v supabase >/dev/null 2>&1; then
  supabase functions deploy "$FUNCTION" --project-ref "$PROJECT_REF"
else
  cat >&2 <<EOF
    The Supabase CLI is not installed, so the function was NOT deployed.

    Either install it (https://supabase.com/docs/guides/cli) and re-run this
    script, or deploy from the dashboard:
      Edge Functions -> Deploy a new function -> name it "${FUNCTION}"
      and paste the contents of supabase/functions/${FUNCTION}/index.ts
EOF
fi

echo "==> Verifying"
probe=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION}" \
  -H 'Content-Type: application/json' -d '{}')
case "$probe" in
  400|401|403)
    echo "    ${FUNCTION}: reachable (HTTP ${probe}, unauthenticated probe rejected)" ;;
  404)
    echo "    ${FUNCTION}: NOT deployed (HTTP 404)" >&2 ;;
  *)
    echo "    ${FUNCTION}: unexpected HTTP ${probe}" >&2 ;;
esac

sig=$(run_sql <<'SQL'
select count(*)::int as n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.proname = 'admin_upsert_student'
   and p.pronargs = 8;
SQL
)
case "$sig" in
  *'[{"n": 1}]'*|*'[{"n":1}]'*)
    echo "    admin_upsert_student: current (8 arguments)" ;;
  *)
    echo "    admin_upsert_student: migration not applied yet (response: ${sig})" >&2 ;;
esac
