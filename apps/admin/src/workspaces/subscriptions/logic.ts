import {
  DRIVER_ACCESS_PACKAGES,
  emptySubscriptionState,
  passStatus,
  planForAmount as corePlanForAmount,
  subscriptionTimelineResponse,
  voidPass,
  type CollectionRecord,
  type DriverAccessPackage,
  type DriverRecord,
  type Kobo,
  type PassVoid,
  type PlatformDataset,
  type SubscriptionState,
  type SubscriptionTimelineResponse,
} from '@gobye/core';

/**
 * Driver subscriptions in the admin (owner brief §18) READ the authoritative pass timeline (D-058,
 * `packages/core/src/subscriptions`): the same `SubscriptionTimelineResponse` the Driver App shows. This
 * file never calculates validity itself; it only joins the timeline with the payment records so that
 * pending, failed and unrecognised payments can be listed too.
 */

export type Plan = DriverAccessPackage['id'];
export type SubscriptionStatus = 'active' | 'scheduled' | 'expired' | 'cancelled' | 'refunded' | 'reversed' | 'pending_payment' | 'failed' | 'needs_review';

export interface SubscriptionRecord {
  id: string;
  driverId: string;
  /** Null when the amount matches no confirmed plan. */
  plan: Plan | null;
  amount: Kobo;
  reference: string;
  provider: string;
  paymentStatus: CollectionRecord['status'];
  /** Payment confirmed by the provider. */
  paidAt?: number;
  /** Scheduled validity from the timeline (queued after any earlier pass). */
  startsAt?: number;
  expiresAt?: number;
  /** When access from this pass really ends (earlier than expiresAt if it was refunded, reversed or cancelled). */
  accessEndsAt?: number;
  voidReason?: string;
  status: SubscriptionStatus;
}

export const PLAN_LABEL: Record<Plan, string> = { daily: 'Daily', monthly: 'Monthly' };
const HOUR = 3_600_000;

export const planForAmount = (amount: number): Plan | null => corePlanForAmount(amount);

export const stateFor = (subs: readonly SubscriptionState[], driverId: string) => subs.find((s) => s.driverId === driverId) ?? emptySubscriptionState(driverId);
export const timelineFor = (subs: readonly SubscriptionState[], driverId: string, now: number): SubscriptionTimelineResponse => subscriptionTimelineResponse(stateFor(subs, driverId), now);

/** One record per package payment, with validity taken from the authoritative timeline. */
export function subscriptionRecords(collections: readonly CollectionRecord[], subs: readonly SubscriptionState[], now: number): SubscriptionRecord[] {
  const pays = collections.filter((c) => c.purpose === 'package_purchase' && c.payerType === 'driver');
  return pays
    .map((c): SubscriptionRecord => {
      const plan = planForAmount(c.amount);
      const base = { id: c.id, driverId: c.payerId, plan, amount: c.amount, reference: c.reference, provider: c.provider, paymentStatus: c.status, paidAt: c.verifiedAt };
      if (c.status === 'initiated' || c.status === 'pending') return { ...base, status: 'pending_payment' };
      if (c.status !== 'successful' || !c.verifiedAt) return { ...base, status: 'failed' };
      const pass = stateFor(subs, c.payerId).passes.find((p) => p.paymentRef === c.reference);
      if (!plan || !pass) return { ...base, status: 'needs_review' };
      return { ...base, startsAt: pass.startsAt, expiresAt: pass.endsAt, accessEndsAt: pass.accessEndsAt, voidReason: pass.void?.reason, status: passStatus(pass, now) };
    })
    .sort((a, b) => (b.startsAt ?? b.paidAt ?? 0) - (a.startsAt ?? a.paidAt ?? 0));
}

