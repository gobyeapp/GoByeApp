import { DRIVER_ACCESS_PACKAGES, subscribe, type CollectionRecord, type DriverAccessPackage, type DriverRecord, type Kobo } from '@gobye/core';

/**
 * Driver subscriptions (owner brief §18), derived from records that already exist:
 *  - package_purchase collections: the payment for a pass (amount tells the plan),
 *  - each driver's current `access`: what the platform enforces today.
 * Nothing here is invented: a payment whose amount matches no plan is flagged for review, and activation
 * happens only on a verified (successful) payment. Renewal is manual (Q-043), so there is no renewal job.
 */

export type Plan = DriverAccessPackage['id'];
export type SubscriptionStatus = 'active' | 'scheduled' | 'expired' | 'pending_payment' | 'failed' | 'needs_review';

export interface SubscriptionRecord {
  id: string;
  driverId: string;
  /** Null when the amount matches no confirmed plan. */
  plan: Plan | null;
  amount: Kobo;
  reference: string;
  provider: string;
  paymentStatus: CollectionRecord['status'];
  paidAt?: number;
  /** When access from this payment starts: on verification, or at the end of access already running. */
  startsAt?: number;
  expiresAt?: number;
  status: SubscriptionStatus;
}

export const PLAN_LABEL: Record<Plan, string> = { daily: 'Daily', monthly: 'Monthly' };
const HOUR = 3_600_000;

export function planForAmount(amount: number): Plan | null {
  return DRIVER_ACCESS_PACKAGES.find((p) => p.price === amount)?.id ?? null;
}

/**
 * One record per package payment, each running from its own verified activation.
 */
export function subscriptionRecords(collections: readonly CollectionRecord[], now: number): SubscriptionRecord[] {
  const pays = collections.filter((c) => c.purpose === 'package_purchase' && c.payerType === 'driver');
  const out: SubscriptionRecord[] = [];
  for (const c of [...pays].sort((a, b) => (a.verifiedAt ?? a.createdAt) - (b.verifiedAt ?? b.createdAt))) {
    const plan = planForAmount(c.amount);
    const base = { id: c.id, driverId: c.payerId, plan, amount: c.amount, reference: c.reference, provider: c.provider, paymentStatus: c.status, paidAt: c.verifiedAt };
    if (c.status === 'initiated' || c.status === 'pending') {
      out.push({ ...base, status: 'pending_payment' });
      continue;
    }
    if (c.status !== 'successful' || !c.verifiedAt) {
      out.push({ ...base, status: 'failed' });
      continue;
    }
    if (!plan) {
      out.push({ ...base, status: 'needs_review' });
      continue;
    }
    const pkg = DRIVER_ACCESS_PACKAGES.find((p) => p.id === plan)!;
    // Each pass runs from its own successful activation (owner brief: 24 hours / 30 days from activation).
    // Whether a pass bought during another extends it is open (Q-043); the driver's current access record
    // is what the platform enforces, so this view never stacks passes on its own.
    const sub = subscribe(pkg, c.verifiedAt, null);
    out.push({ ...base, startsAt: sub.startsAt, expiresAt: sub.expiresAt, status: sub.startsAt > now ? 'scheduled' : sub.expiresAt > now ? 'active' : 'expired' });
  }
  return out.sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
}

/** Can this driver accept new ride requests right now? Needs approval AND active access (BR-072). */
export function eligibility(driver: Pick<DriverRecord, 'verification' | 'access'>, now: number): { eligible: boolean; reason: string } {
  const access = !!driver.access && driver.access.expiresAt > now;
  if (driver.verification !== 'approved') return { eligible: false, reason: driver.verification === 'suspended' ? 'Suspended' : 'Not approved yet' };
  if (!access) return { eligible: false, reason: driver.access ? 'Access expired' : 'No access bought' };
  return { eligible: true, reason: 'Can accept rides' };
}

/** Current access as the platform enforces it, from each driver's record. */
export function currentAccess(drivers: readonly DriverRecord[], now: number) {
  const active = drivers.filter((d) => d.access && d.access.expiresAt > now);
  const within = (ms: number) => active.filter((d) => d.access!.expiresAt - now <= ms).length;
  return {
    active: active.length,
    daily: active.filter((d) => d.access!.packageId === 'daily').length,
    monthly: active.filter((d) => d.access!.packageId === 'monthly').length,
    expiring24h: within(24 * HOUR),
    expiring3d: within(72 * HOUR),
    expired: drivers.filter((d) => d.access && d.access.expiresAt <= now).length,
    never: drivers.filter((d) => !d.access && d.verification === 'approved').length,
  };
}

/** Subscription revenue: verified package payments only (GoBye revenue; 0% trip commission). */
export function subscriptionRevenue(records: readonly SubscriptionRecord[], inRange: (at: number) => boolean): { total: Kobo; daily: Kobo; monthly: Kobo; count: number } {
  const ok = records.filter((r) => r.paymentStatus === 'successful' && r.paidAt !== undefined && r.plan && inRange(r.paidAt));
  const sum = (xs: SubscriptionRecord[]) => xs.reduce((s, r) => s + r.amount, 0) as Kobo;
  return { total: sum(ok), daily: sum(ok.filter((r) => r.plan === 'daily')), monthly: sum(ok.filter((r) => r.plan === 'monthly')), count: ok.length };
}
