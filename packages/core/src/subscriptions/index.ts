import { DRIVER_ACCESS_PACKAGES } from '../payments';
import type { Kobo } from '../types';

/**
 * Driver pass timeline: THE authoritative subscription calculation (D-058).
 *
 * One function decides when every pass starts and ends: the backend runs it when a verified payment, a
 * refund, a reversal or a cancellation is recorded, stores the result, and serves the same
 * `SubscriptionTimelineResponse` to the Driver App and the Admin Dashboard. Neither interface computes
 * validity on its own.
 *
 * Rules (owner, 2026-10-23):
 *  1. Daily pass = exactly 24 hours; monthly pass = exactly 30 consecutive days (₦2,000 / ₦60,000).
 *  2. A new pass starts at the LATER of its payment confirmation and the end of the last valid scheduled
 *     pass, so passes never overlap and no bought time is lost.
 *  3. Confirmation time, start and end are separate stored fields.
 *  4. Queued passes become active at their start time; status is derived from the clock, so no job is
 *     needed to "switch them on" and none can fail to.
 *  5. Deterministic: the timeline is a fold over payments sorted by (confirmation time, payment reference),
 *     so the order in which webhooks or simultaneous purchases arrive never changes the result. Recording
 *     the same payment or the same void twice changes nothing (idempotent by payment reference).
 *  6. Refunds, reversals and cancellations never delete a pass. A voided pass keeps its history; access it
 *     had not yet given is removed, and later passes move up to close the gap (never earlier than their
 *     own confirmation). A void after the pass has run changes nothing (no retroactive loss, no extension).
 *  7. A trip accepted while the driver had access may be completed after the pass ends; no new requests.
 */

export type PassPlan = 'daily' | 'monthly';
export type PassVoidKind = 'cancelled' | 'refunded' | 'reversed';
export type PassStatus = 'scheduled' | 'active' | 'expired' | PassVoidKind;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const PASS_DURATION_MS: Record<PassPlan, number> = {
  daily: DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'daily')!.durationDays * DAY,
  monthly: DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!.durationDays * DAY,
};
export const PASS_PRICE: Record<PassPlan, Kobo> = {
  daily: DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'daily')!.price,
  monthly: DRIVER_ACCESS_PACKAGES.find((p) => p.id === 'monthly')!.price,
};

export function planForAmount(amount: number): PassPlan | null {
  return amount === PASS_PRICE.daily ? 'daily' : amount === PASS_PRICE.monthly ? 'monthly' : null;
}

/** A payment the provider has VERIFIED (server lookup). Unverified payments never create a pass. */
export interface PassPayment {
  /** Provider reference: the idempotency key. Duplicate webhooks for it are ignored. */
  paymentRef: string;
  driverId: string;
  plan: PassPlan;
  amount: Kobo;
  confirmedAt: number;
}

export interface PassVoid {
  paymentRef: string;
  kind: PassVoidKind;
  /** When it was recorded. Access the pass had not given by then is removed. */
  at: number;
  reason: string;
  by: string;
}

export interface SubscriptionPass {
  id: string;
  driverId: string;
  plan: PassPlan;
  amount: Kobo;
  paymentRef: string;
  /** Payment confirmed by the provider. */
  confirmedAt: number;
  /** Scheduled validity: start and end, stored separately from confirmation. */
  startsAt: number;
  endsAt: number;
  /** When access from this pass really ends (= endsAt unless voided part way, or = startsAt if voided before it began). */
  accessEndsAt: number;
  void?: PassVoid;
}

export interface SubscriptionState {
  driverId: string;
  /** Bumped on every change; the backend writes with `expectedVersion` (optimistic concurrency). */
  version: number;
  payments: PassPayment[];
  voids: PassVoid[];
  /** Materialised timeline (what is stored and served). Always equal to `buildTimeline(payments, voids)`. */
  passes: SubscriptionPass[];
}

export const emptySubscriptionState = (driverId: string): SubscriptionState => ({ driverId, version: 0, payments: [], voids: [], passes: [] });

const order = (a: PassPayment, b: PassPayment) => a.confirmedAt - b.confirmedAt || (a.paymentRef < b.paymentRef ? -1 : a.paymentRef > b.paymentRef ? 1 : 0);

/** The single calculation. Pure and deterministic. */
export function buildTimeline(payments: readonly PassPayment[], voids: readonly PassVoid[]): SubscriptionPass[] {
  const voidFor = new Map<string, PassVoid>();
  for (const v of [...voids].sort((a, b) => a.at - b.at)) if (!voidFor.has(v.paymentRef)) voidFor.set(v.paymentRef, v);
  let cursor = Number.NEGATIVE_INFINITY; // end of the last access given so far
  const out: SubscriptionPass[] = [];
  for (const p of [...payments].sort(order)) {
    const startsAt = Math.max(p.confirmedAt, cursor);
    const endsAt = startsAt + PASS_DURATION_MS[p.plan];
    const v = voidFor.get(p.paymentRef);
    // A void removes only access not yet given at the time it was recorded.
    const accessEndsAt = v ? Math.min(endsAt, Math.max(startsAt, v.at)) : endsAt;
    out.push({ id: `pass:${p.paymentRef}`, driverId: p.driverId, plan: p.plan, amount: p.amount, paymentRef: p.paymentRef, confirmedAt: p.confirmedAt, startsAt, endsAt, accessEndsAt, ...(v ? { void: v } : {}) });
    cursor = Math.max(cursor, accessEndsAt);
  }
  return out;
}

