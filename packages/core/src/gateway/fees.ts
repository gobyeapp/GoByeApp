import { formatNaira } from '../money';
import type { Kobo } from '../types';

/**
 * Transaction fee schedules for wallet funding and withdrawals (D-054).
 *
 * - Fees are VERSIONED and EFFECTIVE-DATED; a new version needs owner approval before it applies.
 * - A fee that has not been decided is `null` ("not set"), never a guessed number. An operation whose
 *   fee is not set cannot be quoted, so nothing can be charged by accident.
 * - Two fees are kept apart: GoBye's own fee (company income) and the provider's charge (a cost that
 *   either GoBye absorbs or the customer pays). The provider's actual charge comes from the provider;
 *   the schedule only holds an approved estimate for disclosure.
 * - Percentages are basis points (1% = 100 bps) so all arithmetic is integer kobo.
 * - Driver package prices and the 0% trip commission are NOT here; they are confirmed pricing (BR-060,
 *   BR-062) and live in `DRIVER_ACCESS_PACKAGES`.
 */

export type FeeOperation = 'wallet_funding' | 'withdrawal';
export const FEE_OPERATION_LABEL: Record<FeeOperation, string> = { wallet_funding: 'Wallet funding', withdrawal: 'Driver withdrawal' };

export interface FeeFormula {
  fixed: Kobo;
  /** Basis points of the amount (150 = 1.5%). */
  percentBps: number;
  min?: Kobo;
  cap?: Kobo;
}

/**
 * Who pays a fee: the customer (passenger for funding, driver for withdrawals) or GoBye.
 * `add`: added on top (customer pays amount + fee, the full amount arrives).
 * `deduct`: taken out of the amount (customer pays the amount, less arrives).
 */
export type FeeBearer = 'customer' | 'gobye';
export type FeeCollection = 'add' | 'deduct';

export type FeeExemption =
  /** The first N operations in a calendar month (Lagos time) carry no GoBye fee. */
  | { kind: 'free_per_month'; count: number }
  /** No GoBye fee at or below this amount. */
  | { kind: 'at_or_below'; amount: Kobo };

export interface FeeRule {
  operation: FeeOperation;
  /** Provider key the rule applies to, or '*' for any provider. A provider-specific rule wins. */
  provider: string;
  /** GoBye's own fee. `null` = not set (operation blocked until approved). */
  gobyeFee: FeeFormula | null;
  /** Approved estimate of the provider's charge, for disclosure. `null` = not known yet. */
  providerChargeEstimate: FeeFormula | null;
  providerChargeBearer: FeeBearer;
  collection: FeeCollection;
  limits: { min: Kobo; max: Kobo; dailyMax?: Kobo };
  exemptions: FeeExemption[];
}

export type FeeScheduleStatus = 'draft' | 'pending_approval' | 'scheduled' | 'active' | 'superseded' | 'rejected';

export interface FeeSchedule {
  id: string;
  version: number;
  status: FeeScheduleStatus;
  effectiveFrom: number;
  rules: FeeRule[];
  note: string;
  createdBy: { id: string; name: string };
  createdAt: number;
  approvedBy?: { id: string; name: string };
  approvedAt?: number;
}

export function computeFee(f: FeeFormula, amount: Kobo): Kobo {
  let fee = f.fixed + Math.round((amount * f.percentBps) / 10_000);
  if (f.min !== undefined) fee = Math.max(fee, f.min);
  if (f.cap !== undefined) fee = Math.min(fee, f.cap);
  return Math.max(0, fee) as Kobo;
}

/** The version in force at `at`: the latest active/scheduled version whose effective date has passed. */
export function scheduleInForce(schedules: readonly FeeSchedule[], at: number): FeeSchedule | undefined {
  return schedules
    .filter((s) => (s.status === 'active' || s.status === 'scheduled' || s.status === 'superseded') && s.approvedBy && s.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.version - a.version)[0];
}

export function ruleFor(schedule: FeeSchedule, operation: FeeOperation, provider: string): FeeRule | undefined {
  return schedule.rules.find((r) => r.operation === operation && r.provider === provider) ?? schedule.rules.find((r) => r.operation === operation && r.provider === '*');
}

export type QuoteBlock = 'no_schedule' | 'no_rule' | 'fee_not_set' | 'provider_not_selected' | 'below_minimum' | 'above_maximum' | 'over_daily_limit' | 'invalid_amount';

export interface FeeQuote {
  operation: FeeOperation;
  scheduleId: string;
  scheduleVersion: number;
  provider: string;
  /** What the customer asked to move (fund wallet with / withdraw). */
  amount: Kobo;
  gobyeFee: Kobo;
  /** Estimate; the provider's actual charge is recorded when the provider reports it. Null = not known. */
  providerChargeEstimate: Kobo | null;
  /** Total the customer pays (funding) or that leaves their earnings (withdrawal). */
  customerPays: Kobo;
  /** What lands in the wallet (funding) or the bank account (withdrawal). */
  recipientGets: Kobo;
  exemption?: FeeExemption;
  /** Plain lines shown to the customer before they confirm (BR-105 style disclosure). */
  disclosure: string[];
}

