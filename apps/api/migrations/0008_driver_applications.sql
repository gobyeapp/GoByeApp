-- 0008 Driver applications (Backend Phase 2, WP3; docs/BACKEND_PHASE_2_PLAN.md, D-079).
-- One application per driver. `data` holds the registration steps, review checks and flagged issues in the
-- shape of @gobye/core DriverApplication; the rules that change it live in core and run in the API.
-- File fields hold ops.files ids. `version` guards against two people changing it at once.

create table app.driver_applications (
  driver_id     uuid primary key references app.drivers (user_id),
  status        text not null default 'not_started'
                  check (status in ('not_started', 'in_progress', 'pending_review', 'changes_requested', 'approved', 'rejected')),
  version       integer not null default 1 check (version > 0),
  data          jsonb not null default '{"documents": {}}'::jsonb check (jsonb_typeof(data) = 'object'),
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references app.staff_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index driver_applications_queue on app.driver_applications (status, submitted_at);
create trigger driver_applications_touch before update on app.driver_applications for each row execute function ops.touch_updated_at();

-- What happened to an application, in order (driver saves, submissions, staff requests and decisions).
create table app.application_events (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null references app.drivers (user_id),
  at          timestamptz not null default now(),
  actor_kind  text not null check (actor_kind in ('driver', 'staff', 'system')),
  actor_id    text not null,
  kind        text not null check (kind ~ '^[a-z_]+$'),
  version     integer not null,
  data        jsonb not null default '{}'::jsonb
);
create index application_events_driver on app.application_events (driver_id, id);
create trigger application_events_append_only before update or delete on app.application_events
  for each row execute function ops.forbid_change();

alter table app.driver_applications enable row level security;
alter table app.application_events enable row level security;
