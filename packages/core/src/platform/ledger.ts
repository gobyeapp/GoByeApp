import type { Kobo } from '../types';
import type { Actor, LedgerAccount, LedgerEntry, LedgerEntryKind } from './types';

/**
 * Double-entry ledger (owner brief §5). Money movements are entries; balances are sums. Staff never
 * overwrite a balance: a correction is a new adjustment or reversal journal with a reason.
 */

export const accountKey = (a: LedgerAccount): string =>
  'ownerId' in a ? `${a.kind}:${a.ownerId}` : 'provider' in a ? `${a.kind}:${a.provider}` : a.kind;

export function balanceOf(entries: readonly LedgerEntry[], account: LedgerAccount): Kobo {
  const key = accountKey(account);
  return entries.reduce((sum, e) => (accountKey(e.account) === key ? sum + e.amount : sum), 0) as Kobo;
}

export interface JournalLine {
  account: LedgerAccount;
  amount: Kobo;
}

export type JournalError = 'unbalanced' | 'empty' | 'reason_required' | 'already_reversed' | 'not_found' | 'insufficient_funds' | 'duplicate_reference';

let seq = 0;
const nextId = (p: string, now: number) => `${p}-${now.toString(36)}-${(seq++).toString(36)}`;

/**
 * Post a balanced journal. `reference` makes it idempotent: posting the same provider reference twice
 * (a duplicate webhook) returns the original entries and posts nothing.
 */
export function postJournal(
  entries: readonly LedgerEntry[],
  input: { lines: JournalLine[]; kind: LedgerEntryKind; description: string; by: Actor; now: number; reference?: string; provider?: string; links?: LedgerEntry['links']; reason?: string; reverses?: string },
): { ok: true; entries: LedgerEntry[]; posted: LedgerEntry[]; duplicate: boolean } | { ok: false; error: JournalError } {
  // Idempotency first: a repeated provider reference (duplicate webhook, retried request) posts nothing.
  if (input.reference) {
    const existing = entries.filter((e) => e.reference === input.reference && e.kind === input.kind);
    if (existing.length) return { ok: true, entries: entries.slice(), posted: existing, duplicate: true };
  }
  if (input.lines.length === 0) return { ok: false, error: 'empty' };
  if (input.lines.reduce((s, l) => s + l.amount, 0) !== 0) return { ok: false, error: 'unbalanced' };
  if ((input.kind === 'adjustment' || input.kind === 'reversal') && !input.reason?.trim()) return { ok: false, error: 'reason_required' };
  const journalId = nextId('jr', input.now);
  const posted: LedgerEntry[] = input.lines.map((l) => ({
    id: nextId('le', input.now),
    journalId,
    at: input.now,
    account: l.account,
    amount: l.amount,
    kind: input.kind,
    description: input.description,
    reference: input.reference,
    provider: input.provider,
    links: input.links,
    createdBy: input.by,
    reason: input.reason,
    reverses: input.reverses,
  }));
  return { ok: true, entries: [...posted, ...entries], posted, duplicate: false };
}

/** Reverse a whole journal with opposite entries. A journal can be reversed once. */
export function reverseJournal(entries: readonly LedgerEntry[], journalId: string, input: { by: Actor; now: number; reason: string }) {
  const original = entries.filter((e) => e.journalId === journalId);
  if (!original.length) return { ok: false as const, error: 'not_found' as JournalError };
  if (entries.some((e) => e.kind === 'reversal' && original.some((o) => o.id === e.reverses))) return { ok: false as const, error: 'already_reversed' as JournalError };
  return postJournal(entries, {
    lines: original.map((o) => ({ account: o.account, amount: -o.amount as Kobo })),
    kind: 'reversal',
    description: `Reversal: ${original[0].description}`,
    by: input.by,
    now: input.now,
    reason: input.reason,
    reverses: original[0].id,
    links: original[0].links,
  });
}

/**
 * Wallet funding verified by the provider: credit the passenger once. Wallet money is a liability held
 * for the passenger (future use), never revenue.
 */
export function creditWalletFunding(entries: readonly LedgerEntry[], p: { passengerId: string; amount: Kobo; provider: string; reference: string; now: number }) {
  return postJournal(entries, {
    lines: [
      { account: { kind: 'passenger_wallet', ownerId: p.passengerId }, amount: p.amount },
      { account: { kind: 'provider_clearing', provider: p.provider }, amount: -p.amount as Kobo },
    ],
    kind: 'wallet_funding',
    description: 'Wallet funding',
    by: { kind: 'provider', name: p.provider },
    now: p.now,
    reference: p.reference,
    provider: p.provider,
  });
}

