import type { AuditEvent, CityId, DriverRecord, TripRecord, TripStatus } from '@gobye/core';

/** Row filter: `at` undefined means "current state" (city scope only, no date range). */
export type Keep = (city: CityId, at: number | undefined) => boolean;

export const DELAY_THRESHOLD_S = 300;
export const SEARCH_TOO_LONG_MS = 5 * 60_000;
export const PAYMENT_STUCK_MS = 3 * 60_000;

export type ProblemKind = 'delayed_pickup' | 'searching_long' | 'payment_stuck' | 'no_driver' | 'cancelled';
export interface Problem {
  key: string;
  kind: ProblemKind;
  tripId: string;
  /** Trip reference shown to people, e.g. "#0151B3". */
  ref: string;
  city: CityId;
  at: number;
  title: string;
  detail: string;
  severity: 'danger' | 'warning' | 'neutral';
}

export const PROBLEM_LABELS: Record<ProblemKind, string> = {
  delayed_pickup: 'Delayed pickup',
  searching_long: 'Searching too long',
  payment_stuck: 'Payment stuck',
  no_driver: 'No driver found',
  cancelled: 'Cancelled',
};

const ORDER: ProblemKind[] = ['delayed_pickup', 'searching_long', 'payment_stuck', 'no_driver', 'cancelled'];
export const problemKey = (kind: ProblemKind, tripId: string) => `${kind}:${tripId}`;
const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** Problems needing action, live ones first, newest first within a kind. Dismissed keys are left out. */
export function detectProblems(trips: readonly TripRecord[], now: number, keep: Keep, dismissed: ReadonlySet<string> = new Set()): Problem[] {
  const out: Problem[] = [];
  for (const t of trips) {
    const route = `${t.pickup} to ${t.destination}`;
    const push = (kind: ProblemKind, at: number, detail: string, severity: Problem['severity']) => {
      const key = problemKey(kind, t.id);
      if (!dismissed.has(key)) out.push({ key, kind, tripId: t.id, ref: t.ref, city: t.city, at, title: `${PROBLEM_LABELS[kind]} · ${t.ref}`, detail, severity });
    };
    if (t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > DELAY_THRESHOLD_S && keep(t.city, undefined)) push('delayed_pickup', t.requestedAt, `${mins((t.pickupDelaySeconds ?? 0) * 1000)} min behind the pickup estimate · ${route}`, 'danger');
    else if (t.status === 'searching' && now - t.requestedAt > SEARCH_TOO_LONG_MS && keep(t.city, undefined)) push('searching_long', t.requestedAt, `Searching for ${mins(now - t.requestedAt)} min · ${route}`, 'warning');
    else if (t.status === 'payment_pending' && t.payment === 'processing' && now - (t.completedAt ?? t.requestedAt) > PAYMENT_STUCK_MS && keep(t.city, undefined)) push('payment_stuck', t.completedAt ?? t.requestedAt, `Confirming for ${mins(now - (t.completedAt ?? t.requestedAt))} min · ${route}`, 'warning');
    else if (t.status === 'no_driver' && keep(t.city, t.requestedAt)) push('no_driver', t.requestedAt, route, 'neutral');
    else if (t.status === 'cancelled' && keep(t.city, t.requestedAt)) push('cancelled', t.requestedAt, `${t.cancellation ? `By ${t.cancellation.by}: ${t.cancellation.reason}` : 'No reason recorded'} · ${route}`, 'neutral');
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.at - a.at);
}

/** Problem keys dismissed with "Mark resolved", read back from the audit trail so they persist. */
export function dismissedFromAudit(audit: readonly AuditEvent[]): Set<string> {
  return new Set(audit.filter((e) => e.action === 'live.problem_resolved').map((e) => e.diff?.find((x) => x.field === 'Problem')?.to ?? '').filter(Boolean));
}

export const ACTIVE_STATUSES: readonly TripStatus[] = ['searching', 'matched', 'en_route', 'arrived', 'in_progress', 'payment_pending'];
/** Statuses where operations may cancel on the passenger's behalf (before the trip starts). */
export const CANCELLABLE: readonly TripStatus[] = ['searching', 'matched', 'en_route', 'arrived'];

export interface Availability {
  city: CityId;
  approved: number;
  withAccess: number;
  available: number;
  busy: number;
}

/** Drivers per city: approved, approved with active access, and available (online with active access). */
export function driverAvailability(drivers: readonly DriverRecord[], trips: readonly TripRecord[], now: number, cities: readonly CityId[]): Availability[] {
  const busyIds = new Set(trips.filter((t) => t.driverId && ['matched', 'en_route', 'arrived', 'in_progress'].includes(t.status)).map((t) => t.driverId!));
  return cities.map((city) => {
    const approved = drivers.filter((d) => d.city === city && d.verification === 'approved');
    const withAccess = approved.filter((d) => d.access && d.access.expiresAt > now);
    const online = withAccess.filter((d) => d.online);
    return { city, approved: approved.length, withAccess: withAccess.length, available: online.filter((d) => !busyIds.has(d.id)).length, busy: online.filter((d) => busyIds.has(d.id)).length };
  });
}

export function elapsedLabel(from: number, now: number): string {
  const m = Math.max(0, Math.floor((now - from) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

type Result = { ok: true } | { ok: false; error: string };

/** Cancel on the passenger's behalf: system cancellation, no fee, timeline entry. */
export function cancelForPassenger(trip: TripRecord | undefined, reason: string, now: number): Result {
  if (!trip) return { ok: false, error: 'Trip not found' };
  if (!reason.trim()) return { ok: false, error: 'Add a reason' };
  if (!CANCELLABLE.includes(trip.status)) return { ok: false, error: 'This trip has started or ended, so it can’t be cancelled here' };
  trip.status = 'cancelled';
  trip.cancellation = { by: 'system', reason: reason.trim(), fee: 0 as TripRecord['suggestedFare'] };
  trip.timeline.push({ at: now, label: `Cancelled by operations for the passenger: ${reason.trim()}` });
  return { ok: true };
}

/* ---------- Trips list ---------- */
export interface TripFilter {
  q: string;
  status: TripStatus | 'all';
  payment: TripRecord['payment'] | 'all';
  mode: TripRecord['mode'] | 'all';
  method: TripRecord['paymentMethod'] | 'all';
}

export function filterTrips(trips: readonly TripRecord[], f: TripFilter, names: (t: TripRecord) => string[]): TripRecord[] {
  const q = f.q.trim().toLowerCase();
  return trips
    .filter((t) => (f.status === 'all' || t.status === f.status) && (f.payment === 'all' || t.payment === f.payment) && (f.mode === 'all' || t.mode === f.mode) && (f.method === 'all' || t.paymentMethod === f.method))
    .filter((t) => !q || [t.ref, t.id, t.pickup, t.destination, ...names(t)].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

export function countByStatus(trips: readonly TripRecord[]): Partial<Record<TripStatus, number>> {
  const out: Partial<Record<TripStatus, number>> = {};
  for (const t of trips) out[t.status] = (out[t.status] ?? 0) + 1;
  return out;
}
