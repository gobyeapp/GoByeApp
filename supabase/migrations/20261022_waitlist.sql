-- GoBYE website waitlist.
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- The website uses the public anon key. It can ADD a sign up and nothing else:
-- no reading, changing or deleting rows. Read sign ups in the Table Editor (or with the service role, server side only).

create extension if not exists pgcrypto;

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (char_length(btrim(full_name)) between 2 and 80),
  email       text not null check (char_length(email) <= 254 and email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone       text not null check (phone ~ '^\+234[789][01][0-9]{8}$'),
  city        text not null check (city in ('Lagos', 'Abuja', 'Another city')),
  intent      text not null check (intent in ('ride', 'drive')),
  source      text not null default 'website' check (source in ('website')),
  created_at  timestamptz not null default now()
);

-- One sign up per email, whatever the capitalisation.
create unique index if not exists waitlist_email_key on public.waitlist (lower(email));

-- Row level security: the anon role may insert, and that is all.
alter table public.waitlist enable row level security;

drop policy if exists "Website can add sign ups" on public.waitlist;
create policy "Website can add sign ups"
  on public.waitlist
  for insert
  to anon
  with check (true);

revoke all on table public.waitlist from anon, authenticated;
grant insert (full_name, email, phone, city, intent, source) on table public.waitlist to anon;
