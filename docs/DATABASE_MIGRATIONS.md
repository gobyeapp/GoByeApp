# Database migrations: safe workflow (D-059)

**Status:** the runner, the five initial migrations and the role scripts are built and tested against PostgreSQL 16 (`apps/api/test/database.test.ts`, `pooler.test.ts`), directly and through PgBouncer. No Supabase database has been migrated yet.

## Rules

1. **Forward-only.** No down migrations. A mistake is fixed by a new migration. Data safety comes from backups and point-in-time recovery, and from rule 3.
2. **Never edit an applied migration.** The runner stores each file's SHA-256 and refuses to run if an applied file changed, or if an applied version is missing from the build (an old image deployed over a newer database).
3. **Expand → migrate → contract** for anything that existing code reads:
   - add the new column or table (nullable or with a default);
   - deploy code that writes both;
   - backfill in batches;
   - switch reads;
   - drop the old thing in a later release.
4. **Short locks.** Each migration runs in one transaction with `lock_timeout 5s` and `statement_timeout 120s`. For large tables, create indexes with `CREATE INDEX CONCURRENTLY` in a file whose first line is `-- gobye:no-transaction`, and backfill outside migrations (a job).
5. **One migrator at a time.** A session advisory lock: a second deploy fails fast with "Another migration is running".
6. **Staging first.** Every migration runs on staging, the API's tests run, and only then production.
7. **Production needs the flag:**
   - check the backup first;
   - `migrate up --confirm-production`;
   - with the owner's approval (Q-072).
8. **Supabase specifics:**
   - Use the **direct connection or session pooler (port 5432)** for migrations: the advisory lock needs a session. `DATABASE_MIGRATION_URL` is **required** in staging and production, and port 6543 (transaction pooler) is refused.
   - Do not touch the `auth`, `storage` or `public` schemas from these migrations. The website's `public.waitlist` and the demo tables are managed by `supabase/migrations` (unchanged).

## Commands

```bash
npm run build -w apps/api
# status: applied, pending, problems (exit 1 if any problem)
node apps/api/dist/apps/api/src/migrate.js status
# apply pending (development / staging)
node apps/api/dist/apps/api/src/migrate.js up
# production (after checking the backup)
node apps/api/dist/apps/api/src/migrate.js up --confirm-production
```

On StackShift, run `up` as a one-off release command from the same image, before the new API version receives traffic. `/health/ready` reports `unavailable` (503) while the schema is behind the build, so a new instance never serves on an old schema.

## Release order

1. Build the image (tag = git SHA).
2. Run `migrate.js status`, then `up`, against the environment.
3. Deploy the API and the worker with the same image.
4. Run `node apps/api/scripts/health-check.mjs <url> --expect-version <sha>`.
5. If the health check fails: roll the API back to the previous image. That is safe because every migration is additive (rule 3). Never roll back a migration.

## Roles (once per Supabase project; the SQL is in `apps/api/db/`)

Passwords come from the password manager through `psql -v`, never from a file, chat or the command history. Use `read -s` to load them:

```bash
# 1. As `postgres`, over a SESSION connection (5432), BEFORE the first migration:
read -s GOBYE_MIGRATOR_PASSWORD; read -s GOBYE_API_PASSWORD
psql "$ADMIN_SESSION_URL" -v ON_ERROR_STOP=1 \
     -v migrator_password="$GOBYE_MIGRATOR_PASSWORD" -v api_password="$GOBYE_API_PASSWORD" \
     -f apps/api/db/roles.sql
# 2. Migrations as gobye_migrator (DATABASE_MIGRATION_URL), from the image or the build:
node apps/api/dist/apps/api/src/migrate.js up
# 3. As gobye_migrator (the owner of the app and ops schemas), after each migration that adds tables:
psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=1 -f apps/api/db/grants.sql
# 4. Check the runtime connection the way the API uses it (transaction pooler, gobye_api):
node apps/api/dist/apps/api/src/migrate.js check-runtime
```

What the files do:
- **`roles.sql`** (safe to re-run):
  - creates `gobye_migrator` and `gobye_api` (`login noinherit`);
  - sets their passwords;
  - grants `create` on the database to the migrator;
  - `alter role gobye_api bypassrls`;
  - sets the **role-level limits that hold through a transaction pooler** (C-1): `gobye_api` gets `statement_timeout 5s`, `lock_timeout 3s` and `idle_in_transaction_session_timeout 30s`; `gobye_migrator` gets `statement_timeout 15min` as a ceiling for `CREATE INDEX CONCURRENTLY`.
  - It refuses to run without both passwords.
- **`grants.sql`:** usage on `app` and `ops`, DML on all tables and sequences, and default privileges for future tables. It runs as `gobye_migrator`, because a non-superuser `postgres` can't grant on another role's tables.
- **`check-runtime`** connects with `DATABASE_URL` and reports the role, the timeouts it got from the server, TLS, `bypassrls`, superuser and DDL rights. It exits 1 on any problem and prints no secret.

**Why role-level (C-1):** the API used to send `statement_timeout` as a connection start-up parameter. PgBouncer refuses that parameter, and Supavisor's transaction mode (6543) doesn't carry session settings between transactions. The server applies role settings to every connection it opens for the role, so nothing has to be sent. `SET LOCAL` in each transaction and the client-side `query_timeout` remain as the second and third layers. Tested in `apps/api/test/pooler.test.ts` through PgBouncer in transaction mode (not Supavisor; the staging check is `check-runtime`).

**Checked on plain PostgreSQL 16 (2026-10-23), with a non-superuser admin that has `CREATEROLE` + `BYPASSRLS`, like Supabase's `postgres`:**
- Without `bypassrls`, the runtime role reads **0 rows**, because RLS is on with no policies. With it, reads work.
- The runtime role cannot create tables.
- The runtime role cannot delete audit rows.
- A fresh connection as `gobye_api`, through PgBouncer in transaction mode, gets `statement_timeout 5s`, `lock_timeout 3s` and `idle_in_transaction_session_timeout 30s` with nothing sent at start-up. A `pg_sleep(8)` outside a transaction is cancelled by the server after 5 s.

**To verify on the Supabase staging project:** that `postgres` may grant `bypassrls`. If it may not, add a migration that creates `using (true)` policies for `gobye_api` on each `app` and `ops` table, so the runtime role reads through RLS instead.

**Append-only tables:**
- The audit log, pass payments, pass voids and ride events reject `UPDATE` and `DELETE` through triggers, whatever the role.
- `gobye_api` still has `DELETE` on other tables, for idempotency cleanup and file expiry.

## Schema overview

See `BACKEND_ARCHITECTURE.md` §7 for the table list and the rules the database enforces. Money columns are `bigint` kobo. Times are `timestamptz`. Ids are UUIDs (people use their Supabase Auth id).

## Tested behaviours

- A fresh database migrates; a re-run applies nothing.
- An edited applied file is refused.
- A failing file leaves no table and no record.
- A concurrent migrator is refused.
- Append-only triggers hold.
- One active ride per driver and one open ride per rider.
- No self-approval; NGN only; no grants to client roles; RLS on every table.
- `/health/ready` is 503 while the schema is behind.
