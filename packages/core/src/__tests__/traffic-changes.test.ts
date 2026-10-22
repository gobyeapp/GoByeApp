import { SimulatedControlPlane, TRAFFIC_PERMISSION, approveTrafficChange, proposeTrafficChange, type BackendOrigin, type TrafficActor, type TrafficState } from '../traffic';

const now = Date.UTC(2026, 9, 23, 9);
const o = (id: string, priority: number): BackendOrigin => ({ id, endpoint: `https://${id}.test`, region: 'eu', provider: 'pending', health: 'healthy', weight: 50, priority, maintenance: false, version: '1', lastHealthyAt: now, lastFailoverAt: null });
const state = (env: TrafficState['environment'] = 'production'): TrafficState => ({ version: 1, environment: env, policy: { kind: 'primary_only', version: 1, updatedAt: now, updatedBy: 'seed' }, origins: [o('a', 1), o('b', 2)] });
const ada: TrafficActor = { id: 'ada', name: 'Ada', permissions: [TRAFFIC_PERMISSION], mfaVerifiedAt: now - 60_000 };
const sani: TrafficActor = { id: 'sani', name: 'Sani', permissions: [TRAFFIC_PERMISSION], mfaVerifiedAt: now - 30_000 };
const reason = 'Primary origin is failing readiness checks';

describe('privileged traffic changes', () => {
  it('needs the permission, a recent MFA check and a reason', () => {
    expect(proposeTrafficChange({ actor: { ...ada, permissions: [] }, reason, change: { type: 'set_policy', kind: 'secondary_only' }, state: state(), now })).toMatchObject({ ok: false });
    expect(proposeTrafficChange({ actor: { ...ada, mfaVerifiedAt: now - 11 * 60_000 }, reason, change: { type: 'set_policy', kind: 'secondary_only' }, state: state(), now })).toEqual({ ok: false, error: 'Confirm it’s you (two-step verification) before changing traffic.' });
    expect(proposeTrafficChange({ actor: ada, reason: 'because', change: { type: 'set_policy', kind: 'secondary_only' }, state: state(), now }).ok).toBe(false);
  });

  it('refuses unsafe changes: safety / active trips / support can never be switched off, weights must be valid', () => {
    expect(proposeTrafficChange({ actor: ada, reason, change: { type: 'set_policy', kind: 'emergency', disabled: ['safety'] }, state: state(), now })).toEqual({ ok: false, error: 'Trips in progress, safety and support can’t be switched off.' });
    expect(proposeTrafficChange({ actor: ada, reason, change: { type: 'set_weights', weights: { a: 0, b: 0 } }, state: state(), now }).ok).toBe(false);
    expect(proposeTrafficChange({ actor: ada, reason, change: { type: 'set_weights', weights: { a: 120 } }, state: state(), now }).ok).toBe(false);
  });

  it('production: a second person must approve; the proposer cannot approve their own change', () => {
    const p = proposeTrafficChange({ actor: ada, reason, change: { type: 'set_weights', weights: { a: 80, b: 20 } }, state: state(), now });
    if (!p.ok) throw new Error(p.error);
    expect(p.value.status).toBe('pending_approval');
    expect(approveTrafficChange(p.value, ada, now)).toEqual({ ok: false, error: 'Someone else must approve a production change.' });
    const cp = new SimulatedControlPlane(state());
    expect(cp.apply(p.value, ada, now).ok).toBe(false);
    const ok = approveTrafficChange(p.value, sani, now + 1);
    if (!ok.ok) throw new Error(ok.error);
    const applied = cp.apply(ok.value, sani, now + 2);
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.value.simulated).toBe(true);
    expect(cp.live).toBe(false);
    expect(applied.value.state.origins.map((x) => x.weight)).toEqual([80, 20]);
    expect(applied.value.audit).toMatchObject({ action: 'traffic.change.applied', reason, simulated: true });
  });

  it('staging changes apply on the proposer’s authority', () => {
    const p = proposeTrafficChange({ actor: ada, reason, change: { type: 'set_policy', kind: 'maintenance' }, state: state('staging'), now });
    expect(p.ok && p.value.status).toBe('approved');
  });

  it('a stale proposal is refused, and rollback restores the previous routing (audited)', () => {
    const cp = new SimulatedControlPlane(state('staging'));
    const p1 = proposeTrafficChange({ actor: ada, reason, change: { type: 'set_policy', kind: 'maintenance' }, state: cp.current(), now });
    const p2 = proposeTrafficChange({ actor: ada, reason, change: { type: 'set_policy', kind: 'secondary_only' }, state: cp.current(), now });
    if (!p1.ok || !p2.ok) throw new Error('propose failed');
    expect(cp.apply(p1.value, ada, now).ok).toBe(true);
    expect(cp.apply(p2.value, ada, now)).toEqual({ ok: false, error: 'Routing changed since this was proposed. Review it again.' });
    expect(cp.rollback(ada, 'short', now).ok).toBe(false);
    const rb = cp.rollback(ada, 'Maintenance finished early, restoring', now + 5);
    if (!rb.ok) throw new Error(rb.error);
    expect(rb.value.state.policy.kind).toBe('primary_only');
    expect(rb.value.state.version).toBe(3);
    expect(cp.history().audit.map((a) => a.action)).toEqual(['traffic.change.applied', 'traffic.rollback']);
  });
});
