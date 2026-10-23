#!/usr/bin/env bash
# Smoke test of the BUILT API image (Phase 1.5, task 4). Runs in CI (.github/workflows/ci.yml, job
# "docker") and locally wherever Docker and a PostgreSQL 15+ are available.
#
#   IMAGE=gobye-api:abc1234 ADMIN_URL=postgres://admin:pw@127.0.0.1:5432/postgres apps/api/scripts/docker-smoke.sh
#
# ADMIN_URL: a role that may CREATE DATABASE and CREATE ROLE (like Supabase's `postgres`). The script
# creates a throwaway database, runs roles.sql, the migrations FROM THE IMAGE, grants.sql, then checks:
#   1. invalid configuration exits 78 (EX_CONFIG) and prints which variable is wrong, no secrets;
#   2. the image runs as a non-root user and contains no TypeScript sources or build-only packages;
#   3. migrate status/up and check-runtime work from the image (runtime role timeouts, no DDL);
#   4. the API starts, /health/live and /health/ready are 200, envelopes and headers are right
#      (scripts/health-check.mjs, run from the image), Docker's HEALTHCHECK turns healthy;
#   5. readiness is 503 while the database is unreachable;
#   6. SIGTERM stops the API and the worker cleanly (exit 0) within the grace period.
# Test-only passwords below are not secrets (local throwaway database).
set -euo pipefail

