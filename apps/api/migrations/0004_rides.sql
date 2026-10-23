-- 0004 Rides (schema only; no endpoints yet). Q-069 settled as /v1/rides.
-- The database enforces single assignment (BR-047, BACKEND_HANDOVER.md §4): a driver can hold one active
-- ride and a rider one open ride, whatever races happen in application code.
-- Fares are integer kobo, NGN only (BR-001). Client-only states (draft, quoted, submitting) are not stored.

create table app.rides (
  id                 uuid primary key default gen_random_uuid(),
  rider_id           uuid not null references app.riders (user_id),
  driver_id          uuid references app.drivers (user_id),
  mode               text not null check (mode in ('quick_match', 'negotiate')),
  category           text not null check (category in ('keke', 'go', 'comfort', 'xl')),
  status             text not null check (status in ('searching', 'negotiating', 'matched', 'driver_en_route', 'driver_arrived', 'in_progress', 'payment_pending', 'completed', 'cancelled', 'no_drivers', 'failed')),
  city               text not null check (city in ('lagos', 'abuja')),
  pickup_lat         numeric(9, 6) not null check (pickup_lat between -90 and 90),
  pickup_lng         numeric(9, 6) not null check (pickup_lng between -180 and 180),
  pickup_label       text not null,
  destination_lat    numeric(9, 6) not null check (destination_lat between -90 and 90),
  destination_lng    numeric(9, 6) not null check (destination_lng between -180 and 180),
  destination_label  text not null,
  quote_id           text,
  quoted_fare_kobo   bigint check (quoted_fare_kobo > 0),
  agreed_fare_kobo   bigint check (agreed_fare_kobo > 0),
  currency           char(3) not null default 'NGN' check (currency = 'NGN'),
  fare_locked_at     timestamptz,
  version            integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  matched_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text check (cancelled_by in ('rider', 'driver', 'system')),
  check ((driver_id is null) = (status in ('searching', 'negotiating', 'no_drivers') or (status in ('cancelled', 'failed') and matched_at is null))),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index rides_one_active_per_driver on app.rides (driver_id)
  where status in ('matched', 'driver_en_route', 'driver_arrived', 'in_progress');
create unique index rides_one_open_per_rider on app.rides (rider_id)
  where status in ('searching', 'negotiating', 'matched', 'driver_en_route', 'driver_arrived', 'in_progress');
create index rides_rider_recent on app.rides (rider_id, created_at desc);
create index rides_driver_recent on app.rides (driver_id, created_at desc) where driver_id is not null;
create trigger rides_touch before update on app.rides for each row execute function ops.touch_updated_at();

-- What happened to a ride, in order. Append-only; the ride row holds the current state.
create table app.ride_events (
  id          bigint generated always as identity primary key,
  ride_id     uuid not null references app.rides (id),
  at          timestamptz not null default now(),
  type        text not null check (type ~ '^[a-z_]+(\.[a-z_]+)*$'),
  actor_kind  text not null check (actor_kind in ('rider', 'driver', 'staff', 'system')),
  actor_id    text,
  data        jsonb not null default '{}'::jsonb
);
create index ride_events_ride on app.ride_events (ride_id, id);
create trigger ride_events_append_only before update or delete on app.ride_events
  for each row execute function ops.forbid_change();

alter table app.rides enable row level security;
alter table app.ride_events enable row level security;
