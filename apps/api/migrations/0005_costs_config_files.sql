-- 0005 Operating costs (D-057), versioned configuration (D-054) and file metadata (R2_STORAGE_ARCHITECTURE.md).
-- No ledger, wallet or payout tables: those wait for the ledger, reconciliation, provider and security
-- reviews (owner restriction, BACKEND_ARCHITECTURE.md §9).

-- Vendors and expenses: infrastructure and operating costs for profitability reporting.
-- Marketing is recorded but excluded from the agreed break-even (packages/core costs OPERATING_CATEGORIES).
create table app.vendors (
  id          text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  name        text not null,
  category    text not null check (category in ('frontend_hosting', 'edge_network', 'backend_hosting', 'database', 'maps', 'sms_otp', 'email', 'monitoring', 'storage', 'security', 'staff_operations', 'maintenance', 'compliance', 'payment_provider', 'marketing')),
  plan        text not null default '',
  status      text not null check (status in ('active_paid', 'free_plan', 'trial', 'proposed', 'not_chosen')),
  billing     text not null default 'manual' check (billing in ('manual', 'not_connected')),
  currency    char(3) not null check (currency in ('NGN', 'USD')),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger vendors_touch before update on app.vendors for each row execute function ops.touch_updated_at();

create table app.operating_expenses (
  id                    uuid primary key default gen_random_uuid(),
  vendor_id             text not null references app.vendors (id),
  category              text not null,
  description           text not null check (char_length(btrim(description)) between 3 and 200),
  amount_kobo           bigint not null check (amount_kobo > 0),
  month                 char(7) not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  original_currency     char(3) check (original_currency in ('USD')),
  original_amount_minor bigint check (original_amount_minor > 0),
  fx_rate               numeric(14, 4) check (fx_rate > 0),
  incurred_at           timestamptz not null,
  recurring             boolean not null default false,
  status                text not null default 'pending_approval' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'paid')),
  note                  text,
  created_by            uuid not null references app.staff_members (id),
  created_at            timestamptz not null default now(),
  approved_by           uuid references app.staff_members (id),
  approved_at           timestamptz,
  updated_at            timestamptz not null default now(),
  check ((original_currency is null) = (original_amount_minor is null) and (original_currency is null) = (fx_rate is null)),
  check ((approved_by is null) = (approved_at is null)),
  check (approved_by is null or approved_by <> created_by)   -- no self-approval
);
create index operating_expenses_month on app.operating_expenses (month, category);
create trigger operating_expenses_touch before update on app.operating_expenses for each row execute function ops.touch_updated_at();

-- Versioned, effective-dated configuration (fee schedules, pricing, automation settings).
-- A version is never edited once proposed; a new version supersedes it. Activation needs approval.
create table app.config_versions (
  key             text not null check (key ~ '^[a-z_]+(\.[a-z_]+)*$'),
  version         integer not null check (version > 0),
  value           jsonb not null,
  status          text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'active', 'retired', 'rejected')),
  effective_from  timestamptz,
  reason          text not null,
  created_by      uuid not null references app.staff_members (id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references app.staff_members (id),
  approved_at     timestamptz,
  primary key (key, version),
  check (approved_by is null or approved_by <> created_by)
);
create unique index config_one_active on app.config_versions (key) where status = 'active';

-- File metadata (packages/core/src/files FileRecord). Bytes live in R2; nothing is readable until approved.
create table ops.files (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null,
  file_class         text not null check (file_class in ('profile_photo', 'driver_licence', 'identity_document', 'vehicle_document', 'incident_photo', 'incident_video', 'public_media')),
  access_class       text not null check (access_class in ('public', 'private')),
  bucket             text not null,
  object_key         text not null,
  status             text not null default 'pending_upload' check (status in ('pending_upload', 'uploaded', 'scanning', 'quarantined', 'approved', 'rejected', 'deleted', 'expired')),
  scan_status        text not null default 'not_scanned' check (scan_status in ('not_scanned', 'pending', 'clean', 'infected', 'error')),
  claimed_mime       text not null,
  detected_mime      text,
  declared_size      bigint not null check (declared_size > 0),
  verified_size      bigint,
  sha256             char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  retention_policy   text not null,
  deletion_status    text not null default 'none' check (deletion_status in ('none', 'requested', 'deleted')),
  related            jsonb not null default '{}'::jsonb,
  upload_expires_at  timestamptz not null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (bucket, object_key),
  check (status <> 'approved' or scan_status = 'clean')
);
create index files_owner on ops.files (owner_id, created_at desc);
create index files_pending_expiry on ops.files (upload_expires_at) where status = 'pending_upload';
create trigger files_touch before update on ops.files for each row execute function ops.touch_updated_at();

-- The services GoBye uses today (mirrors packages/core seedVendors; plans as they actually are).
insert into app.vendors (id, name, category, plan, status, billing, currency, note) values
  ('vercel', 'Vercel', 'frontend_hosting', 'Hobby (free)', 'free_plan', 'manual', 'USD', 'Website and admin. Hobby does not allow commercial use; Pro is needed before launch.'),
  ('cloudflare', 'Cloudflare', 'edge_network', 'Free', 'free_plan', 'manual', 'USD', 'DNS, Workers and R2. Nothing deployed yet.'),
  ('supabase', 'Supabase', 'database', 'Free', 'free_plan', 'manual', 'USD', 'Waitlist today; PostgreSQL and Auth for the backend.'),
  ('stackshift', 'StackShift', 'backend_hosting', 'Not chosen', 'proposed', 'not_connected', 'NGN', 'Initial backend hosting candidate; not production until tests pass.')
on conflict (id) do nothing;

alter table app.vendors enable row level security;
alter table app.operating_expenses enable row level security;
alter table app.config_versions enable row level security;
alter table ops.files enable row level security;