export interface QuoteContext {
  /** Provider currently selected for this operation; quoting refuses without one. */
  provider: string | null;
  /** Successful operations of this kind this month by this customer (for free_per_month). */
  monthCount?: number;
  /** Amount already moved today by this customer (for dailyMax). */
  todayTotal?: Kobo;
}

export function quoteFee(
  schedules: readonly FeeSchedule[],
  operation: FeeOperation,
  amount: Kobo,
  at: number,
  ctx: QuoteContext,
): { ok: true; quote: FeeQuote } | { ok: false; block: QuoteBlock; message: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, block: 'invalid_amount', message: 'Enter an amount above ₦0.' };
  if (!ctx.provider) return { ok: false, block: 'provider_not_selected', message: 'Payments are not set up yet.' };
  const s = scheduleInForce(schedules, at);
  if (!s) return { ok: false, block: 'no_schedule', message: 'Fees for this are not approved yet.' };
  const rule = ruleFor(s, operation, ctx.provider);
  if (!rule) return { ok: false, block: 'no_rule', message: 'Fees for this are not approved yet.' };
  if (rule.gobyeFee === null) return { ok: false, block: 'fee_not_set', message: 'Fees for this are not approved yet.' };
  if (amount < rule.limits.min) return { ok: false, block: 'below_minimum', message: `The minimum is ${formatNaira(rule.limits.min)}.` };
  if (amount > rule.limits.max) return { ok: false, block: 'above_maximum', message: `The maximum is ${formatNaira(rule.limits.max)}.` };
  if (rule.limits.dailyMax !== undefined && (ctx.todayTotal ?? 0) + amount > rule.limits.dailyMax)
    return { ok: false, block: 'over_daily_limit', message: `That goes over today's limit of ${formatNaira(rule.limits.dailyMax)}.` };

  const exemption = rule.exemptions.find((e) => (e.kind === 'free_per_month' ? (ctx.monthCount ?? 0) < e.count : amount <= e.amount));
  const gobyeFee = exemption ? (0 as Kobo) : computeFee(rule.gobyeFee, amount);
  const est = rule.providerChargeEstimate ? computeFee(rule.providerChargeEstimate, amount) : null;
  const customerProvider = rule.providerChargeBearer === 'customer' ? (est ?? 0) : 0;
  const customerFees = gobyeFee + customerProvider;
  const customerPays = (rule.collection === 'add' ? amount + customerFees : amount) as Kobo;
  const recipientGets = (rule.collection === 'add' ? amount : amount - customerFees) as Kobo;
  if (recipientGets <= 0) return { ok: false, block: 'below_minimum', message: 'The amount is too small to cover the fee.' };

  const verb = operation === 'wallet_funding' ? 'added to your wallet' : 'sent to your bank';
  const disclosure: string[] = [];
  disclosure.push(gobyeFee > 0 ? `GoBye fee: ${formatNaira(gobyeFee)}` : exemption ? 'GoBye fee: ₦0 (free this time)' : 'GoBye fee: ₦0');
  if (rule.providerChargeBearer === 'customer') {
    disclosure.push(est === null ? 'Payment provider charge: shown by your bank or provider' : `Payment provider charge: about ${formatNaira(est)}`);
  }
  disclosure.push(`You pay: ${formatNaira(customerPays)}`);
  disclosure.push(`Amount ${verb}: ${formatNaira(recipientGets)}`);

  return {
    ok: true,
    quote: { operation, scheduleId: s.id, scheduleVersion: s.version, provider: ctx.provider, amount, gobyeFee, providerChargeEstimate: est, customerPays, recipientGets, exemption, disclosure },
  };
}

export interface ScheduleProblem {
  field: string;
  message: string;
}

