-- 0010 Money (D-101): a double-entry ledger, wallet balances, payments in (collections), payments out
-- (withdrawals) and provider webhooks. Built and tested, and SWITCHED OFF: every HTTP route that moves
-- money answers "not connected" until WALLET_ENABLED=true and a payment provider is configured.
--
-- Safety is in the database, not only in code:
--   * journals and entries are append-only (a correction is a new journal that reverses the old one);
--   * a journal whose entries do not add up to zero cannot be committed;
--   * (kind, reference) is unique, so the same provider payment can never be posted twice;
--   * balances people own can never go below zero (a check constraint, under a row lock).

create table app.ledger_journals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('wallet_funding', 'trip_charge', 'package_purchase', 'refund', 'withdrawal_reserve', 'withdrawal_release', 'withdrawal_payout', 'referral_reward', 'processing_fee', 'adjustment', 'reversal')),
  reference    text not null check (length(reference) between 3 and 120),
  description  text not null check (length(description) between 3 and 200),
  provider     text,
  actor_kind   text not null check (actor_kind in ('rider', 'driver', 'staff', 'system', 'provider')),
  actor_id     text,
  reason       text,
  reverses     uuid references app.ledger_journals (id),
  links        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (kind, reference),
  check (kind not in ('adjustment', 'reversal', 'refund') or (reason is not null and length(btrim(reason)) >= 5)),
  check ((kind = 'reversal') = (reverses is not null))
);
create unique index ledger_journals_reversed_once on app.ledger_journals (reverses) where reverses is not null;
create index ledger_journals_recent on app.ledger_journals (created_at desc);

create table app.ledger_entries (
  id            bigint generated always as identity primary key,
  journal_id    uuid not null references app.ledger_journals (id),
  account_kind  text not null check (account_kind in ('passenger_wallet', 'driver_earnings', 'driver_withdrawal_reserve', 'company_revenue', 'provider_clearing', 'promotions_expense', 'processing_costs', 'fee_income', 'suspense')),
  owner_id      uuid,
  provider      text,
  amount_kobo   bigint not null check (amount_kobo <> 0),
  created_at    timestamptz not null default now(),
  check ((account_kind in ('passenger_wallet', 'driver_earnings', 'driver_withdrawal_reserve')) = (owner_id is not null)),
  check ((account_kind = 'provider_clearing') = (provider is not null))
);
create index ledger_entries_journal on app.ledger_entries (journal_id);
create index ledger_entries_owner on app.ledger_entries (owner_id, id desc) where owner_id is not null;

create trigger ledger_journals_append_only before update or delete on app.ledger_journals for each row execute function ops.forbid_change();
create trigger ledger_entries_append_only before update or delete on app.ledger_entries for each row execute function ops.forbid_change();

-- A journal must balance. Checked at commit, so all of a journal's entries are in by then.
create function app.ledger_journal_balanced() returns trigger language plpgsql as $$
declare total bigint;
begin
  select coalesce(sum(amount_kobo), 0) into total from app.ledger_entries where journal_id = new.journal_id;
  if total <> 0 then
    raise exception 'ledger journal % does not balance (sum %)', new.journal_id, total using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on app.ledger_entries
  deferrable initially deferred for each row execute function app.ledger_journal_balanced();

-- What each person holds right now. Always changed in the same transaction as the entries, by the same
-- amount; the nightly integrity job compares it with the sum of the entries.
create table app.ledger_balances (
  account_kind  text not null check (account_kind in ('passenger_wallet', 'driver_earnings', 'driver_withdrawal_reserve')),
  owner_id      uuid not null,
  balance_kobo  bigint not null default 0 check (balance_kobo >= 0),
  updated_at    timestamptz not null default now(),
  primary key (account_kind, owner_id)
);

-- A payment we asked a provider to collect. Credited only after our own lookup with the provider says it
-- succeeded for the exact amount (a webhook alone never credits).
create table app.collections (
  reference          text primary key check (reference ~ '^[a-z0-9_-]{16,50}$'),
  user_id            uuid not null references app.users (id),
  purpose            text not null check (purpose in ('wallet_funding', 'package_purchase')),
  method             text not null check (method in ('transfer', 'card')),
  provider           text not null,
  amount_kobo        bigint not null check (amount_kobo > 0),
  plan               text check (plan in ('daily', 'monthly')),
  status             text not null default 'pending' check (status in ('pending', 'credited', 'failed', 'investigate', 'expired')),
  instructions       jsonb not null default '{}'::jsonb,
  provider_txn_id    text,
  provider_charge_kobo bigint check (provider_charge_kobo >= 0),
  detail             text,
  checks             integer not null default 0,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz,
  expires_at         timestamptz not null,
  check ((purpose = 'package_purchase') = (plan is not null))
);
create index collections_user on app.collections (user_id, created_at desc);
create index collections_pending on app.collections (created_at) where status = 'pending';
create trigger collections_touch_guard before delete on app.collections for each row execute function ops.forbid_change();

-- Money a driver asked to take out. Needs a staff approval; the transfer is sent once, by reference.
create table app.withdrawals (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique check (reference ~ '^[a-z0-9_-]{16,50}$'),
  driver_id        uuid not null references app.drivers (user_id),
  amount_kobo      bigint not null check (amount_kobo > 0),
  bank_code        text not null,
  bank_name        text not null,
  account_number   text not null check (account_number ~ '^[0-9]{10}$'),
  account_name     text not null,
  status           text not null default 'requested' check (status in ('requested', 'approved', 'submitted', 'unknown', 'paid', 'failed', 'rejected')),
  provider         text,
  reviewed_by      uuid references app.staff_members (id),
  reviewed_at      timestamptz,
  review_reason    text,
  submitted_at     timestamptz,
  settled_at       timestamptz,
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index withdrawals_one_open_per_driver on app.withdrawals (driver_id) where status in ('requested', 'approved', 'submitted', 'unknown');
create index withdrawals_queue on app.withdrawals (status, created_at);
create trigger withdrawals_touch before update on app.withdrawals for each row execute function ops.touch_updated_at();

-- A refund staff asked for. A different member of staff must approve it before money moves.
create table app.refunds (
  id            uuid primary key default gen_random_uuid(),
  ride_id       uuid not null references app.rides (id),
  rider_id      uuid not null references app.riders (user_id),
  amount_kobo   bigint not null check (amount_kobo > 0),
  reason        text not null check (length(btrim(reason)) >= 5),
  status        text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by  uuid not null references app.staff_members (id),
  decided_by    uuid references app.staff_members (id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (decided_by is null or decided_by <> requested_by)
);
create index refunds_ride on app.refunds (ride_id);

-- Every webhook delivery from a payment provider, once (duplicates are dropped by event id).
create table ops.payment_webhook_events (
  provider     text not null,
  event_id     text not null,
  type         text not null,
  reference    text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

alter table app.driver_payout_accounts add column bank_code text check (bank_code ~ '^[0-9A-Za-z]{2,10}$');

alter table app.ledger_journals enable row level security;
alter table app.ledger_entries enable row level security;
alter table app.ledger_balances enable row level security;
alter table app.collections enable row level security;
alter table app.withdrawals enable row level security;
alter table app.refunds enable row level security;
alter table ops.payment_webhook_events enable row level security;

insert into ops.job_schedules (name, kind, every_seconds) values
  ('money.integrity', 'money.integrity', 86400),
  ('money.sweep', 'money.sweep', 300);
