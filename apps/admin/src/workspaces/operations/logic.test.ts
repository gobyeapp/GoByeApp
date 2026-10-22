import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type TripRecord } from '@gobye/core';
import { cancelForPassenger, countByStatus, detectProblems, dismissedFromAudit, driverAvailability, filterTrips, problemKey, type Keep } from './logic';

const d = createPlatformDataset();
const now = d.generatedAt;
const all: Keep = () => true;
const base = (x: Partial<TripRecord>): TripRecord => ({ ...d.trips[0]!, timeline: [], cancellation: undefined, pickupDelaySeconds: undefined, ...x });

describe('detectProblems', () => {
  it('flags delayed pickups over 5 minutes only', () => {
    const trips = [base({ id: 'a', status: 'en_route', pickupDelaySeconds: 301 }), base({ id: 'b', status: 'en_route', pickupDelaySeconds: 299 })];
    expect(detectProblems(trips, now, all).map((p) => p.tripId)).toEqual(['a']);
  });
  it('flags long searches, stuck payments, failures and cancellations in priority order', () => {
    const trips = [
      base({ id: 'c', status: 'cancelled', requestedAt: now - 1000 }),
      base({ id: 'n', status: 'no_driver', requestedAt: now - 1000 }),
      base({ id: 'p', status: 'payment_pending', payment: 'processing', completedAt: now - 4 * 60_000 }),
      base({ id: 'p2', status: 'payment_pending', payment: 'pending', completedAt: now - 9 * 60_000 }),
      base({ id: 's', status: 'searching', requestedAt: now - 6 * 60_000 }),
      base({ id: 's2', status: 'searching', requestedAt: now - 60_000 }),
      base({ id: 'e', status: 'en_route', pickupDelaySeconds: 600 }),
    ];
    expect(detectProblems(trips, now, all).map((p) => p.tripId)).toEqual(['e', 's', 'p', 'n', 'c']);
  });
  it('respects the date range for failures and dismissed keys', () => {
    const trips = [base({ id: 'n', status: 'no_driver', requestedAt: now - 10 * 86_400_000 })];
    const recentOnly: Keep = (_c, at) => at === undefined || now - at < 86_400_000;
    expect(detectProblems(trips, now, recentOnly)).toHaveLength(0);
    expect(detectProblems(trips, now, all, new Set([problemKey('no_driver', 'n')]))).toHaveLength(0);
  });
  it('reads dismissals from the audit trail', () => {
    const s = dismissedFromAudit([{ id: 'x', at: 0, actor: { kind: 'system', name: 't' }, action: 'live.problem_resolved', target: { type: 'trip', id: 'n', label: 'n' }, summary: '', diff: [{ field: 'Problem', from: 'Open', to: 'no_driver:n' }] }]);
    expect(s.has('no_driver:n')).toBe(true);
  });
});

describe('driverAvailability', () => {
  it('available drivers are approved, online and with active access', () => {
    const rows = driverAvailability(d.drivers, d.trips, now, ['lagos', 'abuja']);
    for (const r of rows) {
      expect(r.withAccess).toBeLessThanOrEqual(r.approved);
      expect(r.available + r.busy).toBe(d.drivers.filter((x) => x.city === r.city && x.verification === 'approved' && x.online && x.access && x.access.expiresAt > now).length);
    }
  });
});

describe('cancelForPassenger', () => {
  it('cancels before the trip starts with a system cancellation and timeline entry', () => {
    const t = base({ status: 'en_route' });
    expect(cancelForPassenger(t, 'Driver unreachable', now)).toEqual({ ok: true });
    expect(t.status).toBe('cancelled');
    expect(t.cancellation).toEqual({ by: 'system', reason: 'Driver unreachable', fee: 0 });
    expect(t.timeline.at(-1)!.at).toBe(now);
  });
  it('refuses once the trip is under way or without a reason', () => {
    expect(cancelForPassenger(base({ status: 'in_progress' }), 'x', now).ok).toBe(false);
    expect(cancelForPassenger(base({ status: 'matched' }), ' ', now).ok).toBe(false);
  });
});

describe('trip list', () => {
  it('filters and counts', () => {
    const r = filterTrips(d.trips, { q: '', status: 'completed', payment: 'all', mode: 'negotiate', method: 'all' }, () => []);
    expect(r.every((t) => t.status === 'completed' && t.mode === 'negotiate')).toBe(true);
    expect(filterTrips(d.trips, { q: d.trips[3]!.ref, status: 'all', payment: 'all', mode: 'all', method: 'all' }, () => []).map((t) => t.id)).toContain(d.trips[3]!.id);
    const c = countByStatus(d.trips);
    expect(Object.values(c).reduce((s, n) => s + (n ?? 0), 0)).toBe(d.trips.length);
  });
});
