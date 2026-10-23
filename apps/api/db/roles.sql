-- GoBye database roles (DATABASE_MIGRATIONS.md §Roles, C-1). Run ONCE per project, as `postgres`, BEFORE
-- the first migration, with psql (passwords come from the password manager, never from this file):
--
--   psql "$ADMIN_SESSION_URL" -v ON_ERROR_STOP=1 \
--        -v migrator_password="$GOBYE_MIGRATOR_PASSWORD" -v api_password="$GOBYE_API_PASSWORD" \
--        -f apps/api/db/roles.sql
--
-- Safe to re-run: it creates missing roles, resets passwords and (re)applies the role settings.
-- Then run the migrations as gobye_migrator, then apps/api/db/grants.sql.

\if :{?migrator_password}
\else
  do $$ begin raise exception 'Set -v migrator_password=... (from the password manager)'; end $$;
\endif
\if :{?api_password}
\else
  do $$ begin raise exception 'Set -v api_password=... (from the password manager)'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'gobye_migrator') as need_migrator \gset
\if :need_migrator
  create role gobye_migrator login noinherit;
\endif
select not exists (select 1 from pg_roles where rolname = 'gobye_api') as need_api \gset
\if :need_api
  create role gobye_api login noinherit;
\endif

-- psql quotes the variables (:'name'), so a password is never interpolated as SQL.
alter role gobye_migrator password :'migrator_password';
alter role gobye_api password :'api_password';

-- Owner of the GoBye schemas; used only by the migration step.
select current_database() as dbname \gset
grant create on database :"dbname" to gobye_migrator;

-- Runtime role (API and worker): data access only, no DDL. RLS is on with no policies, so the runtime
-- role reads through it only with bypassrls (DATABASE_MIGRATIONS.md: verify Supabase allows this).
alter role gobye_api bypassrls;

-- C-1: server-side limits that hold through a TRANSACTION POOLER (Supavisor port 6543, PgBouncer).
-- The server applies role settings to every connection it opens for the role, so nothing has to be sent
-- by the client at connection start (start-up parameters such as statement_timeout are refused by
-- PgBouncer and not carried by transaction-mode pooling). The API also sets SET LOCAL per transaction
-- and a client-side query_timeout. Keep these in step with DATABASE_STATEMENT_TIMEOUT_MS (default 5000).
alter role gobye_api set statement_timeout = '5s';
alter role gobye_api set lock_timeout = '3s';
alter role gobye_api set idle_in_transaction_session_timeout = '30s';
-- Migrations set their own per-transaction limits (lock_timeout 5s, statement_timeout 120s); this is a
-- ceiling for anything run outside a migration transaction (e.g. CREATE INDEX CONCURRENTLY).
alter role gobye_migrator set statement_timeout = '15min';
alter role gobye_migrator set idle_in_transaction_session_timeout = '5min';
