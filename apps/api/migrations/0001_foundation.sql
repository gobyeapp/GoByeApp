-- 0001 Foundation: schemas, access lockdown, audit log, idempotency records, durable jobs.
-- BACKEND_ARCHITECTURE.md §6-§10. Forward-only: never edit after it is applied anywhere.
--
-- Schemas:
--   app  domain data (people, passes, rides, costs, config)
--   ops  infrastructure data (migrations, idempotency, jobs, audit, file metadata)
-- Neither is exposed through Supabase's Data API (only `public` is by default), and the client roles
-- (anon, authenticated) get no privileges here. The website's public.waitlist and the demo tables are
-- untouched.

create schema if not exists app;
create schema if not exists ops;

-- Supabase client roles exist only on Supabase; skip quietly on plain Postgres (local, CI).
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema app from %I', r);
      execute format('revoke all on schema ops from %I', r);
      execute format('alter default privileges in schema app revoke all on tables from %I', r);
      execute format('alter default privileges in schema ops revoke all on tables from %I', r);
    end if;
  end loop;
end $$;
revoke all on schema app from public;
revoke all on schema ops from public;

-- updated_at maintenance
create or replace function ops.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Append-only guard for history tables (audit, pass payments and voids, ride events).
create or replace function ops.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name using errcode = '42501';
end $$;

-- Audit log: every sensitive action (staff decisions, permission changes, money configuration).
create table ops.audit_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_kind    text not null check (actor_kind in ('staff', 'rider', 'driver', 'system', 'provider')),
  actor_id      text,
  actor_name    text not null,
  action        text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type   text not null,
  target_id     text not null,
  summary       text not null,
  reason        text,
  request_id    text,
  data          jsonb not null default '{}'::jsonb
);
create index audit_events_target on ops.audit_events (target_type, target_id, at desc);
create index audit_events_actor on ops.audit_events (actor_kind, actor_id, at desc);
create trigger audit_events_append_only before update or delete on ops.audit_events
  for each row execute function ops.forbid_change();

-- Idempotency records (API_CONTRACTS.md §1). Same key + same request → replay; different request → 409.
-- The record is written in the same transaction as the change it protects.
create table ops.idempotency_keys (
  scope         text not null,            -- who: 'user:<uuid>' / 'staff:<uuid>' / 'system'
  key           text not null check (char_length(key) between 8 and 128),
  method        text not null,
  path          text not null,
  request_hash  text not null check (char_length(request_hash) = 64),
  status_code   integer,
  response      jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  expires_at    timestamptz not null default now() + interval '48 hours',
  primary key (scope, key)
);
create index idempotency_keys_expiry on ops.idempotency_keys (expires_at);

-- Durable jobs (Postgres queue; no Redis). Workers claim with FOR UPDATE SKIP LOCKED and a lease.
create table ops.jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind ~ '^[a-z_]+(\.[a-z_]+)+$'),
  payload         jsonb not null default '{}'::jsonb,
  -- One job per business event: the same key never runs twice (e.g. 'subscription.activate:<paymentRef>').
  idempotency_key text not null unique,
  status          text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  run_at          timestamptz not null default now(),
  attempts        integer not null default 0 check (attempts >= 0),
  max_attempts    integer not null default 5 check (max_attempts between 1 and 50),
  locked_by       text,
  locked_until    timestamptz,
  last_error      text,
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz,
  check ((status = 'running') = (locked_until is not null))
);
create index jobs_ready on ops.jobs (run_at) where status = 'queued';
create index jobs_expired_leases on ops.jobs (locked_until) where status = 'running';
create index jobs_kind_status on ops.jobs (kind, status, created_at desc);
create trigger jobs_touch before update on ops.jobs for each row execute function ops.touch_updated_at();

-- Recurring schedules. The scheduler inserts one job per slot with key '<name>:<slot>', so several API
-- instances ticking at once still produce exactly one job.
create table ops.job_schedules (
  name           text primary key check (name ~ '^[a-z_]+(\.[a-z_]+)+$'),
  kind           text not null,
  payload        jsonb not null default '{}'::jsonb,
  every_seconds  integer not null check (every_seconds between 60 and 2678400),
  next_run_at    timestamptz not null default now(),
  enabled        boolean not null default true,
  updated_at     timestamptz not null default now()
);
create trigger job_schedules_touch before update on ops.job_schedules for each row execute function ops.touch_updated_at();

-- Housekeeping that is safe to run from day one (no money, no people): expired idempotency records.
insert into ops.job_schedules (name, kind, every_seconds) values ('ops.idempotency_cleanup', 'ops.idempotency_cleanup', 3600);

-- Row level security on, no policies: only the backend's own role (table owner / bypassrls) reads these.
alter table ops.audit_events enable row level security;
alter table ops.idempotency_keys enable row level security;
alter table ops.jobs enable row level security;
alter table ops.job_schedules enable row level security;
