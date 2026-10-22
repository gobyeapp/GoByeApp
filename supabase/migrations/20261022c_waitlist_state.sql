-- GoBYE waitlist: capture the state when someone picks "Another city".
-- Run this BEFORE deploying the site version that sends `state`.

alter table public.waitlist add column if not exists state text;

alter table public.waitlist drop constraint if exists waitlist_state_check;
alter table public.waitlist add constraint waitlist_state_check check (
  (city = 'Another city' and state in (
    'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
    'Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
    'Kwara','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'))
  or (city <> 'Another city' and state is null)
) not valid;

grant insert (state) on table public.waitlist to anon;
