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

# Without this guard a missing daemon makes every step fail silently and the
# runner still prints "ALL DATABASE TESTS PASSED" — a green result for a run
# that never happened.
if ! $DOCKER info >/dev/null 2>&1; then
  echo "==> Docker is not available; cannot run the database tests." >&2
  exit 2
fi

cleanup() { $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting $IMAGE as $CONTAINER"
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
$DOCKER run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

started=0
for _ in $(seq 1 60); do
  if $DOCKER exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    started=1
    break
  fi
  sleep 1
done

if [ "$started" -ne 1 ]; then
  echo "==> Postgres did not become ready in $CONTAINER" >&2
  exit 2
fi

run_sql() {
  $DOCKER exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q < "$1"
}

echo "==> applying harness and migrations"
# A failure here must stop the run: otherwise the tests execute against a
# half-built schema and the summary is meaningless.
if ! run_sql "$HERE/00_harness.sql"; then
  echo "==> harness failed to apply" >&2
  exit 2
fi
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  if ! run_sql "$f"; then
    echo "==> $(basename "$f") failed to apply" >&2
    exit 2
  fi
done

echo "==> running security tests"
# The suite raises at the end when any check fails, but psql reports that as a
# plain error line rather than a non-zero exit, so match the sentinel too.
output="$($DOCKER exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=0 < "$HERE/10_security_tests.sql" 2>&1)"
printf '%s\n' "$output"
status=0
if printf '%s' "$output" | grep -q 'KHURUJ TESTS FAILED'; then
  status=1
fi

# Guard against a run that never reached the summary (e.g. the suite file failed
# to parse): no results banner means no verdict, so treat it as a failure.
if ! printf '%s' "$output" | grep -q 'Khuruj test results'; then
  echo "==> The test suite did not run to completion" >&2
  status=2
fi

if [ $status -eq 0 ]; then
  echo "==> ALL DATABASE TESTS PASSED"
else
  echo "==> DATABASE TESTS FAILED"
fi
exit $status
