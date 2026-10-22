-- GoBye DEMO relay tables (D-049). OPTIONAL: only needed to connect the apps and the admin over the
-- internet instead of with the local relay (`npm run demo:relay`, same Wi-Fi).
--
-- WARNING: these tables are for TEST DATA ONLY. To keep the demo simple the public anon key may read and
-- write them, so anyone with the app could see or change demo rides. Never put real people, real phone
-- numbers or real money here, and drop the tables after the demo:
--   drop table if exists public.demo_events, public.demo_ride_responses, public.demo_rides,
--                        public.demo_driver_applications, public.demo_people;
--
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Then set EXPO_PUBLIC_DEMO_RELAY_URL / EXPO_PUBLIC_DEMO_RELAY_KEY (apps) and VITE_DEMO_RELAY_URL /
-- VITE_DEMO_RELAY_KEY (admin) to the project URL and anon key.

create table if not exists public.demo_people (
  id            text primary key,
  role          text not null check (role in ('rider', 'driver')),
  name          text not null,
  phone         text not null,
  email         text,
  city          text,
  created_at    bigint not null,
  updated_at    bigint not null,
  last_seen_at  bigint not null
);

create table if not exists public.demo_driver_applications (
  id            text primary key,
  driver_name   text not null,
  phone         text not null,
  city          text,
  status        text not null,
  application   jsonb not null default '{}'::jsonb,
  checks        jsonb not null default '[]'::jsonb,
  issues        jsonb not null default '[]'::jsonb,
  review_note   text,
  submitted_at  bigint,
  decided_at    bigint,
  decided_by    text,
  updated_at    bigint not null
);

create table if not exists public.demo_rides (
  id               text primary key,
  kind             text not null,
  status           text not null,
  rider_id         text not null,
  rider            jsonb not null,
  pickup           jsonb not null,
  destination      jsonb not null,
  route            jsonb not null,
  category         text not null,
  fare             bigint not null,
  max_counter      bigint not null,
  offer            jsonb,
  pickup_note      text,
  payment_method   text not null,
  driver_id        text,
  driver           jsonb,
  agreed_fare      bigint,
  driver_location  jsonb,
  pickup_pin       text,
  payment_status   text not null default 'not_due',
  cancelled_by     text,
  cancel_reason    text,
  created_at       bigint not null,
  matched_at       bigint,
  arrived_at       bigint,
  started_at       bigint,
  completed_at     bigint,
  updated_at       bigint not null
);
create index if not exists demo_rides_status on public.demo_rides (status, created_at desc);

create table if not exists public.demo_ride_responses (
  id           text primary key,
  ride_id      text not null,
  offer_id     text not null,
  driver_id    text not null,
  driver       jsonb not null,
  kind         text not null,
  amount       bigint not null,
  eta_seconds  integer not null,
  created_at   bigint not null,
  expires_at   bigint not null
);
create index if not exists demo_ride_responses_offer on public.demo_ride_responses (offer_id);

create table if not exists public.demo_events (
  id         text primary key,
  at         bigint not null,
  actor      text not null,
  type       text not null,
  summary    text not null,
  ride_id    text,
  person_id  text
);

-- Demo access for the anon key: read, add and change (no delete). TEST DATA ONLY (see the warning above).
do $$
declare t text;
begin
  foreach t in array array['demo_people', 'demo_driver_applications', 'demo_rides', 'demo_ride_responses', 'demo_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "demo anon read" on public.%I', t);
    execute format('drop policy if exists "demo anon add" on public.%I', t);
    execute format('drop policy if exists "demo anon change" on public.%I', t);
    execute format('create policy "demo anon read" on public.%I for select to anon using (true)', t);
    execute format('create policy "demo anon add" on public.%I for insert to anon with check (true)', t);
    execute format('create policy "demo anon change" on public.%I for update to anon using (true) with check (true)', t);
    execute format('grant select, insert, update on table public.%I to anon', t);
  end loop;
end $$;
