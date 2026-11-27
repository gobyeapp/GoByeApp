import type { Querier } from '../database/database';
import { AppError } from '../common/errors';

/**
 * The ledger (D-101). Money never "changes": a balanced journal is added, and what a person holds is the
 * sum of their entries. The rules in packages/core/src/platform/ledger.ts are the model; here the same
 * rules are enforced by PostgreSQL (0010), so they hold whatever the code does.
 */

export type AccountKind = 'passenger_wallet' | 'driver_earnings' | 'driver_withdrawal_reserve' | 'company_revenue' | 'provider_clearing' | 'promotions_expense' | 'processing_costs' | 'fee_income' | 'suspense';
export type JournalKind = 'wallet_funding' | 'trip_charge' | 'package_purchase' | 'refund' | 'withdrawal_reserve' | 'withdrawal_release' | 'withdrawal_payout' | 'referral_reward' | 'processing_fee' | 'adjustment' | 'reversal';
const OWNED: readonly AccountKind[] = ['passenger_wallet', 'driver_earnings', 'driver_withdrawal_reserve'];

export interface Line {
  account: AccountKind;
  ownerId?: string;
  provider?: string;
  /** Signed kobo: + adds to the account, − takes from it. */
  amount: number;
}

export interface JournalInput {
  kind: JournalKind;
  /** Unique per kind: posting the same reference again posts nothing and returns the first journal. */
  reference: string;
  description: string;
  lines: Line[];
  actor: { kind: 'rider' | 'driver' | 'staff' | 'system' | 'provider'; id: string | null };
  provider?: string;
  reason?: string;
  reverses?: string;
  links?: Record<string, string>;
}

export const INSUFFICIENT = () => new AppError(409, 'INSUFFICIENT_FUNDS', 'There isn’t enough money for this.');

/**
 * Posts one journal inside the caller's transaction. Returns `duplicate: true` (and changes nothing) when
 * this kind and reference were already posted. Throws INSUFFICIENT_FUNDS when a person's balance would
 * go below zero; the caller's savepoint or transaction then rolls back.
 */
export async function postJournal(tx: Querier, j: JournalInput): Promise<{ journalId: string; duplicate: boolean }> {
  const lines = j.lines.filter((l) => l.amount !== 0);
  if (!lines.length) throw new Error('ledger: empty journal');
  if (!lines.every((l) => Number.isSafeInteger(l.amount))) throw new Error('ledger: amounts must be whole kobo');
  if (lines.reduce((s, l) => s + l.amount, 0) !== 0) throw new Error('ledger: journal does not balance');
  const ins = await tx.query<{ id: string }>(
    `insert into app.ledger_journals (kind, reference, description, provider, actor_kind, actor_id, reason, reverses, links)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) on conflict (kind, reference) do nothing returning id`,
    [j.kind, j.reference, j.description, j.provider ?? null, j.actor.kind, j.actor.id, j.reason ?? null, j.reverses ?? null, JSON.stringify(j.links ?? {})],
  );
  if (!ins.rows[0]) {
    const existing = await tx.query<{ id: string }>(`select id from app.ledger_journals where kind = $1 and reference = $2`, [j.kind, j.reference]);
    return { journalId: existing.rows[0]!.id, duplicate: true };
  }
  const journalId = ins.rows[0].id;
  // Balances are locked in one fixed order, so two journals touching the same people can't deadlock.
  const owned = lines.filter((l) => OWNED.includes(l.account)).sort((a, b) => `${a.account}:${a.ownerId}`.localeCompare(`${b.account}:${b.ownerId}`));
  for (const l of owned) {
    if (!l.ownerId) throw new Error(`ledger: ${l.account} needs an owner`);
    await tx.query('savepoint ledger_balance');
    try {
      // Update first: PostgreSQL checks "not below zero" on the row an INSERT proposes, even when it would
      // only be merged into an existing balance, so a debit must never go through INSERT.
      const u = await tx.query(`update app.ledger_balances set balance_kobo = balance_kobo + $3, updated_at = now() where account_kind = $1 and owner_id = $2`, [l.account, l.ownerId, l.amount]);
      if (!u.rowCount) {
        await tx.query(
          `insert into app.ledger_balances (account_kind, owner_id, balance_kobo) values ($1, $2, $3)
           on conflict (account_kind, owner_id) do update set balance_kobo = app.ledger_balances.balance_kobo + excluded.balance_kobo, updated_at = now()`,
          [l.account, l.ownerId, l.amount],
        );
      }
    } catch (e) {
      await tx.query('rollback to savepoint ledger_balance');
      if ((e as { code?: string }).code === '23514') throw INSUFFICIENT();
      throw e;
    }
  }
  for (const l of lines) {
    await tx.query(`insert into app.ledger_entries (journal_id, account_kind, owner_id, provider, amount_kobo) values ($1, $2, $3, $4, $5)`, [journalId, l.account, l.ownerId ?? null, l.account === 'provider_clearing' ? (l.provider ?? j.provider ?? null) : null, l.amount]);
  }
  return { journalId, duplicate: false };
}

export async function balance(q: Querier, account: 'passenger_wallet' | 'driver_earnings' | 'driver_withdrawal_reserve', ownerId: string): Promise<number> {
  const r = await q.query<{ balance_kobo: string }>(`select balance_kobo from app.ledger_balances where account_kind = $1 and owner_id = $2`, [account, ownerId]);
  return r.rows[0] ? Number(r.rows[0].balance_kobo) : 0;
}

export interface IntegrityReport {
  ok: boolean;
  /** Sum of every entry: must be 0. */
  total: number;
  unbalancedJournals: number;
  balanceMismatches: number;
  suspenseKobo: number;
}

/** The checks finance relies on: everything adds up to zero, and every balance matches its entries. */
export async function integrity(q: Querier): Promise<IntegrityReport> {
  const total = Number((await q.query<{ s: string }>(`select coalesce(sum(amount_kobo), 0) as s from app.ledger_entries`)).rows[0]!.s);
  const unbalanced = Number((await q.query<{ c: string }>(`select count(*) as c from (select journal_id from app.ledger_entries group by journal_id having sum(amount_kobo) <> 0) x`)).rows[0]!.c);
  const mismatches = Number(
    (
      await q.query<{ c: string }>(
        `select count(*) as c from (
           select coalesce(b.account_kind, e.account_kind) as k, coalesce(b.owner_id, e.owner_id) as o
             from app.ledger_balances b
             full join (select account_kind, owner_id, sum(amount_kobo) as s from app.ledger_entries where owner_id is not null group by 1, 2) e
               on e.account_kind = b.account_kind and e.owner_id = b.owner_id
            where coalesce(b.balance_kobo, 0) <> coalesce(e.s, 0)) x`,
      )
    ).rows[0]!.c,
  );
  const suspense = Number((await q.query<{ s: string }>(`select coalesce(sum(amount_kobo), 0) as s from app.ledger_entries where account_kind = 'suspense'`)).rows[0]!.s);
  return { ok: total === 0 && unbalanced === 0 && mismatches === 0, total, unbalancedJournals: unbalanced, balanceMismatches: mismatches, suspenseKobo: suspense };
}