export type SubscriptionError = 'version_conflict' | 'amount_mismatch' | 'wrong_driver' | 'unknown_payment';
export type SubscriptionWrite = { ok: true; state: SubscriptionState; duplicate: boolean; pass?: SubscriptionPass } | { ok: false; error: SubscriptionError; message: string };

function commit(s: SubscriptionState, payments: PassPayment[], voids: PassVoid[]): SubscriptionState {
  return { driverId: s.driverId, version: s.version + 1, payments, voids, passes: buildTimeline(payments, voids) };
}

/**
 * Record a VERIFIED pass payment. Idempotent by payment reference (duplicate webhooks, retried requests).
 * `expectedVersion` makes the write atomic against simultaneous purchases: on conflict the caller reloads
 * and applies again; because the timeline is order-independent the result is the same.
 */
export function recordPassPayment(s: SubscriptionState, p: PassPayment, opts: { expectedVersion?: number } = {}): SubscriptionWrite {
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== s.version) return { ok: false, error: 'version_conflict', message: 'The timeline changed; reload and apply again.' };
  if (p.driverId !== s.driverId) return { ok: false, error: 'wrong_driver', message: 'Payment belongs to another driver.' };
  const existing = s.payments.find((x) => x.paymentRef === p.paymentRef);
  if (existing) return { ok: true, state: s, duplicate: true, pass: s.passes.find((x) => x.paymentRef === p.paymentRef) };
  if (p.amount !== PASS_PRICE[p.plan]) return { ok: false, error: 'amount_mismatch', message: `A ${p.plan} pass costs ${PASS_PRICE[p.plan] / 100} naira; send this payment to finance for review.` };
  const next = commit(s, [...s.payments, p], s.voids);
  return { ok: true, state: next, duplicate: false, pass: next.passes.find((x) => x.paymentRef === p.paymentRef) };
}

/** Record a refund, reversal or cancellation. Never deletes the pass. Idempotent by payment reference. */
export function voidPass(s: SubscriptionState, v: PassVoid, opts: { expectedVersion?: number } = {}): SubscriptionWrite {
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== s.version) return { ok: false, error: 'version_conflict', message: 'The timeline changed; reload and apply again.' };
  if (!s.payments.some((p) => p.paymentRef === v.paymentRef)) return { ok: false, error: 'unknown_payment', message: 'No pass for this payment.' };
  if (s.voids.some((x) => x.paymentRef === v.paymentRef)) return { ok: true, state: s, duplicate: true, pass: s.passes.find((x) => x.paymentRef === v.paymentRef) };
  const next = commit(s, s.payments, [...s.voids, v]);
  return { ok: true, state: next, duplicate: false, pass: next.passes.find((x) => x.paymentRef === v.paymentRef) };
}

export function passStatus(p: SubscriptionPass, now: number): PassStatus {
  if (p.void) return p.void.kind;
  if (now < p.startsAt) return 'scheduled';
  if (now < p.endsAt) return 'active';
  return 'expired';
}

/** The pass giving access at `t`, if any (a voided pass counts only until its access ended). */
export function passAt(passes: readonly SubscriptionPass[], t: number): SubscriptionPass | undefined {
  return passes.find((p) => p.startsAt <= t && t < p.accessEndsAt);
}

/** End of continuous access from `t` across back-to-back passes; null when there is no access at `t`. */
export function accessUntil(passes: readonly SubscriptionPass[], t: number): number | null {
  if (!passAt(passes, t)) return null;
  let end = t;
  for (const p of [...passes].sort((a, b) => a.startsAt - b.startsAt)) {
    if (p.accessEndsAt <= p.startsAt) continue;
    if (p.startsAt <= end && p.accessEndsAt > end) end = p.accessEndsAt;
  }
  return end;
}

/** New ride requests need an active pass right now (BR-072). */
export const canAcceptRides = (passes: readonly SubscriptionPass[], now: number) => !!passAt(passes, now);

/** A trip accepted while the driver had access may be finished even if the pass has since ended. */
export const mayCompleteTrip = (passes: readonly SubscriptionPass[], tripAcceptedAt: number) => !!passAt(passes, tripAcceptedAt);

/**
 * One-time migration of a pre-D-058 single stored pass (Driver App local storage) into the timeline.
 * The old record kept only one period, so it becomes one payment whose confirmation time is its start;
 * the reference is `legacy:<driverId>:<start>` so it can never collide with a provider reference or
 * with another driver's migrated pass (references are unique across drivers on the server).
 */
