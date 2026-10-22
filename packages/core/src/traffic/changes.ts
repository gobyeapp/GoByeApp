import { ALWAYS_ALLOWED, type BackendOrigin, type PolicyKind, type RouteClass, type TrafficPolicy } from './model';

/**
 * Privileged traffic changes (D-051): who may switch policies or weights, and how. Changes need the
 * `infra.traffic.manage` permission, a recent MFA check, a reason, and (in production) a second person
 * to approve. Every change is audited and can be rolled back. There is no live control plane yet, so the
 * only implementation is `SimulatedControlPlane`: its results always say `simulated: true`.
 */

export const TRAFFIC_PERMISSION = 'infra.traffic.manage';
export const MFA_MAX_AGE_MS = 10 * 60_000;

export type TrafficEnvironment = 'staging' | 'production';

export type TrafficChange =
  | { type: 'set_policy'; kind: PolicyKind; disabled?: RouteClass[]; notice?: string }
  | { type: 'set_weights'; weights: Record<string, number> }
  | { type: 'set_maintenance'; originId: string; maintenance: boolean };

export interface TrafficActor {
  id: string;
  name: string;
  permissions: string[];
  /** When this person last passed an MFA challenge (ms), or null. */
  mfaVerifiedAt: number | null;
}

export interface TrafficState {
  version: number;
  environment: TrafficEnvironment;
  policy: TrafficPolicy;
  origins: BackendOrigin[];
}

export interface TrafficChangeRequest {
  id: string;
  environment: TrafficEnvironment;
  change: TrafficChange;
  reason: string;
  proposedBy: TrafficActor['id'];
  proposedAt: number;
  /** State version the change was proposed against (stale proposals are refused). */
  baseVersion: number;
  status: 'pending_approval' | 'approved' | 'applied' | 'rejected';
  approvedBy?: TrafficActor['id'];
  approvedAt?: number;
}

export interface TrafficAuditEvent {
  id: string;
  at: number;
  actor: TrafficActor['id'];
  action: 'traffic.change.proposed' | 'traffic.change.approved' | 'traffic.change.rejected' | 'traffic.change.applied' | 'traffic.rollback';
  environment: TrafficEnvironment;
  reason: string;
  before: { version: number; policy: PolicyKind };
  after?: { version: number; policy: PolicyKind };
  summary: string;
  /** Always true until a live control plane adapter exists. */
  simulated: boolean;
}

type TResult<T> = { ok: true; value: T } | { ok: false; error: string };

function authorise(actor: TrafficActor, now: number): string | null {
  if (!actor.permissions.includes(TRAFFIC_PERMISSION)) return 'You don’t have permission to change traffic routing.';
  if (!actor.mfaVerifiedAt || now - actor.mfaVerifiedAt > MFA_MAX_AGE_MS) return 'Confirm it’s you (two-step verification) before changing traffic.';
  return null;
}

export function validateChange(change: TrafficChange, state: TrafficState): string | null {
  if (change.type === 'set_weights') {
    const ids = new Set(state.origins.map((o) => o.id));
    const entries = Object.entries(change.weights);
    if (!entries.length) return 'Set at least one weight.';
    for (const [id, w] of entries) {
      if (!ids.has(id)) return 'Unknown origin.';
      if (!Number.isInteger(w) || w < 0 || w > 100) return 'Weights are whole numbers from 0 to 100.';
    }
    const total = state.origins.reduce((sum, o) => sum + (change.weights[o.id] ?? o.weight), 0);
    if (total <= 0) return 'At least one origin needs a weight above 0.';
  }
  if (change.type === 'set_maintenance' && !state.origins.some((o) => o.id === change.originId)) return 'Unknown origin.';
  if (change.type === 'set_policy') {
    if (change.kind === state.policy.kind && change.kind !== 'emergency') return 'That is already the current policy.';
    if ((change.kind === 'weighted' || change.kind === 'secondary_only') && state.origins.length < 2) return 'This policy needs a second origin.';
    if (change.kind === 'emergency' && !(change.disabled ?? []).length) return 'Choose what to switch off.';
    if ((change.disabled ?? []).some((c) => ALWAYS_ALLOWED.includes(c))) return 'Trips in progress, safety and support can’t be switched off.';
  }
  return null;
}

export function describeChange(change: TrafficChange): string {
  switch (change.type) {
    case 'set_policy':
      return `Policy → ${change.kind}${change.disabled?.length ? ` (off: ${change.disabled.join(', ')})` : ''}`;
    case 'set_weights':
      return `Weights → ${Object.entries(change.weights).map(([id, w]) => `${id} ${w}%`).join(', ')}`;
    case 'set_maintenance':
      return `${change.originId} → ${change.maintenance ? 'drained (maintenance)' : 'back in rotation'}`;
  }
}

export function proposeTrafficChange(input: { actor: TrafficActor; reason: string; change: TrafficChange; state: TrafficState; now: number; id?: string }): TResult<TrafficChangeRequest> {
  const denied = authorise(input.actor, input.now);
  if (denied) return { ok: false, error: denied };
  if (input.reason.trim().length < 10) return { ok: false, error: 'Give a reason (at least 10 characters). It goes in the audit log.' };
  const invalid = validateChange(input.change, input.state);
  if (invalid) return { ok: false, error: invalid };
  return {
    ok: true,
    value: {
      id: input.id ?? `tc-${input.now.toString(36)}`,
      environment: input.state.environment,
      change: input.change,
      reason: input.reason.trim(),
      proposedBy: input.actor.id,
      proposedAt: input.now,
      baseVersion: input.state.version,
      // Staging changes apply on the proposer's authority; production needs a second person.
      status: input.state.environment === 'production' ? 'pending_approval' : 'approved',
      approvedBy: input.state.environment === 'production' ? undefined : input.actor.id,
      approvedAt: input.state.environment === 'production' ? undefined : input.now,
    },
  };
}

