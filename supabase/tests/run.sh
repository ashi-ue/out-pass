#!/usr/bin/env bash
# Run the Khuruj database tests against a throwaway local Postgres.
#
# The migrations reference Supabase-provided objects (auth.users, auth.uid(),
# the anon/authenticated/service_role roles), so the harness recreates the
# minimum of that environment. Nothing here touches the hosted project.
#
# Usage:  supabase/tests/run.sh
# Requires Docker.

set -uo pipefail

CONTAINER="${KHURUJ_TEST_CONTAINER:-khuruj-pg-test}"
IMAGE="${KHURUJ_TEST_IMAGE:-postgres:17}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

cleanup() { $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting $IMAGE as $CONTAINER"
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
$DOCKER run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  $DOCKER exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

run_sql() {
  $DOCKER exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q < "$1"
}

echo "==> applying harness and migrations"
run_sql "$HERE/00_harness.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  run_sql "$f"
done

echo "==> running security tests"
$DOCKER exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=0 < "$HERE/10_security_tests.sql"
status=$?

if [ $status -eq 0 ]; then
  echo "==> ALL DATABASE TESTS PASSED"
else
  echo "==> DATABASE TESTS FAILED"
fi
exit $status
