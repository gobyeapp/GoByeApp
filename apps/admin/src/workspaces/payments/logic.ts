import { CONNECTION_FLOW, canGoLive, canTransition, type ApprovalRequest, type IntegrationRecord, type PlatformDataset } from '@gobye/core';
import { externalCheck, maskSecret } from '../developer/logic';

/**
 * Pure logic for the owner's Payments setup page. Nothing here reaches a provider; it reads the shared
 * test records and describes readiness honestly.
 */

export type Check = IntegrationRecord['checks'][number];

/* ---------- Provider catalogue ---------- */

export interface ProviderOption {
  key: string;
  name: string;
  implemented: boolean;
  note: string;
}

/** Only providers GoBye has built against can be chosen. The others are listed so the owner knows why not. */
export const PROVIDERS: ProviderOption[] = [
  { key: 'paystack', name: 'Paystack', implemented: true, note: 'Planned provider. Collections, transfer payouts and refunds.' },
  { key: 'flutterwave', name: 'Flutterwave', implemented: false, note: 'Not implemented in GoBye. Needs its own integration and checks.' },
  { key: 'monnify', name: 'Monnify', implemented: false, note: 'Not implemented in GoBye. Needs its own integration and checks.' },
];

/** "Paystack (test)" → "paystack". Records keep the provider string they were created with. */
export function providerKey(s: string | undefined): string {
  return (s ?? '').replace(/\(.*\)/g, '').trim().toLowerCase();
}

export function paymentIntegrations(all: IntegrationRecord[], key = 'paystack') {
  const xs = all.filter((i) => i.area === 'payments' && providerKey(i.provider) === key);
  return { test: xs.find((i) => i.environment === 'test'), live: xs.find((i) => i.environment === 'live') };
}

/* ---------- Capabilities ---------- */

export function splitCapabilities(caps: string[]) {
  const collection = caps.filter((c) => /collect|virtual account|card|charge/i.test(c));
  const payout = caps.filter((c) => /transfer|payout/i.test(c) && !collection.includes(c));
  const other = caps.filter((c) => !collection.includes(c) && !payout.includes(c));
  return { collection, payout, other };
}

/* ---------- Readiness stepper ---------- */

export type StepStatus = 'done' | 'todo' | 'blocked' | 'not_needed';
export interface ReadinessStep {
  key: 'business' | 'settlement' | 'webhooks' | 'checks' | 'live';
  label: string;
  status: StepStatus;
  detail: string;
}

const find = (checks: Check[], re: RegExp) => checks.filter((c) => re.test(c.name));

/**
 * Five steps per environment. Test mode doesn't need business verification or a settlement account.
 * "Live" is done only when the record is live, which requires every check to have passed.
 */
export function readinessSteps(i: IntegrationRecord | undefined, env: 'test' | 'live'): ReadinessStep[] {
  const checks = i?.checks ?? [];
  const step = (key: ReadinessStep['key'], label: string, re: RegExp | null, needed: boolean): ReadinessStep => {
    if (!needed) return { key, label, status: 'not_needed', detail: 'Not needed in Paystack test mode' };
    if (!i) return { key, label, status: 'todo', detail: 'No configuration yet' };
    const xs = re ? find(checks, re) : [];
    if (!xs.length) return { key, label, status: 'todo', detail: 'No check recorded yet' };
    const failing = xs.filter((c) => !c.passed);
    if (!failing.length) return { key, label, status: 'done', detail: `${xs.length === 1 ? 'Check passed' : `${xs.length} checks passed`}` };
    const f = failing[0]!;
    return { key, label, status: externalCheck(f.name) ? 'blocked' : 'todo', detail: f.detail ?? 'Not passed yet' };
  };
  const all = canGoLive(checks);
  const failing = checks.filter((c) => !c.passed).length;
  return [
    step('business', 'Business verification', /business verification/i, env === 'live'),
    step('settlement', 'Settlement account', /settlement account/i, env === 'live'),
    step('webhooks', 'Webhooks', /webhook/i, true),
    {
      key: 'checks',
      label: 'Checks passed',
      status: !i || !checks.length ? 'todo' : all ? 'done' : 'todo',
      detail: !i || !checks.length ? 'No checks run yet' : all ? `All ${checks.length} checks passed` : `${failing} of ${checks.length} checks not passed`,
    },
    env === 'test'
      ? { key: 'live', label: 'Live', status: 'not_needed', detail: i?.state === 'tested' ? 'Test mode is tested. Live uses the live configuration' : 'Test mode never takes real payments' }
      : { key: 'live', label: 'Live', status: i?.state === 'live' ? 'done' : 'todo', detail: i?.state === 'live' ? 'Live' : 'Not live. Needs every check passed and owner approval' },
  ];
}

/* ---------- Going live ---------- */

/** Owner approval of live activation is allowed only when the live record can move to live and every check passed. */
export function liveGate(live: IntegrationRecord | undefined): { allowed: boolean; reason?: string } {
  if (!live) return { allowed: false, reason: 'There is no live configuration yet' };
  const failing = live.checks.filter((c) => !c.passed).length;
  if (!canGoLive(live.checks)) return { allowed: false, reason: live.checks.length ? `Blocked: ${failing} of ${live.checks.length} live checks have not passed` : 'Blocked: no live checks have run' };
  if (!canTransition(CONNECTION_FLOW, live.state, 'live')) return { allowed: false, reason: `Blocked: the live configuration is ${live.state}. It must be tested first` };
  return { allowed: true };
}

