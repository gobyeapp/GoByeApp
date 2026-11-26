-- 0007 Accounts (Backend Phase 2, WP1; docs/BACKEND_PHASE_2_PLAN.md): consent records, devices and account
-- deletion for riders and drivers. Also adds the view-only `stakeholder` staff role (D-068), which the
-- permission model in @gobye/core already has.

-- Which version of each document a person accepted (NDPA, Q-063). Append only: a newer version is a new row.
create table app.consents (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references app.users (id),
  document     text not null check (document in ('terms', 'privacy')),
  version      text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  accepted_at  timestamptz not null default now(),
  -- SHA-256 of the caller's IP with a server salt, never the IP itself (enough to show a pattern of abuse).
  ip_hash      text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  unique (user_id, document, version)
);
create trigger consents_append_only before update or delete on app.consents
  for each row execute function ops.forbid_change();

-- Phones and browsers a person signs in from (proposed D-062: verify the phone again on a new device).
-- install_id is a random id the app creates once per install; it identifies nothing outside GoBye.
create table app.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app.users (id),
  install_id   text not null check (install_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  platform     text not null check (platform in ('ios', 'android', 'web')),
  app_version  text check (app_version is null or char_length(app_version) <= 32),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  verified_at  timestamptz,
  unique (user_id, install_id)
);

-- Account deletion (Apple 5.1.1(v), NDPA). Scheduled, cancellable during the grace period, then a job
-- anonymises the person and removes the sign-in account. Trips and money records keep the id only.
create table app.account_deletions (
  user_id          uuid primary key references app.users (id),
  requested_at     timestamptz not null default now(),
  scheduled_for    timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed')),
  completed_at     timestamptz,
  auth_user_deleted boolean not null default false,
  updated_at       timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null)),
  check (scheduled_for >= requested_at)
);
create index account_deletions_due on app.account_deletions (scheduled_for) where status = 'scheduled';
create trigger account_deletions_touch before update on app.account_deletions for each row execute function ops.touch_updated_at();

alter table app.consents enable row level security;
alter table app.devices enable row level security;
alter table app.account_deletions enable row level security;

-- Staff roles: add the view-only stakeholder role (D-068).
alter table app.staff_members drop constraint staff_members_roles_check;
alter table app.staff_members add constraint staff_members_roles_check
  check (cardinality(roles) > 0 and roles <@ array['owner', 'admin', 'operations', 'onboarding', 'care', 'safety', 'finance', 'marketing', 'developer', 'auditor', 'stakeholder']);
