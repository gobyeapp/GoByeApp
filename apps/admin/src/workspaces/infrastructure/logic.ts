import {
  SimulatedControlPlane,
  TRAFFIC_PERMISSION,
  approveTrafficChange,
  proposeTrafficChange,
  selectOrigin,
  type BackendOrigin,
  type RouteClass,
  type StaffMember,
  type TrafficActor,
  type TrafficChange,
  type TrafficChangeRequest,
  type TrafficEnvironment,
  type TrafficState,
} from '@gobye/core';

/**
 * Traffic and origins (D-051) — SIMULATION. No backend origin exists yet and there is no connection to a
 * live control plane (Cloudflare Load Balancing API or gateway configuration), so everything here runs on
 * `SimulatedControlPlane` in this browser tab. Nothing changes production traffic.
 *
 * Permissions: the platform permission list has no infrastructure entry yet, so this page maps roles
 * locally. The backend must enforce the real `infra.traffic.manage` permission and MFA server-side.
 */

export const INFRA_VIEW_ROLES: readonly StaffMember['roles'][number][] = ['owner', 'admin', 'developer', 'auditor'];
export const INFRA_MANAGE_ROLES: readonly StaffMember['roles'][number][] = ['owner', 'admin', 'developer'];

export const canViewInfra = (staff: Pick<StaffMember, 'roles'> | null) => !!staff && staff.roles.some((r) => INFRA_VIEW_ROLES.includes(r));
export const canManageInfra = (staff: Pick<StaffMember, 'roles'> | null) => !!staff && staff.roles.some((r) => INFRA_MANAGE_ROLES.includes(r));

export function toTrafficActor(staff: Pick<StaffMember, 'id' | 'name' | 'roles'>, mfaVerifiedAt: number | null): TrafficActor {
  return { id: staff.id, name: staff.name, permissions: canManageInfra(staff) ? [TRAFFIC_PERMISSION] : [], mfaVerifiedAt };
}

/** Example origins for exploring the flow. Clearly not real: example.invalid hosts, "simulation" labels. */
export function exampleOrigins(now: number): BackendOrigin[] {
  const base = { health: 'healthy' as const, maintenance: false, version: 'example', lastHealthyAt: now, lastFailoverAt: null };
  return [
    { ...base, id: 'example-a', endpoint: 'https://origin-a.example.invalid', region: 'Region A (example)', provider: 'Example provider A (simulation)', weight: 100, priority: 1 },
    { ...base, id: 'example-b', endpoint: 'https://origin-b.example.invalid', region: 'Region B (example)', provider: 'Example provider B (simulation)', weight: 0, priority: 2 },
  ];
}

export const emptyState = (env: TrafficEnvironment, now: number): TrafficState => ({
  version: 1,
  environment: env,
  policy: { kind: 'primary_only', version: 1, updatedAt: now, updatedBy: 'default' },
  origins: [],
});

/** Expected share of new traffic per origin for a route class, by sampling the real selection rules (seeded). */
export function expectedShare(state: TrafficState, routeClass: RouteClass, samples = 2000): { id: string; share: number }[] | { blocked: string } {
  let s = 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const counts = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const r = selectOrigin(state.policy, state.origins, routeClass, rand, { now: state.policy.updatedAt + 60 * 60_000 });
    if (!r.ok) return { blocked: r.message };
    counts.set(r.origin.id, (counts.get(r.origin.id) ?? 0) + 1);
  }
  return state.origins.map((o) => ({ id: o.id, share: Math.round(((counts.get(o.id) ?? 0) / samples) * 100) }));
}

/**
 * Tab-wide simulated store (one control plane per environment). It lives above sign-in, like the test
 * data, so one person can propose and another (after switching staff) can approve.
 */
export function createInfraStore(now: () => number) {
  const planes: Record<TrafficEnvironment, SimulatedControlPlane> = {
    staging: new SimulatedControlPlane(emptyState('staging', now())),
    production: new SimulatedControlPlane(emptyState('production', now())),
  };
  let requests: TrafficChangeRequest[] = [];
  const subs = new Set<() => void>();
  let tick = 0;
  const emit = () => {
    tick++;
    subs.forEach((f) => f());
  };
  return {
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    version: () => tick,
    plane: (env: TrafficEnvironment) => planes[env],
    requests: (env: TrafficEnvironment) => requests.filter((r) => r.environment === env),
    loadExamples(env: TrafficEnvironment) {
      planes[env] = new SimulatedControlPlane({ ...emptyState(env, now()), origins: exampleOrigins(now()) });
      requests = requests.filter((r) => r.environment !== env);
      emit();
    },
    clear(env: TrafficEnvironment) {
      planes[env] = new SimulatedControlPlane(emptyState(env, now()));
      requests = requests.filter((r) => r.environment !== env);
      emit();
    },
    propose(env: TrafficEnvironment, actor: TrafficActor, change: TrafficChange, reason: string) {
      const r = proposeTrafficChange({ actor, reason, change, state: planes[env].current(), now: now(), id: `tc-${now().toString(36)}-${requests.length + 1}` });
      if (!r.ok) return r;
      if (r.value.status === 'approved') {
        const applied = planes[env].apply(r.value, actor, now());
        if (!applied.ok) return applied;
        requests = [...requests, { ...r.value, status: 'applied' }];
        emit();
        return { ok: true as const, value: { request: { ...r.value, status: 'applied' as const }, applied: true } };
      }
      requests = [...requests, r.value];
      emit();
      return { ok: true as const, value: { request: r.value, applied: false } };
    },
    approveAndApply(env: TrafficEnvironment, id: string, approver: TrafficActor) {
      const req = requests.find((x) => x.id === id);
      if (!req) return { ok: false as const, error: 'Request not found.' };
      const a = approveTrafficChange(req, approver, now());
      if (!a.ok) return a;
      const applied = planes[env].apply(a.value, approver, now());
      if (!applied.ok) {
        requests = requests.map((x) => (x.id === id ? { ...a.value, status: 'rejected' } : x));
        emit();
        return applied;
      }
      requests = requests.map((x) => (x.id === id ? { ...a.value, status: 'applied' } : x));
      emit();
      return { ok: true as const, value: applied.value };
    },
    reject(env: TrafficEnvironment, id: string) {
      requests = requests.map((x) => (x.id === id && x.environment === env && x.status === 'pending_approval' ? { ...x, status: 'rejected' } : x));
      emit();
    },
    rollback(env: TrafficEnvironment, actor: TrafficActor, reason: string) {
      const r = planes[env].rollback(actor, reason, now());
      if (r.ok) emit();
      return r;
    },
  };
}

export type InfraStore = ReturnType<typeof createInfraStore>;
