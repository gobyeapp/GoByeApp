import { describe, expect, it } from 'vitest';
import { createMemoryRelay, type RelayApplication, type RelayPerson, type RelayRide } from '@gobye/core';
import { approvePatch, cancelRidePatch, connectionFromEnv, demoCounts, fullChecks, requestChangesPatch, rejectPatch, rideTimeline, setCheckPatch } from './logic';

const now = Date.UTC(2026, 9, 22, 12);
const app = (over: Partial<RelayApplication> = {}): RelayApplication => ({
  id: '+2348030000001',
  driver_name: 'Tunde Bakare',
  phone: '+2348030000001',
  city: 'Lagos',
  status: 'pending_review',
  application: { personal: null, licence: null, identity: null, vehicle: null, documents: { registration: true, insurance: true, roadworthiness: true } },
  checks: [{ id: 'identity', state: 'passed', updatedAt: now }],
  issues: [],
  review_note: null,
  submitted_at: now,
  decided_at: null,
  decided_by: null,
  updated_at: now,
  ...over,
});
const ride = (over: Partial<RelayRide> = {}): RelayRide =>
  ({
    id: 'bk-1',
    kind: 'quick_match',
    status: 'searching',
    rider_id: 'r',
    rider: { name: 'Ada Okafor', phone: '+2348031234567', rating: 5 },
    pickup: { id: 'p', title: 'Ikeja', subtitle: 'Lagos', coordinate: { latitude: 6.6, longitude: 3.35 } },
    destination: { id: 'd', title: 'Yaba', subtitle: 'Lagos', coordinate: { latitude: 6.5, longitude: 3.37 } },
    route: { distance_meters: 8000, duration_seconds: 1200, polyline: [] },
    category: 'go',
    fare: 300000,
    max_counter: 450000,
    offer: null,
    pickup_note: null,
    payment_method: 'wallet',
    driver_id: null,
    driver: null,
    agreed_fare: 300000,
    driver_location: null,
    pickup_pin: null,
    payment_status: 'not_due',
    cancelled_by: null,
    cancel_reason: null,
    created_at: now,
    matched_at: null,
    arrived_at: null,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...over,
  }) as RelayRide;

describe('connected demo logic', () => {
  it('connects only when a relay URL is set', () => {
    expect(connectionFromEnv({})).toBeNull();
    expect(connectionFromEnv({ VITE_DEMO_RELAY_URL: '  ' })).toBeNull();
    const c = connectionFromEnv({ VITE_DEMO_RELAY_URL: 'http://192.168.1.5:8787/' });
    expect(c?.relay.url).toBe('http://192.168.1.5:8787');
    expect(c?.status.get()).toMatchObject({ state: 'connecting', host: '192.168.1.5:8787' });
  });

  it('counts people, applications and rides', () => {
    const people = [{ role: 'rider' }, { role: 'rider' }, { role: 'driver' }] as RelayPerson[];
    const n = demoCounts(people, [app(), app({ id: 'b', status: 'changes_requested' }), app({ id: 'c', status: 'approved' })], [ride(), ride({ id: 'x', status: 'in_progress' }), ride({ id: 'y', status: 'completed' })]);
    expect(n).toEqual({ riders: 2, drivers: 1, inReview: 1, changes: 1, approved: 1, live: 2, completed: 1 });
  });

  it('fills in checks the driver app hasn’t sent, and a waiting check gets the outside reason', () => {
    expect(fullChecks(app(), now).map((c) => `${c.id}:${c.state}`)).toEqual(['identity:passed', 'licence:queued', 'vehicle:queued', 'documents:queued', 'background:queued']);
    const r = setCheckPatch(app(), 'licence', 'waiting', now + 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.checks!.find((c) => c.id === 'licence')!.note).toContain('FRSC');
    expect(setCheckPatch(app({ status: 'approved' }), 'licence', 'passed', now).ok).toBe(false);
  });

  it('request changes opens issues and fails their checks, like core', () => {
    const r = requestChangesPatch(app(), [{ code: 'insurance_expired', note: ' June ' }, { code: 'selfie_unclear' }], now + 5, 'Two fixes');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.status).toBe('changes_requested');
    expect(r.value.issues!.map((i) => [i.code, i.note])).toEqual([
      ['insurance_expired', 'June'],
      ['selfie_unclear', undefined],
    ]);
    const states = Object.fromEntries(r.value.checks!.map((c) => [c.id, c.state]));
    expect(states).toMatchObject({ documents: 'failed', identity: 'failed', licence: 'queued' });
    expect(r.value.review_note).toBe('Two fixes');
    expect(requestChangesPatch(app(), [], now).ok).toBe(false);
    expect(requestChangesPatch(app({ status: 'approved' }), [{ code: 'plate_mismatch' }], now).ok).toBe(false);
  });

  it('approve passes every check and records who decided; reject needs a reason', () => {
    const r = approvePatch(app(), 'Amaka Obi', now + 9);
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ status: 'approved', decided_by: 'Amaka Obi', decided_at: now + 9 });
    expect(r.value.checks!.every((c) => c.state === 'passed')).toBe(true);
    expect(approvePatch(app({ issues: [{ id: 'i', code: 'plate_mismatch', raisedAt: now }] }), 'A', now).ok).toBe(false);
    expect(rejectPatch(app(), '  ', 'A', now).ok).toBe(false);
    expect(rejectPatch(app(), 'Fake documents', 'A', now)).toMatchObject({ ok: true, value: { status: 'rejected', review_note: 'Fake documents' } });
  });

  it('cancels only active rides, with a reason, and builds the ride timeline', async () => {
    expect(cancelRidePatch(ride({ status: 'completed' }), 'x', now).ok).toBe(false);
    const p = cancelRidePatch(ride({ status: 'accepted' }), 'Rider called support', now + 1);
    expect(p).toMatchObject({ ok: true, value: { status: 'cancelled', cancelled_by: 'admin' } });
    const relay = createMemoryRelay();
    await relay.insert('demo_rides', ride({ status: 'accepted' }));
    if (p.ok) expect(await relay.update('demo_rides', { id: 'bk-1', status: 'accepted' }, p.value)).toHaveLength(1);
    const t = rideTimeline(ride({ status: 'completed', matched_at: now + 1, arrived_at: now + 2, started_at: now + 3, completed_at: now + 4, driver: { firstName: 'Tunde' } as RelayRide['driver'] }));
    expect(t.map((x) => x.title)).toEqual(['Rider requested a ride', 'Matched with Tunde', 'Driver arrived', 'Trip started', 'Trip completed']);
    expect(rideTimeline(ride({ status: 'cancelled', cancelled_by: 'admin', cancel_reason: 'Test', updated_at: now + 7 })).at(-1)).toMatchObject({ title: 'Cancelled by admin', sub: 'Test' });
  });
});