export function approveTrafficChange(req: TrafficChangeRequest, approver: TrafficActor, now: number): TResult<TrafficChangeRequest> {
  if (req.status !== 'pending_approval') return { ok: false, error: 'This change isn’t waiting for approval.' };
  if (approver.id === req.proposedBy) return { ok: false, error: 'Someone else must approve a production change.' };
  const denied = authorise(approver, now);
  if (denied) return { ok: false, error: denied };
  return { ok: true, value: { ...req, status: 'approved', approvedBy: approver.id, approvedAt: now } };
}

/** The new state a change produces (pure). */
export function applyChange(state: TrafficState, change: TrafficChange, actor: string, now: number): TrafficState {
  const version = state.version + 1;
  switch (change.type) {
    case 'set_policy':
      return { ...state, version, policy: { kind: change.kind, disabled: change.kind === 'emergency' ? change.disabled : undefined, notice: change.notice, version, updatedAt: now, updatedBy: actor } };
    case 'set_weights':
      return { ...state, version, policy: { ...state.policy, version, updatedAt: now, updatedBy: actor }, origins: state.origins.map((o) => (o.id in change.weights ? { ...o, weight: change.weights[o.id] } : o)) };
    case 'set_maintenance':
      return { ...state, version, policy: { ...state.policy, version, updatedAt: now, updatedBy: actor }, origins: state.origins.map((o) => (o.id === change.originId ? { ...o, maintenance: change.maintenance } : o)) };
  }
}

/* ---------- Control plane ---------- */

export interface TrafficControlPlane {
  /** True only for an adapter that really changes routing (none exists yet). */
  readonly live: boolean;
  current(): TrafficState;
  history(): { states: TrafficState[]; audit: TrafficAuditEvent[] };
  apply(req: TrafficChangeRequest, actor: TrafficActor, now: number): TResult<{ state: TrafficState; audit: TrafficAuditEvent; simulated: boolean }>;
  rollback(actor: TrafficActor, reason: string, now: number): TResult<{ state: TrafficState; audit: TrafficAuditEvent; simulated: boolean }>;
}

/**
 * In-memory control plane for the admin preview and tests. It changes nothing outside this object:
 * every result is `simulated: true`. A live adapter (Cloudflare Load Balancing API or gateway KV)
 * will implement the same interface once origins exist and access is approved.
 */
export class SimulatedControlPlane implements TrafficControlPlane {
  readonly live = false;
  private states: TrafficState[];
  private audit: TrafficAuditEvent[] = [];
  private seq = 0;

  constructor(initial: TrafficState) {
    this.states = [initial];
  }

  current(): TrafficState {
    return this.states[this.states.length - 1];
  }

  history() {
    return { states: [...this.states], audit: [...this.audit] };
  }

  private event(e: Omit<TrafficAuditEvent, 'id' | 'simulated'>): TrafficAuditEvent {
    const ev: TrafficAuditEvent = { ...e, id: `ta-${e.at.toString(36)}-${++this.seq}`, simulated: true };
    this.audit.push(ev);
    return ev;
  }

  apply(req: TrafficChangeRequest, actor: TrafficActor, now: number) {
    const cur = this.current();
    if (req.status !== 'approved') return { ok: false as const, error: 'This change hasn’t been approved.' };
    if (req.baseVersion !== cur.version) return { ok: false as const, error: 'Routing changed since this was proposed. Review it again.' };
    const denied = authorise(actor, now);
    if (denied) return { ok: false as const, error: denied };
    const invalid = validateChange(req.change, cur);
    if (invalid) return { ok: false as const, error: invalid };
    const next = applyChange(cur, req.change, actor.id, now);
    this.states.push(next);
    const audit = this.event({
      at: now,
      actor: actor.id,
      action: 'traffic.change.applied',
      environment: cur.environment,
      reason: req.reason,
      before: { version: cur.version, policy: cur.policy.kind },
      after: { version: next.version, policy: next.policy.kind },
      summary: `${describeChange(req.change)} (proposed by ${req.proposedBy}${req.approvedBy && req.approvedBy !== req.proposedBy ? `, approved by ${req.approvedBy}` : ''})`,
    });
    return { ok: true as const, value: { state: next, audit, simulated: true } };
  }

  /** Back to the previous state. Needs permission, MFA and a reason, but not a second approver: it's the safe direction. */
  rollback(actor: TrafficActor, reason: string, now: number) {
    const denied = authorise(actor, now);
    if (denied) return { ok: false as const, error: denied };
    if (reason.trim().length < 10) return { ok: false as const, error: 'Give a reason (at least 10 characters).' };
    if (this.states.length < 2) return { ok: false as const, error: 'Nothing to roll back.' };
    const cur = this.current();
    const prev = this.states[this.states.length - 2];
    const next: TrafficState = { ...prev, version: cur.version + 1, policy: { ...prev.policy, version: cur.version + 1, updatedAt: now, updatedBy: actor.id } };
    this.states.push(next);
    const audit = this.event({
      at: now,
      actor: actor.id,
      action: 'traffic.rollback',
      environment: cur.environment,
      reason: reason.trim(),
      before: { version: cur.version, policy: cur.policy.kind },
      after: { version: next.version, policy: next.policy.kind },
      summary: `Rolled back to version ${prev.version}`,
    });
    return { ok: true as const, value: { state: next, audit, simulated: true } };
  }
}
