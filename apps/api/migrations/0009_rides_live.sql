-- 0009 Rides, live (D-100): server-issued fare quotes, driver presence, requests sent to drivers,
-- the trip itself, paying the driver directly, and ratings. No wallet money moves here (0010).

-- A fare the server worked out. A ride can only be booked from one of these, so a client can never
-- choose its own price. Kept for a day for disputes, then removable by a retention job.
create table app.fare_quotes (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid not null,
  rider_id           uuid not null references app.riders (user_id),
  category           text not null check (category in ('keke', 'go', 'comfort', 'xl')),
  city               text not null check (city in ('lagos', 'abuja')),
  pickup_lat         numeric(9, 6) not null check (pickup_lat between -90 and 90),
  pickup_lng         numeric(9, 6) not null check (pickup_lng between -180 and 180),
  pickup_label       text not null check (length(pickup_label) between 1 and 200),
  destination_lat    numeric(9, 6) not null check (destination_lat between -90 and 90),
  destination_lng    numeric(9, 6) not null check (destination_lng between -180 and 180),
  destination_label  text not null check (length(destination_label) between 1 and 200),
  distance_m         integer not null check (distance_m between 1 and 500000),
  duration_s         integer not null check (duration_s between 1 and 86400),
  -- True when the route came from the stand-in maps provider (straight line), not a real one.
  estimated          boolean not null,
  suggested_kobo     bigint not null check (suggested_kobo > 0),
  min_offer_kobo     bigint not null check (min_offer_kobo > 0),
  max_offer_kobo     bigint not null check (max_offer_kobo >= min_offer_kobo),
  breakdown          jsonb not null,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null
);
create index fare_quotes_rider on app.fare_quotes (rider_id, created_at desc);
create index fare_quotes_expiry on app.fare_quotes (expires_at);

alter table app.rides
  add column route_distance_m   integer check (route_distance_m > 0),
  add column route_duration_s   integer check (route_duration_s > 0),
  add column route_estimated    boolean not null default false,
  -- The rider's current offer in Negotiate, and which round it is.
  add column offer_id           uuid,
  add column offer_kobo         bigint check (offer_kobo > 0),
  add column offer_round        integer not null default 0 check (offer_round between 0 and 20),
  add column offer_expires_at   timestamptz,
  add column min_offer_kobo     bigint,
  add column max_offer_kobo     bigint,
  add column search_expires_at  timestamptz,
  add column arrived_at         timestamptz,
  -- The rider reads this to the driver at pickup; the driver cannot start the trip without it.
  add column pickup_pin         text check (pickup_pin ~ '^[0-9]{4}$'),
  add column pin_attempts       integer not null default 0,
  add column cancel_reason      text check (length(cancel_reason) <= 200),
  add column cancel_fee_kobo    bigint not null default 0 check (cancel_fee_kobo >= 0),
  add column payment_method     text check (payment_method in ('transfer', 'cash', 'wallet')),
  add column payment_claimed_at timestamptz,
  add column paid_at            timestamptz,
  add column payment_reference  text,
  -- Stars the rider gave the driver, and the driver gave the rider.
  add column driver_stars       smallint check (driver_stars between 1 and 5),
  add column rider_stars        smallint check (rider_stars between 1 and 5);
alter table app.rides add constraint rides_paid_needs_method check ((paid_at is null) or (payment_method is not null));
create index rides_open on app.rides (status, search_expires_at) where status in ('searching', 'negotiating');
create index rides_city_recent on app.rides (city, created_at desc);

-- Where a driver is and whether they are taking requests. One row per driver, overwritten: no location
-- history is kept (data minimisation; D-026 allows location only while the app is in use).
create table app.driver_presence (
  driver_id    uuid primary key references app.drivers (user_id),
  online       boolean not null default false,
  category     text check (category in ('keke', 'go', 'comfort', 'xl')),
  lat          numeric(9, 6) check (lat between -90 and 90),
  lng          numeric(9, 6) check (lng between -180 and 180),
  heading      smallint check (heading between 0 and 359),
  accuracy_m   integer check (accuracy_m between 0 and 100000),
  located_at   timestamptz,
  online_since timestamptz,
  updated_at   timestamptz not null default now(),
  check (not online or category is not null)
);
create index driver_presence_online on app.driver_presence (category, lat, lng) where online;

-- A ride shown to one driver, and what that driver said. One row per ride and driver.
create table app.ride_offers (
  id                   uuid primary key default gen_random_uuid(),
  ride_id              uuid not null references app.rides (id),
  driver_id            uuid not null references app.drivers (user_id),
  status               text not null default 'open' check (status in ('open', 'responded', 'declined', 'expired', 'won', 'lost')),
  distance_m           integer not null check (distance_m >= 0),
  eta_seconds          integer not null check (eta_seconds >= 0),
  -- Negotiate: the driver's answer to the rider's offer `for_offer_id`.
  response_kind        text check (response_kind in ('accept', 'counter')),
  amount_kobo          bigint check (amount_kobo > 0),
  for_offer_id         uuid,
  response_expires_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (ride_id, driver_id),
  check ((status = 'responded') <= (response_kind is not null and amount_kobo is not null and for_offer_id is not null and response_expires_at is not null))
);
create index ride_offers_driver_open on app.ride_offers (driver_id, created_at desc) where status in ('open', 'responded');
create trigger ride_offers_touch before update on app.ride_offers for each row execute function ops.touch_updated_at();

-- Where a driver wants to be paid when a rider pays by bank transfer (D-023). Shown to a rider only
-- while that rider owes this driver for a finished trip.
create table app.driver_payout_accounts (
  driver_id       uuid primary key references app.drivers (user_id),
  bank_name       text not null check (length(bank_name) between 2 and 60),
  account_number  text not null check (account_number ~ '^[0-9]{10}$'),
  account_name    text not null check (length(account_name) between 2 and 80),
  updated_at      timestamptz not null default now()
);

alter table app.riders add column rating_count integer not null default 0;
alter table app.drivers add column rating_count integer not null default 0;
alter table app.drivers add column completed_trips integer not null default 0;

alter table app.fare_quotes enable row level security;
alter table app.driver_presence enable row level security;
alter table app.ride_offers enable row level security;
alter table app.driver_payout_accounts enable row level security;

insert into ops.job_schedules (name, kind, every_seconds) values ('rides.sweep', 'rides.sweep', 60);