export function subscriptionStateFromLegacy(driverId: string, legacy: { packageId: PassPlan; startsAt: number; expiresAt: number } | null | undefined): SubscriptionState {
  const s = emptySubscriptionState(driverId);
  if (!legacy || !(legacy.packageId in PASS_DURATION_MS)) return s;
  const r = recordPassPayment(s, { paymentRef: `legacy:${driverId}:${legacy.startsAt}`, driverId, plan: legacy.packageId, amount: PASS_PRICE[legacy.packageId], confirmedAt: legacy.startsAt });
  return r.ok ? r.state : s;
}

/* ---------- The one API response both interfaces render ---------- */

export interface SubscriptionPassView {
  id: string;
  plan: PassPlan;
  amount: Kobo;
  paymentRef: string;
  confirmedAt: number;
  startsAt: number;
  endsAt: number;
  accessEndsAt: number;
  status: PassStatus;
  voidReason?: string;
}

/** `GET /v1/drivers/{driverId}/subscription` (API_CONTRACTS.md). Same shape for the Driver App and the admin. */
export interface SubscriptionTimelineResponse {
  driverId: string;
  asOf: number;
  version: number;
  access: {
    active: boolean;
    canAcceptRides: boolean;
    currentPassId: string | null;
    currentPlan: PassPlan | null;
    /** End of continuous access across queued passes; null when not active. */
    activeUntil: number | null;
    /** When the current pass ends (the next queued pass may start then). */
    currentPassEndsAt: number | null;
  };
  /** Newest first. */
  passes: SubscriptionPassView[];
  summary: { active: number; scheduled: number; expired: number; voided: number; nextStartsAt: number | null; lastEndedAt: number | null };
}

export function subscriptionTimelineResponse(s: SubscriptionState, now: number): SubscriptionTimelineResponse {
  const current = passAt(s.passes, now) ?? null;
  const views: SubscriptionPassView[] = s.passes.map((p) => ({
    id: p.id,
    plan: p.plan,
    amount: p.amount,
    paymentRef: p.paymentRef,
    confirmedAt: p.confirmedAt,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    accessEndsAt: p.accessEndsAt,
    status: passStatus(p, now),
    ...(p.void ? { voidReason: p.void.reason } : {}),
  }));
  const count = (st: PassStatus[]) => views.filter((v) => st.includes(v.status)).length;
  const scheduled = views.filter((v) => v.status === 'scheduled').sort((a, b) => a.startsAt - b.startsAt);
  const ended = s.passes.filter((p) => p.accessEndsAt <= now && p.accessEndsAt > p.startsAt).map((p) => p.accessEndsAt);
  return {
    driverId: s.driverId,
    asOf: now,
    version: s.version,
    access: {
      active: !!current,
      canAcceptRides: !!current,
      currentPassId: current?.id ?? null,
      currentPlan: current?.plan ?? null,
      activeUntil: accessUntil(s.passes, now),
      currentPassEndsAt: current?.accessEndsAt ?? null,
    },
    passes: views.sort((a, b) => b.startsAt - a.startsAt || b.confirmedAt - a.confirmedAt),
    summary: {
      active: count(['active']),
      scheduled: scheduled.length,
      expired: count(['expired']),
      voided: count(['cancelled', 'refunded', 'reversed']),
      nextStartsAt: scheduled[0]?.startsAt ?? null,
      lastEndedAt: ended.length ? Math.max(...ended) : null,
    },
  };
}

/* ---------- Service contract (the backend implements this; the prototype uses the in-memory one) ---------- */

export interface SubscriptionService {
  timeline(driverId: string, now: number): SubscriptionTimelineResponse;
  /** Called by the payment verification job only, never by a client. */
  recordVerifiedPayment(p: PassPayment): SubscriptionWrite;
  voidPass(driverId: string, v: PassVoid): SubscriptionWrite;
  state(driverId: string): SubscriptionState;
}

/**
 * In-memory implementation used by the prototype and tests. Writes are applied with optimistic
 * concurrency and retried on a version conflict, the way the backend's transaction would be.
 */
export function createSubscriptionService(initial: SubscriptionState[] = []): SubscriptionService {
  const states = new Map(initial.map((s) => [s.driverId, s]));
  const get = (id: string) => states.get(id) ?? emptySubscriptionState(id);
  const write = (id: string, f: (s: SubscriptionState, v: number) => SubscriptionWrite): SubscriptionWrite => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = get(id);
      const r = f(s, s.version);
      if (r.ok) {
        states.set(id, r.state);
        return r;
      }
      if (r.error !== 'version_conflict') return r;
    }
    return { ok: false, error: 'version_conflict', message: 'Too many simultaneous changes; try again.' };
  };
  return {
    timeline: (id, now) => subscriptionTimelineResponse(get(id), now),
    recordVerifiedPayment: (p) => write(p.driverId, (s, v) => recordPassPayment(s, p, { expectedVersion: v })),
    voidPass: (id, v) => write(id, (s, ver) => voidPass(s, v, { expectedVersion: ver })),
    state: (id) => get(id),
  };
}
