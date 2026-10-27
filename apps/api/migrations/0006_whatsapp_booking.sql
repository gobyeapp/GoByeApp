-- 0006 WhatsApp quick booking (D-064, docs/WHATSAPP_BOOKING.md). WhatsApp is only a way to create a
-- Quick Match ride; the ride itself is the same app.rides row the app uses.

-- Where a ride was booked. Existing rows are app bookings.
alter table app.rides add column channel text not null default 'app' check (channel in ('app', 'whatsapp'));

-- One short conversation per WhatsApp number (pickup, destination, offered fares). No message text is
-- stored. Rows untouched for 24 hours are deleted by the whatsapp.cleanup schedule.
create table app.whatsapp_sessions (
  wa_id       text primary key check (wa_id ~ '^[1-9][0-9]{7,14}$'),
  user_id     uuid references app.users (id),
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);
create index whatsapp_sessions_stale on app.whatsapp_sessions (updated_at);
create trigger whatsapp_sessions_touch before update on app.whatsapp_sessions for each row execute function ops.touch_updated_at();

-- Message ids seen from Meta (it may deliver a webhook more than once) and sent by us. Ids and kinds
-- only: never message text or locations. Kept 30 days.
create table ops.whatsapp_messages (
  message_id  text primary key,
  direction   text not null check (direction in ('in', 'out')),
  wa_id       text not null check (wa_id ~ '^[1-9][0-9]{7,14}$'),
  kind        text not null check (kind ~ '^[a-z_]+$'),
  created_at  timestamptz not null default now()
);
create index whatsapp_messages_created on ops.whatsapp_messages (created_at);

insert into ops.job_schedules (name, kind, every_seconds) values ('whatsapp.cleanup', 'whatsapp.cleanup', 3600)
on conflict (name) do nothing;

alter table app.whatsapp_sessions enable row level security;
alter table ops.whatsapp_messages enable row level security;
