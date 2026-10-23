-- 0003 Driver passes (D-058). Stores only the inputs of the pass timeline: verified payments and voids.
-- Start and end times are computed by packages/core/src/subscriptions (buildTimeline), the same code the
-- apps use, so the stored data can never disagree with the calculation.
--
-- Rules enforced here as well as in code:
-- - one pass per provider payment reference (duplicate webhooks are no-ops);
-- - payments and voids are append-only; a void never deletes a pass;
-- - every write bumps the driver's timeline version in the same transaction (optimistic concurrency).
-- Prices (₦2,000 / 24 h, ₦60,000 / 30 days) are checked in code against the confirmed catalogue, not
-- hard-wired here, so a future approved price change does not need a schema change.

create table app.driver_pass_timelines (
  driver_id   uuid primary key references app.drivers (user_id),
  version     integer not null default 0 check (version >= 0),
  updated_at  timestamptz not null default now()
);
create trigger driver_pass_timelines_touch before update on app.driver_pass_timelines for each row execute function ops.touch_updated_at();

create table app.driver_pass_payments (
  payment_ref   text primary key check (char_length(payment_ref) between 6 and 100),
  driver_id     uuid not null references app.driver_pass_timelines (driver_id),
  plan          text not null check (plan in ('daily', 'monthly')),
  amount_kobo   bigint not null check (amount_kobo > 0),
  confirmed_at  timestamptz not null,
  source        text not null check (source in ('provider_verification', 'legacy_migration', 'manual_correction')),
  recorded_at   timestamptz not null default now()
);
create index driver_pass_payments_driver on app.driver_pass_payments (driver_id, confirmed_at, payment_ref);
create trigger driver_pass_payments_append_only before update or delete on app.driver_pass_payments
  for each row execute function ops.forbid_change();

create table app.driver_pass_voids (
  payment_ref  text primary key references app.driver_pass_payments (payment_ref),
  kind         text not null check (kind in ('cancelled', 'refunded', 'reversed')),
  at           timestamptz not null,
  reason       text not null check (char_length(btrim(reason)) >= 3),
  by_actor     text not null,
  recorded_at  timestamptz not null default now()
);
create trigger driver_pass_voids_append_only before update or delete on app.driver_pass_voids
  for each row execute function ops.forbid_change();

alter table app.driver_pass_timelines enable row level security;
alter table app.driver_pass_payments enable row level security;
alter table app.driver_pass_voids enable row level security;
