-- 0002 Identity: people, riders, drivers, vehicles, staff.
-- A person's id is their Supabase Auth user id (auth.users.id). There is no foreign key to auth.users so
-- the schema also runs on plain Postgres; account deletion arrives through the backend (BACKEND_ARCHITECTURE.md §5).

create table app.users (
  id          uuid primary key,
  full_name   text not null check (char_length(btrim(full_name)) between 2 and 80),
  email       text check (email is null or (char_length(email) <= 254 and email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  phone       text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  status      text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check ((status = 'deleted') = (deleted_at is not null))
);
create unique index users_email_key on app.users (lower(email)) where email is not null and status <> 'deleted';
create unique index users_phone_key on app.users (phone) where phone is not null and status <> 'deleted';
create trigger users_touch before update on app.users for each row execute function ops.touch_updated_at();

create table app.riders (
  user_id     uuid primary key references app.users (id),
  rating      numeric(3, 2) check (rating between 1 and 5),
  created_at  timestamptz not null default now()
);

create table app.drivers (
  user_id              uuid primary key references app.users (id),
  city                 text not null check (city in ('lagos', 'abuja')),
  verification_status  text not null default 'not_started'
                         check (verification_status in ('not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'suspended')),
  approved_at          timestamptz,
  rating               numeric(3, 2) check (rating between 1 and 5),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((verification_status = 'approved') <= (approved_at is not null))
);
create index drivers_city_status on app.drivers (city, verification_status);
create trigger drivers_touch before update on app.drivers for each row execute function ops.touch_updated_at();

create table app.vehicles (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references app.drivers (user_id),
  category    text not null check (category in ('keke', 'go', 'comfort', 'xl')),
  make        text not null,
  model       text not null,
  colour      text not null,
  year        integer check (year between 1990 and 2100),
  plate       text not null check (plate ~ '^[A-Z0-9 -]{5,12}$'),
  status      text not null default 'pending' check (status in ('pending', 'active', 'retired')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index vehicles_plate_key on app.vehicles (upper(replace(plate, ' ', ''))) where status <> 'retired';
create unique index vehicles_one_active_per_driver on app.vehicles (driver_id) where status = 'active';
create trigger vehicles_touch before update on app.vehicles for each row execute function ops.touch_updated_at();

-- Staff (packages/core/src/platform/permissions.ts). Roles are permission groups; access is their union.
create table app.staff_members (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique,
  full_name     text not null,
  email         text not null,
  roles         text[] not null check (cardinality(roles) > 0 and roles <@ array['owner', 'admin', 'operations', 'onboarding', 'care', 'safety', 'finance', 'marketing', 'developer', 'auditor']),
  cities        text[] not null default '{}' check (cities <@ array['lagos', 'abuja']),  -- empty = all cities
  status        text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references app.staff_members (id)
);
create unique index staff_email_key on app.staff_members (lower(email)) where status <> 'removed';
create trigger staff_touch before update on app.staff_members for each row execute function ops.touch_updated_at();

alter table app.users enable row level security;
alter table app.riders enable row level security;
alter table app.drivers enable row level security;
alter table app.vehicles enable row level security;
alter table app.staff_members enable row level security;
