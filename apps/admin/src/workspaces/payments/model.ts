import {
  AUTOMATIONS,
  REQUIRED_CAPABILITIES,
  payoutGuard,
  type AutomationRun,
  type CollectionRecord,
  type FeeBearer,
  type FeeCollection,
  type FeeFormula,
  type FeeOperation,
  type FeeRule,
  type FeeSchedule,
  type GatewayCapability,
  type Kobo,
  type PlatformDataset,
  type WithdrawalRecord,
} from '@gobye/core';
import { providerKey, PROVIDERS } from './logic';

/**
 * UI-side helpers for the Payments pages (fees, health, operations, switching). Pure functions over
 * the shared test records; nothing here reaches a provider.
 */

/* ---------- Naira / percent input ---------- */

/** "1,250.50" → 125050 kobo. Empty → null. Invalid → NaN. */
export function nairaToKobo(input: string): number | null {
  const s = input.replace(/[₦,\s]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}
/** "1.5" (percent) → 150 bps. */
export function percentToBps(input: string): number | null {
  const s = input.replace(/[%\s]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}
const koboText = (k: number | undefined) => (k === undefined ? '' : String(k / 100));
const bpsText = (b: number) => (b ? String(b / 100) : '');

/* ---------- Fee rule form ---------- */

export interface FormulaForm {
  set: boolean;
  fixed: string;
  percent: string;
  min: string;
  cap: string;
}
export interface RuleForm {
  operation: FeeOperation;
  provider: string;
  gobye: FormulaForm;
  estimate: FormulaForm;
  bearer: FeeBearer;
  collection: FeeCollection;
  min: string;
  max: string;
  dailyMax: string;
  freePerMonth: string;
  freeAtOrBelow: string;
}

const formulaForm = (f: FeeFormula | null): FormulaForm =>
  f ? { set: true, fixed: koboText(f.fixed || undefined), percent: bpsText(f.percentBps), min: koboText(f.min), cap: koboText(f.cap) } : { set: false, fixed: '', percent: '', min: '', cap: '' };

export function ruleToForm(r: FeeRule): RuleForm {
  const free = r.exemptions.find((e) => e.kind === 'free_per_month');
  const below = r.exemptions.find((e) => e.kind === 'at_or_below');
  return {
    operation: r.operation,
    provider: r.provider,
    gobye: formulaForm(r.gobyeFee),
    estimate: formulaForm(r.providerChargeEstimate),
    bearer: r.providerChargeBearer,
    collection: r.collection,
    min: koboText(r.limits.min),
    max: koboText(r.limits.max),
    dailyMax: koboText(r.limits.dailyMax),
    freePerMonth: free && free.kind === 'free_per_month' ? String(free.count) : '',
    freeAtOrBelow: below && below.kind === 'at_or_below' ? koboText(below.amount) : '',
  };
}

export type FormErrors = Record<string, string>;

function formulaFrom(f: FormulaForm, prefix: string, errors: FormErrors): FeeFormula | null {
  if (!f.set) return null;
  const fixed = nairaToKobo(f.fixed) ?? 0;
  const bps = percentToBps(f.percent) ?? 0;
  const min = nairaToKobo(f.min);
  const cap = nairaToKobo(f.cap);
  if (Number.isNaN(fixed)) errors[`${prefix}.fixed`] = 'Enter an amount in naira, like 50 or 50.25';
  if (Number.isNaN(bps)) errors[`${prefix}.percent`] = 'Enter a percent, like 1.5';
  if (min !== null && Number.isNaN(min)) errors[`${prefix}.min`] = 'Enter an amount in naira';
  if (cap !== null && Number.isNaN(cap)) errors[`${prefix}.cap`] = 'Enter an amount in naira';
  if (!Number.isNaN(fixed) && !Number.isNaN(bps) && fixed === 0 && bps === 0 && f.fixed.trim() === '' && f.percent.trim() === '') errors[`${prefix}.fixed`] = 'Enter a fixed amount, a percent or both (0 is allowed), or choose Not set';
  return { fixed: fixed as Kobo, percentBps: bps, ...(min !== null && !Number.isNaN(min) ? { min: min as Kobo } : {}), ...(cap !== null && !Number.isNaN(cap) ? { cap: cap as Kobo } : {}) };
}

export function formToRule(f: RuleForm): { rule: FeeRule; errors: FormErrors } {
  const errors: FormErrors = {};
  const p = `${f.operation}`;
  const gobyeFee = formulaFrom(f.gobye, `${p}.gobye`, errors);
  const providerChargeEstimate = formulaFrom(f.estimate, `${p}.estimate`, errors);
  const amt = (v: string, key: string, required: boolean) => {
    const k = nairaToKobo(v);
    if (k === null) {
      if (required) errors[`${p}.${key}`] = 'Required';
      return undefined;
    }
    if (Number.isNaN(k)) {
      errors[`${p}.${key}`] = 'Enter an amount in naira';
      return undefined;
    }
    return k as Kobo;
  };
  const min = amt(f.min, 'min', true) ?? (0 as Kobo);
  const max = amt(f.max, 'max', true) ?? (0 as Kobo);
  const dailyMax = amt(f.dailyMax, 'dailyMax', false);
  const exemptions: FeeRule['exemptions'] = [];
  if (f.freePerMonth.trim()) {
    const n = Number(f.freePerMonth);
    if (!Number.isInteger(n) || n < 1) errors[`${p}.freePerMonth`] = 'Enter a whole number of 1 or more';
    else exemptions.push({ kind: 'free_per_month', count: n });
  }
  const below = amt(f.freeAtOrBelow, 'freeAtOrBelow', false);
  if (below !== undefined) exemptions.push({ kind: 'at_or_below', amount: below });
  return {
    rule: { operation: f.operation, provider: f.provider, gobyeFee, providerChargeEstimate, providerChargeBearer: f.bearer, collection: f.collection, limits: { min, max, ...(dailyMax !== undefined ? { dailyMax } : {}) }, exemptions },
    errors,
  };
}

/** Lagos midnight at the start of a calendar date typed as YYYY MM DD (from a date input). */
export function lagosDateToMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 3_600_000;
}
export function msToDateInput(ms: number): string {
  return new Date(ms + 3_600_000).toISOString().slice(0, 10);
}

export const nextScheduleVersion = (xs: Pick<FeeSchedule, 'version'>[]) => xs.reduce((m, s) => Math.max(m, s.version), 0) + 1;
export const nextScheduleId = (xs: Pick<FeeSchedule, 'id'>[]) => {
  const max = xs.reduce((m, s) => Math.max(m, Number(/^fee-v(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `fee-v${max + 1}`;
};

/* ---------- Providers and switching ---------- */

export const CAPABILITY_LABEL: Record<GatewayCapability, string> = {
  collect_bank_transfer: 'Collect by bank transfer',
  collect_card: 'Collect by card',
  payout_bank_transfer: 'Pay out to bank accounts',
  refund: 'Refunds',
  webhook_signature: 'Signed webhooks',
  transaction_lookup: 'Look up a payment by reference',
  bank_account_resolve: 'Check a bank account name',
  settlement_report: 'Settlement reports',
};

/**
 * Capability coverage per provider. Only an implemented adapter can cover anything; Paystack is the
 * planned provider and its adapter is not built yet, so every capability shows as "planned".
 */
export function capabilityCoverage(): { key: string; name: string; implemented: boolean; covered: GatewayCapability[]; planned: GatewayCapability[] }[] {
  return PROVIDERS.map((p) => ({ key: p.key, name: p.name, implemented: p.implemented, covered: [], planned: p.implemented ? [...REQUIRED_CAPABILITIES] : [] }));
}

/** Days whose reconciliation did not finish: latest run per subject that is not succeeded. */
export function unreconciledDays(runs: readonly AutomationRun[]): number {
  const latest = new Map<string, AutomationRun>();
  for (const r of runs.filter((x) => x.automationId === 'payments.reconcile.daily' && x.subject?.type === 'day' && x.status !== 'queued')) {
    const k = r.subject!.id;
    const prev = latest.get(k);
    if (!prev || (r.finishedAt ?? r.queuedAt) > (prev.finishedAt ?? prev.queuedAt)) latest.set(k, r);
  }
  return [...latest.values()].filter((r) => r.status !== 'succeeded').length;
}

/* ---------- Gateway health ---------- */

export function webhookStats(collections: readonly CollectionRecord[], key: string) {
  const evs = collections.filter((c) => providerKey(c.provider) === key).flatMap((c) => c.events);
  const duplicates = evs.filter((e) => e.duplicate).length;
  return { total: evs.length, processed: evs.length - duplicates, duplicates, lastAt: evs.reduce<number | undefined>((m, e) => (m === undefined || e.at > m ? e.at : m), undefined) };
}

export function pendingCollections(collections: readonly CollectionRecord[], key: string, now: number) {
  const xs = collections.filter((c) => providerKey(c.provider) === key && (c.status === 'pending' || c.status === 'initiated'));
  const oldest = xs.reduce<number | undefined>((m, c) => (m === undefined || c.createdAt < m ? c.createdAt : m), undefined);
  return { count: xs.length, oldestAgeMs: oldest === undefined ? undefined : now - oldest };
}

export function lastReconciliation(runs: readonly AutomationRun[]): AutomationRun | undefined {
  return runs.filter((r) => r.automationId === 'payments.reconcile.daily' && r.status !== 'queued').sort((a, b) => (b.finishedAt ?? b.queuedAt) - (a.finishedAt ?? a.queuedAt))[0];
}

/* ---------- Payment operations (money movement) ---------- */

export type MovementType = 'wallet_funding' | 'package_purchase' | 'trip_payment' | 'withdrawal';
export const MOVEMENT_LABEL: Record<MovementType, string> = { wallet_funding: 'Wallet funding', package_purchase: 'Package purchase', trip_payment: 'Trip payment', withdrawal: 'Withdrawal' };

export interface MovementRow {
  id: string;
  type: MovementType;
  source: 'collection' | 'withdrawal';
  personType: 'passenger' | 'driver';
  personId: string;
  status: string;
  provider: string;
  reference: string;
  at: number;
  gross: number;
  providerCharge: number | null;
  gobyeFee: number;
  /** What reached the wallet (+), driver earnings (+) or left earnings (−). Null when nothing moved. */
  movement: number | null;
  movementLabel: string;
  settlement: number | null;
  stuck: boolean;
  safety: string;
}

const STUCK_MS = 30 * 60_000;

function collectionRow(c: CollectionRecord, now: number): MovementRow {
  const done = c.status === 'successful';
  const pending = c.status === 'pending' || c.status === 'initiated';
  const movementLabel = c.purpose === 'wallet_funding' ? 'Wallet' : c.purpose === 'package_purchase' ? 'Package revenue' : 'Driver earnings';
  return {
    id: c.id,
    type: c.purpose,
    source: 'collection',
    personType: c.payerType,
    personId: c.payerId,
    status: c.status,
    provider: c.provider,
    reference: c.reference,
    at: c.createdAt,
    gross: c.amount,
    providerCharge: done ? c.fee : null,
    gobyeFee: 0,
    movement: done ? c.amount : null,
    movementLabel,
    settlement: done ? c.amount - c.fee : null,
    stuck: pending && now - c.createdAt > STUCK_MS,
    safety: done
      ? 'Credited once, after the provider lookup confirmed it. A repeat webhook for this reference posts nothing.'
      : pending
        ? 'Nothing is credited until the provider lookup confirms the payment for the exact amount.'
        : 'Not credited. A failed or abandoned payment never reaches a wallet or earnings.',
  };
}

function withdrawalRow(w: WithdrawalRecord, now: number): MovementRow {
  const paid = w.status === 'successful';
  const lastProcessing = [...w.history].reverse().find((h) => h.status === 'processing');
  const guard = payoutGuard({
    approved: !['requested', 'under_review', 'rejected'].includes(w.status),
    lastAttempt: w.transferReference ? { reference: w.transferReference, outcome: w.status === 'processing' ? 'unknown' : w.status === 'failed' ? 'failed_permanent' : 'submitted' } : undefined,
    providerStatus: w.transferReference
      ? w.status === 'successful' || w.status === 'failed' || w.status === 'reversed'
        ? { reference: w.transferReference, status: w.status, amount: w.amount, providerCharge: null }
        : null
      : null,
  });
  return {
    id: w.id,
    type: 'withdrawal',
    source: 'withdrawal',
    personType: 'driver',
    personId: w.driverId,
    status: w.status,
    provider: w.provider ?? 'Not submitted',
    reference: w.transferReference ?? 'Not submitted',
    at: w.requestedAt,
    gross: w.amount,
    providerCharge: null,
    gobyeFee: 0,
    movement: ['rejected', 'failed', 'reversed'].includes(w.status) ? null : -w.amount,
    movementLabel: 'Driver earnings',
    settlement: paid ? w.amount : null,
    stuck: w.status === 'processing' && !!lastProcessing && now - lastProcessing.at > STUCK_MS,
    safety: guard.allowed ? 'A transfer may be submitted once, with the withdrawal id as its reference.' : guard.next,
  };
}

export function movementRows(d: Pick<PlatformDataset, 'collections' | 'withdrawals'>, now: number): MovementRow[] {
  return [...d.collections.map((c) => collectionRow(c, now)), ...d.withdrawals.map((w) => withdrawalRow(w, now))].sort((a, b) => b.at - a.at);
}

export const PAYMENT_AUTOMATIONS = AUTOMATIONS.filter((a) => a.area === 'payments' || a.area === 'wallet' || a.area === 'reconciliation' || a.id === 'subscription.activate');
