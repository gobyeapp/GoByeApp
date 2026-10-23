#!/usr/bin/env sh
# Starts the test pooler in the background (needs `pgbouncer` installed; run from anywhere).
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
work=${TMPDIR:-/tmp}/gobye-pgbouncer
mkdir -p "$work"
cp "$dir/pgbouncer.ini" "$dir/userlist.txt" "$work/"
cd "$work"
[ -f pgbouncer.pid ] && kill "$(cat pgbouncer.pid)" 2>/dev/null || true
if [ "$(id -u)" = 0 ]; then
  # PgBouncer refuses to run as root (local containers); use the postgres account.
  chown -R postgres "$work" && runuser -u postgres -- pgbouncer -d pgbouncer.ini
else
  pgbouncer -d pgbouncer.ini
fi
echo "PgBouncer (transaction mode) on 127.0.0.1:6432; export TEST_POOLER_URL=postgres://127.0.0.1:6432"