/**
 * Trip paid from the wallet: the passenger's wallet goes down, the driver's earnings go up by the fare
 * (0% commission, D-024). Refused if the wallet can't cover it (no spending the same money twice).
 */
export function chargeTripFromWallet(entries: readonly LedgerEntry[], p: { passengerId: string; driverId: string; tripId: string; fare: Kobo; now: number }) {
  const wallet: LedgerAccount = { kind: 'passenger_wallet', ownerId: p.passengerId };
  const ref = `trip:${p.tripId}`;
  if (entries.some((e) => e.reference === ref && e.kind === 'trip_charge')) return postJournal(entries, { lines: [], kind: 'trip_charge', description: '', by: { kind: 'system', name: 'payments' }, now: p.now, reference: ref });
  if (balanceOf(entries, wallet) < p.fare) return { ok: false as const, error: 'insufficient_funds' as JournalError };
  return postJournal(entries, {
    lines: [
      { account: wallet, amount: -p.fare as Kobo },
      { account: { kind: 'driver_earnings', ownerId: p.driverId }, amount: p.fare },
    ],
    kind: 'trip_charge',
    description: 'Trip payment from wallet',
    by: { kind: 'system', name: 'payments' },
    now: p.now,
    reference: ref,
    links: { tripId: p.tripId },
  });
}

/** Withdrawable driver earnings = earnings account (reserve is moved out when a withdrawal is requested). */
export function withdrawable(entries: readonly LedgerEntry[], driverId: string): Kobo {
  return balanceOf(entries, { kind: 'driver_earnings', ownerId: driverId });
}

/** Reserve earnings for a withdrawal request so they can't be withdrawn twice. */
export function reserveWithdrawal(entries: readonly LedgerEntry[], p: { driverId: string; withdrawalId: string; amount: Kobo; now: number; by: Actor }) {
  if (p.amount <= 0 || withdrawable(entries, p.driverId) < p.amount) return { ok: false as const, error: 'insufficient_funds' as JournalError };
  return postJournal(entries, {
    lines: [
      { account: { kind: 'driver_earnings', ownerId: p.driverId }, amount: -p.amount as Kobo },
      { account: { kind: 'driver_withdrawal_reserve', ownerId: p.driverId }, amount: p.amount },
    ],
    kind: 'withdrawal_reserve',
    description: 'Withdrawal requested: earnings reserved',
    by: p.by,
    now: p.now,
    reference: `wd-reserve:${p.withdrawalId}`,
    links: { withdrawalId: p.withdrawalId },
  });
}

/** Payout confirmed by the provider: the reserve leaves to the provider. */
export function settleWithdrawal(entries: readonly LedgerEntry[], p: { driverId: string; withdrawalId: string; amount: Kobo; provider: string; reference: string; now: number }) {
  return postJournal(entries, {
    lines: [
      { account: { kind: 'driver_withdrawal_reserve', ownerId: p.driverId }, amount: -p.amount as Kobo },
      { account: { kind: 'provider_clearing', provider: p.provider }, amount: p.amount },
    ],
    kind: 'withdrawal_payout',
    description: 'Withdrawal paid out',
    by: { kind: 'provider', name: p.provider },
    now: p.now,
    reference: p.reference,
    provider: p.provider,
    links: { withdrawalId: p.withdrawalId },
  });
}

/** Failed, rejected or reversed payout: the reserve returns to withdrawable earnings. */
export function releaseWithdrawal(entries: readonly LedgerEntry[], p: { driverId: string; withdrawalId: string; amount: Kobo; now: number; by: Actor; reason: string }) {
  return postJournal(entries, {
    lines: [
      { account: { kind: 'driver_withdrawal_reserve', ownerId: p.driverId }, amount: -p.amount as Kobo },
      { account: { kind: 'driver_earnings', ownerId: p.driverId }, amount: p.amount },
    ],
    kind: 'withdrawal_release',
    description: 'Withdrawal not paid: earnings returned',
    by: p.by,
    now: p.now,
    reference: `wd-release:${p.withdrawalId}`,
    reason: p.reason,
    links: { withdrawalId: p.withdrawalId },
  });
}
