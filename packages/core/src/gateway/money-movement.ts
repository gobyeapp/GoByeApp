import { postJournal, type JournalLine } from '../platform/ledger';
import type { LedgerEntry, LedgerAccount } from '../platform/types';
import type { Kobo } from '../types';
import type { CollectionVerification, NormalisedWebhookEvent, TransferStatus } from './adapter';
import type { FeeQuote } from './fees';

/**
 * Money movement records and the guards that keep them correct (D-054).
 *
 * Every payment is recorded as separate figures, never one blended number:
 *   gross           what the customer paid the provider
 *   providerCharge  what the provider kept (a cost)
 *   gobyeFee        GoBye's own fee (income)
 *   walletMovement  what reached the wallet, or left driver earnings
 *   settlement      what the provider owes GoBye for this payment (gross − providerCharge)
 * The ledger journal posts each to its own account, so finance can reconcile each one.
 *
 * Sign convention (same as the rest of the ledger): balances owed to people and income are positive;
 * costs and money the provider owes GoBye (provider_clearing) are negative.
 */

export interface PaymentBreakdown {
  gross: Kobo;
  providerCharge: Kobo;
  /** Part of the provider charge GoBye absorbs (a processing cost). */
  providerChargeAbsorbed: Kobo;
  gobyeFee: Kobo;
  walletMovement: Kobo;
  settlement: Kobo;
}

export type CreditDecision =
  | { action: 'credit'; breakdown: PaymentBreakdown }
  | { action: 'already_credited' }
  | { action: 'wait'; reason: 'not_verified' | 'pending_at_provider' }
  | { action: 'investigate'; reason: 'amount_mismatch' | 'currency_mismatch' | 'reference_mismatch' | 'failed_at_provider'; detail: string };

/**
 * Decide whether a wallet funding may be credited. Credit happens only when the provider's own
 * server-to-server lookup says the payment succeeded for the exact amount and currency quoted. A webhook
 * is a hint to look, never proof. A reference already credited is never credited again.
 */
export function decideFundingCredit(p: {
  reference: string;
  quote: Pick<FeeQuote, 'customerPays' | 'recipientGets' | 'gobyeFee'>;
  verification: CollectionVerification | null;
  ledger: readonly LedgerEntry[];
  /** True when GoBye absorbs the provider charge for this operation. */
  providerChargeAbsorbedByGobye: boolean;
}): CreditDecision {
  if (p.ledger.some((e) => e.reference === p.reference && e.kind === 'wallet_funding')) return { action: 'already_credited' };
  const v = p.verification;
  if (!v) return { action: 'wait', reason: 'not_verified' };
  if (v.reference !== p.reference) return { action: 'investigate', reason: 'reference_mismatch', detail: `Provider answered for ${v.reference}` };
  if (v.status === 'pending') return { action: 'wait', reason: 'pending_at_provider' };
  if (v.status !== 'successful') return { action: 'investigate', reason: 'failed_at_provider', detail: `Provider status: ${v.status}` };
  if (v.currency !== 'NGN') return { action: 'investigate', reason: 'currency_mismatch', detail: `Received ${v.currency}` };
  if (v.amountReceived !== p.quote.customerPays) return { action: 'investigate', reason: 'amount_mismatch', detail: `Quoted ${p.quote.customerPays} kobo, received ${v.amountReceived} kobo` };
  const providerCharge = (v.providerCharge ?? 0) as Kobo;
  return {
    action: 'credit',
    breakdown: {
      gross: v.amountReceived,
      providerCharge,
      providerChargeAbsorbed: (p.providerChargeAbsorbedByGobye ? providerCharge : 0) as Kobo,
      gobyeFee: p.quote.gobyeFee,
      walletMovement: p.quote.recipientGets,
      settlement: (v.amountReceived - providerCharge) as Kobo,
    },
  };
}

/**
 * Journal lines for a verified wallet funding. Balanced by construction:
 *   wallet +W, fee income +F, processing costs −absorbed, provider clearing −settlement
 * Any rounding gap between the provider's actual charge and what the customer paid towards it goes to
 * suspense for finance to look at, instead of being hidden.
 */
export function fundingJournalLines(passengerId: string, provider: string, b: PaymentBreakdown): JournalLine[] {
  const lines: JournalLine[] = [
    { account: { kind: 'passenger_wallet', ownerId: passengerId }, amount: b.walletMovement },
    { account: { kind: 'provider_clearing', provider }, amount: -b.settlement as Kobo },
  ];
  if (b.gobyeFee) lines.push({ account: { kind: 'fee_income' }, amount: b.gobyeFee });
  if (b.providerChargeAbsorbed) lines.push({ account: { kind: 'processing_costs' }, amount: -b.providerChargeAbsorbed as Kobo });
  const gap = -lines.reduce((s, l) => s + l.amount, 0);
  if (gap) lines.push({ account: { kind: 'suspense' } as LedgerAccount, amount: gap as Kobo });
  return lines;
}

