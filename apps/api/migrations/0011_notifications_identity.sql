-- 0011 Notifications and identity checks (D-103).

-- Where to send a push notification for this install. Cleared when the provider says it is no longer valid.
alter table app.devices add column push_token text check (push_token is null or length(push_token) between 10 and 300);
alter table app.devices add column push_token_at timestamptz;

-- Email receipts: on unless the person turns them off, and only ever sent to an address the sign-in
-- service has confirmed (so a mistyped address never gets someone else's trip).
alter table app.users add column email_receipts boolean not null default true;
alter table app.users add column email_verified_at timestamptz;

-- Every message we asked a provider to send, once per id. No message text and no codes are stored.
create table ops.notifications (
  id            text primary key check (length(id) between 5 and 160),
  user_id       uuid not null references app.users (id),
  channel       text not null check (channel in ('push', 'sms', 'email')),
  template      text not null check (template ~ '^[a-z_]+(\.[a-z_]+)+$'),
  status        text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  provider      text,
  detail        text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index notifications_user on ops.notifications (user_id, created_at desc);

-- What an identity provider said about a driver (D-067: shown on the driver's application in our admin).
-- Only the outcome is kept: never the provider's copy of the photo or the full record.
create table app.identity_checks (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references app.drivers (user_id),
  kind          text not null check (kind in ('nin_face_match')),
  provider      text not null,
  provider_ref  text,
  status        text not null check (status in ('passed', 'failed', 'error')),
  face_match    boolean,
  match_score   numeric(6, 2),
  name_match    boolean,
  detail        text,
  created_at    timestamptz not null default now()
);
create index identity_checks_driver on app.identity_checks (driver_id, created_at desc);
create trigger identity_checks_append_only before update or delete on app.identity_checks for each row execute function ops.forbid_change();

alter table ops.notifications enable row level security;
alter table app.identity_checks enable row level security;
