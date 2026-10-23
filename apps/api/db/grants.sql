-- Runtime grants (DATABASE_MIGRATIONS.md §Roles). Run as `postgres` AFTER the first migration (the app
-- and ops schemas must exist). Safe to re-run after later migrations.
--
--   psql "$ADMIN_SESSION_URL" -v ON_ERROR_STOP=1 -f apps/api/db/grants.sql

grant usage on schema app, ops to gobye_api;
grant select, insert, update, delete on all tables in schema app, ops to gobye_api;
grant usage, select on all sequences in schema app, ops to gobye_api;
alter default privileges for role gobye_migrator in schema app, ops grant select, insert, update, delete on tables to gobye_api;
alter default privileges for role gobye_migrator in schema app, ops grant usage, select on sequences to gobye_api;