/** Post a verified funding once. Idempotent by provider reference (duplicate webhooks post nothing). */
export function postVerifiedFunding(ledger: readonly LedgerEntry[], p: { passengerId: string; provider: string; reference: string; breakdown: PaymentBreakdown; now: number }) {
  return postJournal(ledger, {
    lines: fundingJournalLines(p.passengerId, p.provider, p.breakdown),
    kind: 'wallet_funding',
    description: 'Wallet funding (verified with provider)',
    by: { kind: 'provider', name: p.provider },
    now: p.now,
    reference: p.reference,
    provider: p.provider,
  });
}

/* ---------- Payouts ---------- */

export type PayoutGuard =
  | { allowed: true }
  | { allowed: false; reason: 'already_submitted' | 'outcome_unknown' | 'already_paid' | 'not_approved'; next: string };

/**
 * May a transfer be submitted (or re-submitted) for this withdrawal? Never twice for the same
 * reference: if a previous attempt's outcome is unknown, the only safe step is to look it up.
 */
export function payoutGuard(p: { approved: boolean; lastAttempt?: { reference: string; outcome: 'submitted' | 'unknown' | 'failed_permanent' | 'failed_transient' }; providerStatus?: TransferStatus | null }): PayoutGuard {
  if (!p.approved) return { allowed: false, reason: 'not_approved', next: 'A finance reviewer must approve the withdrawal first.' };
  if (p.providerStatus?.status === 'successful') return { allowed: false, reason: 'already_paid', next: 'The provider already paid this. Nothing to retry.' };
  if (p.providerStatus?.status === 'processing') return { allowed: false, reason: 'already_submitted', next: 'The provider is still processing it. Wait for its result.' };
  if (p.lastAttempt?.outcome === 'unknown' && !p.providerStatus) return { allowed: false, reason: 'outcome_unknown', next: 'Look the transfer up with the provider by its reference before doing anything else.' };
  if (p.lastAttempt?.outcome === 'submitted' && !p.providerStatus) return { allowed: false, reason: 'already_submitted', next: 'Look the transfer up with the provider by its reference.' };
  return { allowed: true };
}

/* ---------- Webhook intake ---------- */

/**
 * First step for every webhook delivery: drop ones already seen (by provider event id). The event then
 * only triggers a server-side verification; it never changes money by itself.
 */
export function webhookIntake(seenEventIds: ReadonlySet<string>, e: NormalisedWebhookEvent): { action: 'ignore_duplicate' } | { action: 'verify'; reference: string; kind: 'collection' | 'transfer' | 'refund' | 'other' } {
  if (seenEventIds.has(e.eventId)) return { action: 'ignore_duplicate' };
  const kind = e.type.startsWith('collection') ? 'collection' : e.type.startsWith('transfer') ? 'transfer' : e.type.startsWith('refund') ? 'refund' : 'other';
  return { action: 'verify', reference: e.reference, kind };
}

/* ---------- Switching gateways ---------- */

export interface SwitchReadiness {
  canSwitch: boolean;
  blockers: string[];
  /** Work that continues on the old provider after the switch (it is drained, never cut off). */
  drain: string[];
}

/**
 * Switching the provider used for NEW payments. Money already in flight stays on the old provider until
 * it finishes; its webhooks and lookups keep working. Blocked unless the new provider is live, has every
 * required capability, and the switch is approved by the owner.
 */
export function switchReadiness(p: {
  target: { key: string; state: 'prototype' | 'configured' | 'tested' | 'live' | 'degraded'; missingCapabilities: string[] } | null;
  current: { key: string; pendingCollections: number; processingTransfers: number; unreconciledDays: number } | null;
  approved: boolean;
}): SwitchReadiness {
  const blockers: string[] = [];
  const drain: string[] = [];
  if (!p.target) blockers.push('Choose the provider to switch to.');
  else {
    if (p.current && p.target.key === p.current.key) blockers.push('That provider is already in use.');
    if (p.target.state !== 'live') blockers.push(`The new provider is ${p.target.state}, not live. Every live check must pass first.`);
    if (p.target.missingCapabilities.length) blockers.push(`The new provider can't yet: ${p.target.missingCapabilities.join(', ')}.`);
  }
  if (p.current) {
    if (p.current.unreconciledDays > 0) blockers.push(`Reconcile the current provider first (${p.current.unreconciledDays} day(s) not reconciled).`);
    if (p.current.pendingCollections) drain.push(`${p.current.pendingCollections} pending payment(s) finish on ${p.current.key}.`);
    if (p.current.processingTransfers) drain.push(`${p.current.processingTransfers} payout(s) in progress finish on ${p.current.key}.`);
  }
  if (!p.approved) blockers.push('The owner must approve the switch (a second person, not the requester).');
  return { canSwitch: blockers.length === 0, blockers, drain };
}