/** Can this driver accept new ride requests right now? Approval AND an active pass on the timeline (BR-072). */
export function eligibility(driver: Pick<DriverRecord, 'verification'>, tl: Pick<SubscriptionTimelineResponse, 'access' | 'summary'>): { eligible: boolean; reason: string } {
  if (driver.verification !== 'approved') return { eligible: false, reason: driver.verification === 'suspended' ? 'Suspended' : 'Not approved yet' };
  if (!tl.access.canAcceptRides) return { eligible: false, reason: tl.summary.lastEndedAt || tl.summary.voided ? 'No active pass' : 'No pass bought' };
  return { eligible: true, reason: 'Can accept rides' };
}

/** Current access across drivers, from their timelines. */
export function currentAccess(drivers: readonly DriverRecord[], subs: readonly SubscriptionState[], now: number) {
  const tls = drivers.map((d) => timelineFor(subs, d.id, now));
  const active = tls.filter((t) => t.access.active);
  const within = (ms: number) => active.filter((t) => t.access.activeUntil! - now <= ms).length;
  return {
    active: active.length,
    daily: active.filter((t) => t.access.currentPlan === 'daily').length,
    monthly: active.filter((t) => t.access.currentPlan === 'monthly').length,
    /** Drivers with at least one pass queued to start later. */
    queued: tls.filter((t) => t.summary.scheduled > 0).length,
    /** Continuous access (including queued passes) ending within the window. */
    expiring24h: within(24 * HOUR),
    expiring3d: within(72 * HOUR),
    expired: tls.filter((t) => !t.access.active && t.summary.lastEndedAt).length,
    never: drivers.filter((d, i) => !tls[i]!.passes.length && d.verification === 'approved').length,
  };
}

/** Subscription revenue: verified package payments only (GoBye revenue; 0% trip commission). Refunded passes are not revenue. */
export function subscriptionRevenue(records: readonly SubscriptionRecord[], inRange: (at: number) => boolean): { total: Kobo; daily: Kobo; monthly: Kobo; count: number } {
  const ok = records.filter((r) => r.paymentStatus === 'successful' && r.paidAt !== undefined && r.plan && r.status !== 'refunded' && r.status !== 'reversed' && inRange(r.paidAt));
  const sum = (xs: SubscriptionRecord[]) => xs.reduce((s, r) => s + r.amount, 0) as Kobo;
  return { total: sum(ok), daily: sum(ok.filter((r) => r.plan === 'daily')), monthly: sum(ok.filter((r) => r.plan === 'monthly')), count: ok.length };
}

/**
 * Cancel, refund or record a reversal for one pass, through the authoritative timeline. The pass stays in
 * history; access it had not given is removed; later passes move up. The driver record's access is
 * re-derived from the new timeline. (Paying the money back is a separate finance step.)
 */
export function applyPassVoid(draft: PlatformDataset, driverId: string, v: PassVoid, now: number): { ok: true; duplicate: boolean } | { ok: false; error: string } {
  const st = stateFor(draft.subscriptions, driverId);
  const r = voidPass(st, v, { expectedVersion: st.version });
  if (!r.ok) return { ok: false, error: r.message };
  const i = draft.subscriptions.findIndex((s) => s.driverId === driverId);
  if (i >= 0) draft.subscriptions[i] = r.state;
  else draft.subscriptions.push(r.state);
  const driver = draft.drivers.find((d) => d.id === driverId);
  if (driver) {
    const tl = subscriptionTimelineResponse(r.state, now);
    const last = tl.passes.find((p) => p.accessEndsAt > p.startsAt);
    driver.access = tl.access.active ? { packageId: tl.access.currentPlan!, expiresAt: tl.access.activeUntil! } : last ? { packageId: last.plan, expiresAt: last.accessEndsAt } : null;
    if (!tl.access.active) driver.online = false;
  }
  return { ok: true, duplicate: r.duplicate };
}

export const PASS_DAYS: Record<Plan, string> = {
  daily: `${DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'daily')!.durationDays * 24} hours`,
  monthly: `${DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!.durationDays} consecutive days`,
};
