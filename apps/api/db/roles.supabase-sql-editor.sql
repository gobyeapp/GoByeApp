-- GoBye database roles: Supabase SQL Editor version of roles.sql (same effect, no psql commands).
-- Used for gobye-staging on 2026-11-07. Run once per project in Supabase → SQL Editor:
--   1. Replace the TWO password markers with passwords from the password manager (letters and digits;
--      a single quote would break the SQL).  2. Run.  3. DELETE the saved snippet so no password stays
--      in Supabase.  Then run the migrations (GitHub Actions → "Staging database" → up).
-- Never commit this file with real passwords in it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gobye_migrator') then
    create role gobye_migrator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gobye_api') then
    create role gobye_api login noinherit;
  end if;
end $$;

alter role gobye_migrator password 'PASTE_MIGRATOR_PASSWORD_HERE';
alter role gobye_api      password 'PASTE_API_PASSWORD_HERE';

-- The migrator owns the GoBye schemas (Supabase's database is called "postgres").
grant create on database postgres to gobye_migrator;

-- Runtime role: reads through row-level security (RLS is on with no policies). Confirmed allowed on
-- Supabase 2026-11-07.
alter role gobye_api bypassrls;

-- Server-side limits that hold through Supabase's transaction pooler (C-1).
alter role gobye_api set statement_timeout = '5s';
alter role gobye_api set lock_timeout = '3s';
alter role gobye_api set idle_in_transaction_session_timeout = '30s';
alter role gobye_migrator set statement_timeout = '15min';
alter role gobye_migrator set idle_in_transaction_session_timeout = '5min';

-- Check: both roles, gobye_api with rolbypassrls = true and three settings.
select rolname, rolbypassrls, rolconfig from pg_roles where rolname like 'gobye_%';