: "${IMAGE:?set IMAGE}"
: "${ADMIN_URL:?set ADMIN_URL}"
PORT=${PORT:-18080}
HERE=$(cd "$(dirname "$0")/.." && pwd)
DB="gobye_smoke_$(date +%s)"
API_PW=gobye_api_local_only
MIG_PW=gobye_migrator_local_only
pass=0
fail=0
ok() { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }
url_for() { # user password -> URL of the smoke database
  python3 - "$ADMIN_URL" "$DB" "$1" "$2" <<'PY'
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); host = p.hostname; port = p.port or 5432
print(f"postgres://{sys.argv[3]}:{u.quote(sys.argv[4])}@{host}:{port}/{sys.argv[2]}")
PY
}
admin_db=$(python3 -c "import sys,urllib.parse as u;p=u.urlsplit(sys.argv[1]);print(p._replace(path='/'+sys.argv[2]).geturl())" "$ADMIN_URL" "$DB")
cleanup() {
  docker rm -f gobye-smoke-api gobye-smoke-worker >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -X -q -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
run() { docker run --rm --network host "$@"; }
COMMON=(-e APP_ENV=development -e DATABASE_SSL=disable -e ORIGIN_AUTH_REQUIRED=false -e STAFF_REQUIRE_MFA=false -e PORT="$PORT")

echo "== Image: $IMAGE"
docker image inspect "$IMAGE" --format 'size={{.Size}} user={{.Config.User}} created={{.Created}}'

# 1. Invalid configuration
set +e
out=$(run -e APP_ENV=production -e DATABASE_URL='postgres://u:very-secret-value@h:5432/d' "$IMAGE" 2>&1); code=$?
set -e
[ "$code" = 78 ] && ok "invalid production config exits 78" || bad "invalid config exit code $code (want 78)"
echo "$out" | grep -q 'DATABASE_SSL\|ORIGIN_AUTH_SECRET\|SUPABASE_URL' && ok "config errors name the variables" || bad "config errors do not name variables"
echo "$out" | grep -q 'very-secret-value' && bad "config error printed a secret" || ok "config error printed no secret"

# 2. Non-root, no sources
[ "$(run --entrypoint id "$IMAGE" -u)" != 0 ] && ok "runs as non-root ($(run --entrypoint id "$IMAGE" -un))" || bad "runs as root"
run --entrypoint sh "$IMAGE" -c 'test ! -d apps/api/src && test -z "$(find / -xdev -name "*.ts" -path "*/apps/api/*" 2>/dev/null | grep -v node_modules | head -1)"' && ok "no TypeScript sources in the image" || bad "sources found in the image"

run --entrypoint sh "$IMAGE" -c 'for p in typescript tsc-alias braces micromatch @types/node jest eslint; do [ -e node_modules/$p ] || [ -e apps/api/node_modules/$p ] && { echo "dev package in image: $p"; exit 1; }; done; exit 0' && ok "no build-only packages in the image (pruned to the runtime graph)" || bad "build-only packages found in the image"

# 3. Database: roles, migrations from the image, grants, runtime check
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
psql "$admin_db" -X -q -v ON_ERROR_STOP=1 -v migrator_password="$MIG_PW" -v api_password="$API_PW" -f "$HERE/db/roles.sql"
MIG_URL=$(url_for gobye_migrator "$MIG_PW")
API_URL=$(url_for gobye_api "$API_PW")
run "${COMMON[@]}" -e DATABASE_URL="$MIG_URL" "$IMAGE" node apps/api/dist/apps/api/src/migrate.js up && ok "migrations applied from the image" || bad "migrate up failed"
psql "$MIG_URL" -X -q -v ON_ERROR_STOP=1 -f "$HERE/db/grants.sql"
run "${COMMON[@]}" -e DATABASE_URL="$MIG_URL" "$IMAGE" node apps/api/dist/apps/api/src/migrate.js status | grep -q 'Pending: none' && ok "migrate status: nothing pending" || bad "migrate status"
run "${COMMON[@]}" -e DATABASE_URL="$API_URL" "$IMAGE" node apps/api/dist/apps/api/src/migrate.js check-runtime && ok "check-runtime: role timeouts, no DDL, bypassrls" || bad "check-runtime"

# 4. API up, health checks from the image, Docker HEALTHCHECK
docker run -d --name gobye-smoke-api --network host "${COMMON[@]}" -e APP_VERSION=smoke -e DATABASE_URL="$API_URL" -e WORKER_ENABLED=true "$IMAGE" >/dev/null
run --entrypoint node "$IMAGE" apps/api/scripts/health-check.mjs "http://127.0.0.1:$PORT" --expect-version smoke --wait 60 --allow-degraded && ok "health-check.mjs (live, ready=degraded: no Supabase signing keys in a smoke test; version, headers, envelopes)" || bad "health-check.mjs"
for _ in $(seq 1 40); do st=$(docker inspect -f '{{.State.Health.Status}}' gobye-smoke-api); [ "$st" = healthy ] && break; sleep 1; done
[ "$st" = healthy ] && ok "Docker HEALTHCHECK healthy" || bad "Docker HEALTHCHECK: $st"
mem=$(docker stats --no-stream --format '{{.MemUsage}}' gobye-smoke-api); echo "info  API memory after start: $mem"

# 5. Readiness 503 while the database is unreachable
docker run -d --name gobye-smoke-worker --network host "${COMMON[@]}" -e DATABASE_URL="postgres://gobye_api:x@127.0.0.1:1/none" -e PORT=$((PORT + 1)) "$IMAGE" >/dev/null
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$((PORT + 1))/health/live" >/dev/null 2>&1 && break; sleep 1; done
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((PORT + 1))/health/ready")
[ "$code" = 503 ] && ok "ready is 503 with no database (live stays 200)" || bad "ready with no database: $code"
docker rm -f gobye-smoke-worker >/dev/null

# 6. Graceful stop: API (with in-process worker), then a standalone worker
t0=$(date +%s); docker stop -t 20 gobye-smoke-api >/dev/null; t1=$(date +%s)
code=$(docker inspect -f '{{.State.ExitCode}}' gobye-smoke-api)
[ "$code" = 0 ] && ok "API stopped cleanly on SIGTERM in $((t1 - t0))s" || bad "API exit code after SIGTERM: $code"
docker logs gobye-smoke-api 2>&1 | grep -q 'Shutting down' && ok "API logged the shutdown" || bad "no shutdown log"
docker run -d --name gobye-smoke-worker --network host "${COMMON[@]}" -e DATABASE_URL="$API_URL" "$IMAGE" node apps/api/dist/apps/api/src/worker.js >/dev/null
sleep 3
t0=$(date +%s); docker stop -t 20 gobye-smoke-worker >/dev/null; t1=$(date +%s)
code=$(docker inspect -f '{{.State.ExitCode}}' gobye-smoke-worker)
[ "$code" = 0 ] && ok "worker stopped cleanly on SIGTERM in $((t1 - t0))s" || bad "worker exit code after SIGTERM: $code"

echo "== $pass passed, $fail failed"
[ "$fail" = 0 ]
