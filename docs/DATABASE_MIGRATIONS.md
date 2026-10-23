# Database migrations: safe workflow (D-059)

**Status:** the runner and the five initial migrations are built and tested against PostgreSQL 16 (`apps/api/test/database.test.ts`). No Supabase database has been migrated yet.

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

## Roles (run once per Supabase project, as `postgres`; passwords from a password manager)

```sql
-- Owner of the GoBye schemas; used only by the migration step.
create role gobye_migrator login password '<from password manager>' noinherit;
grant create on database postgres to gobye_migrator;
-- Runtime role for the API and the worker: data access only, no DDL.
create role gobye_api login password '<from password manager>' noinherit;
-- After the first migration (schemas exist):
grant usage on schema app, ops to gobye_api;
grant select, insert, update, delete on all tables in schema app, ops to gobye_api;
grant usage, select on all sequences in schema app, ops to gobye_api;
alter default privileges for role gobye_migrator in schema app, ops grant select, insert, update, delete on tables to gobye_api;
alter default privileges for role gobye_migrator in schema app, ops grant usage, select on sequences to gobye_api;
-- RLS is on with no policies; the runtime role reads through it only as table owner or with bypassrls:
alter role gobye_api bypassrls;
-- Server-side limits for every statement, even through the pooler:
alter role gobye_api set statement_timeout = '5s';
alter role gobye_api set lock_timeout = '3s';
alter role gobye_api set idle_in_transaction_session_timeout = '30s';
```

**Checked on plain PostgreSQL 16 (2026-10-23):**
- Without `bypassrls`, the runtime role reads **0 rows**, because RLS is on with no policies. With it, reads work.
- The runtime role cannot create tables.
- The runtime role cannot delete audit rows.

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
