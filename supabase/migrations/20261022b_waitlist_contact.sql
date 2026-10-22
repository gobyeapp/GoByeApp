-- GoBYE waitlist: add full name and phone number.
-- Safe to run whether or not 20261022_waitlist.sql has already been run.
-- Phone numbers are stored as Nigerian E.164: +234 followed by 10 digits (for example +2348031234567).

alter table public.waitlist add column if not exists full_name text;
alter table public.waitlist add column if not exists phone text;

alter table public.waitlist drop constraint if exists waitlist_full_name_check;
alter table public.waitlist add constraint waitlist_full_name_check
  check (full_name is not null and char_length(btrim(full_name)) between 2 and 80) not valid;

alter table public.waitlist drop constraint if exists waitlist_phone_check;
alter table public.waitlist add constraint waitlist_phone_check
  check (phone is not null and phone ~ '^\+234[789][01][0-9]{8}$') not valid;

-- The website may also set these two columns, and still cannot read anything.
grant insert (full_name, phone) on table public.waitlist to anon;