/** Checks before a draft can be sent for approval. Empty list = valid. */
export function validateSchedule(s: Pick<FeeSchedule, 'rules' | 'effectiveFrom'>, now: number): ScheduleProblem[] {
  const out: ScheduleProblem[] = [];
  if (s.effectiveFrom <= now) out.push({ field: 'effectiveFrom', message: 'Start date must be in the future, so customers are never charged a fee they were not shown.' });
  const seen = new Set<string>();
  s.rules.forEach((r, i) => {
    const at = `${r.operation} (${r.provider === '*' ? 'any provider' : r.provider})`;
    const key = `${r.operation}|${r.provider}`;
    if (seen.has(key)) out.push({ field: `rules.${i}`, message: `${at}: listed twice` });
    seen.add(key);
    const formula = (f: FeeFormula | null, name: string) => {
      if (!f) return;
      if (f.fixed < 0 || f.percentBps < 0) out.push({ field: `rules.${i}.${name}`, message: `${at}: ${name} can't be negative` });
      if (f.percentBps > 1_000) out.push({ field: `rules.${i}.${name}`, message: `${at}: ${name} above 10% needs a second look` });
      if (f.min !== undefined && f.cap !== undefined && f.min > f.cap) out.push({ field: `rules.${i}.${name}`, message: `${at}: ${name} minimum is above its cap` });
    };
    formula(r.gobyeFee, 'GoBye fee');
    formula(r.providerChargeEstimate, 'provider charge');
    if (r.limits.min <= 0) out.push({ field: `rules.${i}.limits`, message: `${at}: minimum amount must be above ₦0` });
    if (r.limits.max < r.limits.min) out.push({ field: `rules.${i}.limits`, message: `${at}: maximum is below the minimum` });
    if (r.limits.dailyMax !== undefined && r.limits.dailyMax < r.limits.max) out.push({ field: `rules.${i}.limits`, message: `${at}: daily limit is below the single-payment maximum` });
    for (const e of r.exemptions) {
      if (e.kind === 'free_per_month' && (!Number.isInteger(e.count) || e.count < 1)) out.push({ field: `rules.${i}.exemptions`, message: `${at}: free-per-month count must be a whole number of 1 or more` });
      if (e.kind === 'at_or_below' && e.amount <= 0) out.push({ field: `rules.${i}.exemptions`, message: `${at}: exemption amount must be above ₦0` });
    }
  });
  return out;
}

/** Field-by-field differences for the approval screen and audit trail. */
export function diffRules(from: FeeRule | undefined, to: FeeRule): { field: string; from: string; to: string }[] {
  const f = (x: FeeFormula | null | undefined) =>
    x === undefined ? 'None' : x === null ? 'Not set' : [x.fixed ? formatNaira(x.fixed) : '', x.percentBps ? `${x.percentBps / 100}%` : '', x.min !== undefined ? `min ${formatNaira(x.min)}` : '', x.cap !== undefined ? `cap ${formatNaira(x.cap)}` : ''].filter(Boolean).join(' + ') || '₦0';
  const rows: [string, string, string][] = [
    ['GoBye fee', f(from?.gobyeFee), f(to.gobyeFee)],
    ['Provider charge estimate', f(from?.providerChargeEstimate), f(to.providerChargeEstimate)],
    ['Provider charge paid by', from?.providerChargeBearer ?? 'None', to.providerChargeBearer],
    ['Fee taken', from?.collection ?? 'None', to.collection],
    ['Limits', from ? `${formatNaira(from.limits.min)} to ${formatNaira(from.limits.max)}` : 'None', `${formatNaira(to.limits.min)} to ${formatNaira(to.limits.max)}`],
    ['Daily limit', from?.limits.dailyMax !== undefined ? formatNaira(from.limits.dailyMax) : 'None', to.limits.dailyMax !== undefined ? formatNaira(to.limits.dailyMax) : 'None'],
    ['Exemptions', from ? exemptionText(from.exemptions) : 'None', exemptionText(to.exemptions)],
  ];
  return rows.filter(([, a, b]) => a !== b).map(([field, a, b]) => ({ field, from: a, to: b }));
}

export function exemptionText(xs: FeeExemption[]): string {
  if (!xs.length) return 'None';
  return xs.map((e) => (e.kind === 'free_per_month' ? `first ${e.count} free each month` : `free at or below ${formatNaira(e.amount)}`)).join('; ');
}

/**
 * Owner approval of a fee schedule waiting for approval. Becomes `scheduled` (or `active` if its date has
 * passed); the version it replaces is superseded when it takes effect. Never applied to the past.
 */
export function approveFeeSchedule(schedules: FeeSchedule[], id: string, by: { id: string; name: string }, now: number): { ok: true } | { ok: false; error: string } {
  const s = schedules.find((x) => x.id === id);
  if (!s) return { ok: false, error: 'Fee schedule not found' };
  if (s.status !== 'pending_approval') return { ok: false, error: `This schedule is ${s.status.replace(/_/g, ' ')}, not waiting for approval` };
  if (s.createdBy.id === by.id) return { ok: false, error: 'Nobody approves their own fee schedule' };
  if (s.effectiveFrom <= now) return { ok: false, error: 'Its start date has passed. Finance must set a new future date and send it again.' };
  s.status = 'scheduled';
  s.approvedBy = by;
  s.approvedAt = now;
  return { ok: true };
}

/** Move schedules whose date has come to active, superseding the one before (what a daily job does). */
export function activateDueSchedules(schedules: FeeSchedule[], now: number): void {
  const due = schedules.filter((s) => s.status === 'scheduled' && s.effectiveFrom <= now).sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  for (const s of due) {
    for (const o of schedules) if (o.status === 'active' && o.effectiveFrom <= s.effectiveFrom) o.status = 'superseded';
    s.status = 'active';
  }
}