export const isLiveRequest = (a: ApprovalRequest) => a.kind === 'payments_activation' && !isSettlementRequest(a);
export const isSettlementRequest = (a: ApprovalRequest) => a.kind === 'payments_activation' && /^Change settlement destination/.test(a.title);

/* ---------- Setup problems ---------- */

export interface SetupProblem {
  id: string;
  integrationId: string;
  environment: 'test' | 'live';
  check: string;
  waitingOn: 'Owner' | 'Provider' | string;
  text: string;
}

/** Every failing check as a to do with who it is waiting on. */
export function setupProblems(integrations: (IntegrationRecord | undefined)[]): SetupProblem[] {
  const out: SetupProblem[] = [];
  for (const i of integrations) {
    if (!i) continue;
    for (const c of i.checks) {
      if (c.passed) continue;
      const ext = externalCheck(c.name);
      const waitingOn = ext ? (ext.waitingOn === 'owner' ? 'Owner' : 'Provider') : i.owner;
      const detail = c.detail ?? ext?.detail ?? `Waiting on ${i.owner}`;
      out.push({
        id: `${i.id}:${c.name}`,
        integrationId: i.id,
        environment: i.environment,
        check: c.name,
        waitingOn,
        text: `${c.name}: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`,
      });
    }
  }
  // Owner items first: they are the ones this page can move.
  return out.sort((a, b) => Number(b.waitingOn === 'Owner') - Number(a.waitingOn === 'Owner'));
}

/* ---------- What a provider switch would affect ---------- */

export interface Exposure {
  provider: string;
  pendingCollections: number;
  processingWithdrawals: number;
  openRefunds: number;
}

const OPEN_REFUND = ['requested', 'approved', 'processing'];

/**
 * In-flight work tied to a provider. Records keep their provider, so a switch never orphans them.
 * Refunds to the original method go back through the provider that collected; wallet refunds don't.
 */
export function providerExposure(d: Pick<PlatformDataset, 'collections' | 'withdrawals' | 'refunds'>, key: string): Exposure {
  const pendingCollections = d.collections.filter((c) => providerKey(c.provider) === key && (c.status === 'pending' || c.status === 'initiated')).length;
  const processingWithdrawals = d.withdrawals.filter((w) => providerKey(w.provider) === key && w.status === 'processing').length;
  const openRefunds = key === 'paystack' ? d.refunds.filter((r) => r.destination === 'original_method' && OPEN_REFUND.includes(r.status)).length : 0;
  return { provider: key, pendingCollections, processingWithdrawals, openRefunds };
}

export const openWalletRefunds = (d: Pick<PlatformDataset, 'refunds'>) => d.refunds.filter((r) => r.destination === 'wallet' && OPEN_REFUND.includes(r.status)).length;

/* ---------- Settlement destination ---------- */

export interface SettlementDestination {
  bankName: string;
  accountMasked: string;
  accountName: string;
}

/** Test data: invented account, shown masked. */
export const DEFAULT_SETTLEMENT: SettlementDestination = { bankName: 'Example Bank (test)', accountMasked: '••••4821', accountName: 'GOBYE TECHNOLOGIES LTD (TEST)' };

export const TEST_BANKS = ['Example Bank (test)', 'Sample Microfinance (test)', 'Demo Commercial Bank (test)'];

export function validateSettlement(input: { bankName: string; accountNumber: string; accountName: string }): Partial<Record<'bankName' | 'accountNumber' | 'accountName', string>> {
  const e: Partial<Record<'bankName' | 'accountNumber' | 'accountName', string>> = {};
  if (!input.bankName) e.bankName = 'Choose a bank';
  if (!/^\d{10}$/.test(input.accountNumber.trim())) e.accountNumber = 'Enter the 10 digit account number';
  if (input.accountName.trim().length < 3) e.accountName = 'Enter the account name as the bank shows it';
  return e;
}

/** Masked account (last 4 only). The full number never leaves the form. */
export const maskAccount = (n: string) => maskSecret(n.trim().padStart(16, '0'));

export function settlementRequestTitle(dest: SettlementDestination) {
  return `Change settlement destination to ${dest.bankName} ${dest.accountMasked}`;
}
export function settlementRequestNote(dest: SettlementDestination) {
  return `Account name: ${dest.accountName}. Existing settlements keep their destination.`;
}

export function parseSettlementRequest(a: Pick<ApprovalRequest, 'title' | 'note'>): SettlementDestination | null {
  const m = /^Change settlement destination to (.+) (••••\d{1,4})$/.exec(a.title);
  if (!m) return null;
  const n = /Account name: (.+?)\. /.exec(a.note ?? '');
  return { bankName: m[1]!, accountMasked: m[2]!, accountName: n?.[1] ?? 'Not recorded' };
}

/** Current destination = latest approved change, else the default. Pending change shown separately. */
export function settlementState(approvals: ApprovalRequest[]): { current: SettlementDestination; pending?: { request: ApprovalRequest; dest: SettlementDestination } } {
  const reqs = approvals.filter(isSettlementRequest);
  const approved = reqs.filter((a) => a.status === 'approved').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))[0];
  const pendingReq = reqs.filter((a) => a.status === 'pending').sort((a, b) => b.requestedAt - a.requestedAt)[0];
  const current = (approved && parseSettlementRequest(approved)) || DEFAULT_SETTLEMENT;
  const pendingDest = pendingReq ? parseSettlementRequest(pendingReq) : null;
  return { current, pending: pendingReq && pendingDest ? { request: pendingReq, dest: pendingDest } : undefined };
}
