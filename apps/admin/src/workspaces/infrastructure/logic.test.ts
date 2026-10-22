import { describe, expect, it } from 'vitest';
import { canManageInfra, canViewInfra, createInfraStore, expectedShare, toTrafficActor } from './logic';

const t0 = Date.UTC(2026, 9, 23, 9);
const owner = { id: 'st-owner', name: 'Akorede', roles: ['owner'] as const };
const dev = { id: 'st-dev', name: 'Sani', roles: ['developer'] as const };
const care = { id: 'st-care', name: 'Funke', roles: ['care'] as const };

describe('traffic and origins (simulation)', () => {
  it('only owner / admin / developer may change routing; auditors may look', () => {
    expect(canManageInfra({ roles: ['developer'] })).toBe(true);
    expect(canManageInfra({ roles: ['auditor'] })).toBe(false);
    expect(canViewInfra({ roles: ['auditor'] })).toBe(true);
    expect(canViewInfra({ roles: ['care'] })).toBe(false);
    expect(toTrafficActor({ ...care, roles: [...care.roles] }, t0).permissions).toEqual([]);
  });

  it('starts with no origins: everything is blocked as backend not configured', () => {
    const store = createInfraStore(() => t0);
    expect(store.plane('production').current().origins).toEqual([]);
    expect(expectedShare(store.plane('production').current(), 'rides_create')).toEqual({ blocked: 'The GoBye service is not available yet.' });
  });

  it('staging: a change applies at once (simulated) and can be rolled back', () => {
    let now = t0;
    const store = createInfraStore(() => now);
    store.loadExamples('staging');
    const actor = toTrafficActor({ ...dev, roles: [...dev.roles] }, now - 1000);
    const r = store.propose('staging', actor, { type: 'set_weights', weights: { 'example-a': 80, 'example-b': 20 } }, 'Canary 20% to origin B for testing');
    expect(r.ok && r.value.applied).toBe(true);
    const share = expectedShare(store.plane('staging').current(), 'fares');
    // Under primary_only the weights don't matter yet: all new traffic goes to the primary.
    expect(share).toEqual([{ id: 'example-a', share: 100 }, { id: 'example-b', share: 0 }]);
    now += 1000;
    store.propose('staging', actor, { type: 'set_policy', kind: 'weighted' }, 'Switch to weighted routing');
    const w = expectedShare(store.plane('staging').current(), 'fares') as { id: string; share: number }[];
    expect(w.find((x) => x.id === 'example-a')!.share).toBeGreaterThan(70);
    const rb = store.rollback('staging', actor, 'Undo weighted routing after the test');
    expect(rb.ok).toBe(true);
    expect(store.plane('staging').current().policy.kind).toBe('primary_only');
    expect(store.plane('staging').history().audit.every((a) => a.simulated)).toBe(true);
  });

  it('production: needs a second person; the proposer can’t approve; MFA must be recent', () => {
    const store = createInfraStore(() => t0);
    store.loadExamples('production');
    const a = toTrafficActor({ ...owner, roles: [...owner.roles] }, t0 - 1000);
    const r = store.propose('production', a, { type: 'set_policy', kind: 'maintenance' }, 'Database maintenance window tonight');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.applied).toBe(false);
    expect(store.approveAndApply('production', r.value.request.id, a)).toEqual({ ok: false, error: 'Someone else must approve a production change.' });
    expect(store.approveAndApply('production', r.value.request.id, toTrafficActor({ ...dev, roles: [...dev.roles] }, null)).ok).toBe(false);
    const ok = store.approveAndApply('production', r.value.request.id, toTrafficActor({ ...dev, roles: [...dev.roles] }, t0 - 500));
    expect(ok.ok).toBe(true);
    expect(store.plane('production').current().policy.kind).toBe('maintenance');
    expect(store.requests('production')[0].status).toBe('applied');
  });
});
