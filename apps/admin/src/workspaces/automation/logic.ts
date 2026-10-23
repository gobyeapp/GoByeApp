import {
  APPROVAL_RULES,
  AUTOMATIONS,
  automationById,
  manualActionCheck,
  validateParamChange,
  type Actor,
  type AuditEvent,
  type AutomationDefinition,
  type AutomationRun,
  type AutomationSettingChange,
  type ApprovalRequest,
  type ManualAction,
  type Permission,
  type PlatformDataset,
  type RunStatus,
  type StaffRole,
  type TriggerType,
} from '@gobye/core';
import type { IconName } from '@/ui/Icon';
import type { Tone } from '@/ui/kit';

/**
 * UI logic for the Automation Centre (D-055). Reads the registry and the SIMULATED run history; the
 * actions below only change the prototype's test records, the way the backend's job runner will once it
 * exists. Every action re-checks the protected retry rules here too, not only in the button.
 */

export type Result = { ok: true } | { ok: false; error: string };

export const RUN_STATUS: Record<RunStatus, { tone: Tone; text: string; icon: IconName }> = {
  queued: { tone: 'neutral', text: 'Queued', icon: 'time' },
  running: { tone: 'info', text: 'Running', icon: 'refresh' },
  succeeded: { tone: 'success', text: 'Succeeded', icon: 'checkCircle' },
  retry_scheduled: { tone: 'warning', text: 'Retrying', icon: 'refresh' },
  failed: { tone: 'danger', text: 'Failed', icon: 'alert' },
  needs_lookup: { tone: 'danger', text: 'Needs lookup', icon: 'search' },
  cancelled: { tone: 'neutral', text: 'Cancelled', icon: 'close' },
};

export const TRIGGER_LABEL: Record<TriggerType, string> = { event: 'Event', schedule: 'Schedule', webhook: 'Webhook', condition: 'Timer or condition' };

export const MANUAL_LABEL: Record<AutomationDefinition['manualRetry'], string> = {
  allowed: 'Retry allowed after a failure',
  lookup_first: 'Look up first, then retry with the same reference',
  not_allowed: 'Never retried by hand',
};

export const FAILURE_LABEL: Record<string, string> = {
  transient: 'Temporary',
  permanent: 'Permanent',
  unknown_outcome: 'Unknown outcome',
  timeout: 'Timed out',
};

export const runsFor = (runs: readonly AutomationRun[], automationId: string) => runs.filter((r) => r.automationId === automationId);

export function lastRun(runs: readonly AutomationRun[], automationId: string): AutomationRun | undefined {
  return runsFor(runs, automationId)
    .filter((r) => r.status !== 'queued')
    .sort((a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt))[0];
}

/** The next queued run, if the (simulated) history has one. Never invented from the schedule text. */
export function nextQueued(runs: readonly AutomationRun[], automationId: string): AutomationRun | undefined {
  return runsFor(runs, automationId)
    .filter((r) => r.status === 'queued' || r.status === 'retry_scheduled')
    .sort((a, b) => (a.nextAttemptAt ?? a.queuedAt) - (b.nextAttemptAt ?? b.queuedAt))[0];
}

export const runStart = (r: Pick<AutomationRun, 'startedAt' | 'queuedAt'>) => r.startedAt ?? r.queuedAt;

export function runDuration(r: Pick<AutomationRun, 'startedAt' | 'finishedAt'>): number | null {
  return r.startedAt !== undefined && r.finishedAt !== undefined ? r.finishedAt - r.startedAt : null;
}

export function durationText(ms: number | null): string {
  if (ms === null) return 'Not finished';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 360_000) / 10} h`;
}

export function delayText(ms: number): string {
  if (ms <= 0) return 'immediately';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 360_000) / 10} h`;
}

export function retryText(def: AutomationDefinition): string {
  if (def.retry.maxAttempts <= 1) return 'No automatic retry';
  return `Up to ${def.retry.maxAttempts} attempts, waiting ${delayText(def.retry.baseDelayMs)} then doubling, at most ${delayText(def.retry.maxDelayMs)}`;
}

export function escalationText(def: AutomationDefinition, roleLabel: (r: StaffRole) => string): string {
  const when = def.escalation.immediate ? 'At the first failure' : `After ${def.escalation.afterFailures} failed run${def.escalation.afterFailures === 1 ? '' : 's'} in a row`;
  const how = def.escalation.channel === 'admin_alert' ? 'admin alert' : 'admin alert and email';
  return `${when}: ${how} to ${def.escalation.toRoles.map(roleLabel).join(', ')}`;
}

export interface RunFilter {
  automationId: string | 'all';
  status: RunStatus | 'all';
  area: AutomationDefinition['area'] | 'all';
  q: string;
}

export function filterRuns(runs: readonly AutomationRun[], f: RunFilter): AutomationRun[] {
  const q = f.q.trim().toLowerCase();
  return runs.filter((r) => {
    if (f.automationId !== 'all' && r.automationId !== f.automationId) return false;
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.area !== 'all' && automationById(r.automationId)?.area !== f.area) return false;
    if (!q) return true;
    return [r.id, r.idempotencyKey, r.subject?.label, r.subject?.id, r.triggeredBy.ref, automationById(r.automationId)?.name].some((x) => x?.toLowerCase().includes(q));
  });
}

const QUEUE_ORDER: Partial<Record<RunStatus, number>> = { needs_lookup: 0, failed: 1, retry_scheduled: 2 };

/** Failed jobs page: unknown outcomes first (money may have moved), then failures, then automatic retries. */
export function failedQueue(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((r) => QUEUE_ORDER[r.status] !== undefined).sort((a, b) => QUEUE_ORDER[a.status]! - QUEUE_ORDER[b.status]! || runStart(b) - runStart(a));
}

/** Staff who may propose a setting change: automation.configure, or holding the automation's owner role. */
export function canProposeChange(def: Pick<AutomationDefinition, 'ownerRole'>, roles: readonly StaffRole[], can: (p: Permission) => boolean): boolean {
  return can('automation.configure') || roles.includes(def.ownerRole);
}

/* ---------- Actions (prototype: change test records, audited by the caller) ---------- */

function nextId(prefix: string, ids: string[]): string {
  const n = ids.map((i) => Number(i.replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

const staffName = (a: Actor) => a.name;

export function applyManualAction(
  draft: PlatformDataset,
  runId: string,
  action: ManualAction,
  ctx: { now: number; actor: Actor; reason: string; can: (p: Permission) => boolean },
): Result {
  const run = draft.automationRuns.find((r) => r.id === runId);
  if (!run) return { ok: false, error: 'Run not found' };
  const check = manualActionCheck(run, action, ctx.can);
  if (!check.allowed) return { ok: false, error: check.message };
  const reason = ctx.reason.trim();
  if (!reason) return { ok: false, error: 'Add a reason first' };
  if (action === 'retry') {
    // Same idempotency key: the job (and the provider) recognise a repeat and never apply it twice.
    run.handledBy = { name: staffName(ctx.actor), at: ctx.now, action: 'retried', reason };
    draft.automationRuns.unshift({
      id: nextId('run', draft.automationRuns.map((r) => r.id)),
      automationId: run.automationId,
      triggeredBy: { kind: 'staff_retry', ref: run.id, staffName: staffName(ctx.actor) },
      subject: run.subject,
      idempotencyKey: run.idempotencyKey,
      status: 'queued',
      queuedAt: ctx.now,
      attempts: [],
      simulated: true,
    });
    return { ok: true };
  }
  if (action === 'lookup') {
    // A real lookup asks the provider for the result by reference. The prototype can't reach a provider,
    // so it records the request and leaves the run as it is.
    run.handledBy = { name: staffName(ctx.actor), at: ctx.now, action: 'looked_up', reason };
    return { ok: true };
  }
  run.status = 'cancelled';
  run.nextAttemptAt = undefined;
  run.handledBy = { name: staffName(ctx.actor), at: ctx.now, action: 'cancelled', reason };
  return { ok: true };
}

export function proposeSettingChange(
  draft: PlatformDataset,
  p: { automationId: string; key: string; to: number | boolean; reason: string },
  ctx: { now: number; actor: Actor; roles: readonly StaffRole[]; can: (p: Permission) => boolean; current: number | boolean | undefined },
): { ok: true; changeId: string; approvalId: string } | { ok: false; error: string } {
  const def = automationById(p.automationId);
  if (!def) return { ok: false, error: 'Unknown automation' };
  if (!canProposeChange(def, ctx.roles, ctx.can)) return { ok: false, error: 'Your role can’t change this automation' };
  if (ctx.actor.kind !== 'staff') return { ok: false, error: 'Only staff can propose changes' };
  const bad = validateParamChange(def, p.key, p.to);
  if (bad) return { ok: false, error: bad };
  if (!p.reason.trim()) return { ok: false, error: 'Add a reason first' };
  if (ctx.current === p.to) return { ok: false, error: 'That is already the value in force' };
  if (draft.automationChanges.some((c) => c.automationId === p.automationId && c.key === p.key && c.status === 'pending_approval'))
    return { ok: false, error: 'A change to this setting is already waiting for approval' };
  const param = def.params.find((x) => x.key === p.key)!;
  const change: AutomationSettingChange = {
    id: nextId('asc', draft.automationChanges.map((c) => c.id)),
    automationId: def.id,
    key: p.key,
    from: ctx.current ?? param.value,
    to: p.to,
    reason: p.reason.trim(),
    status: 'pending_approval',
    requestedBy: { id: ctx.actor.id, name: ctx.actor.name },
    requestedAt: ctx.now,
  };
  const approval: ApprovalRequest = {
    id: nextId('apr', draft.approvals.map((a) => a.id)),
    kind: 'automation_config',
    title: `${def.name}: ${param.label} ${valueText(param.kind, change.from)} → ${valueText(param.kind, change.to)}`,
    requestedBy: ctx.actor,
    requestedAt: ctx.now,
    target: { type: 'automation', id: def.id, label: def.name },
    status: 'pending',
    approverRoles: APPROVAL_RULES.automation_config.approverRoles,
    note: change.id,
  };
  draft.automationChanges.unshift(change);
  draft.approvals.unshift(approval);
  return { ok: true, changeId: change.id, approvalId: approval.id };
}

export function valueText(kind: string, v: number | boolean): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  const unit = kind === 'minutes' ? 'min' : kind === 'hours' ? (v === 1 ? 'hour' : 'hours') : kind === 'days' ? (v === 1 ? 'day' : 'days') : '';
  return unit ? `${v} ${unit}` : String(v);
}

/* ---------- Audit ---------- */

const AUDIT_PREFIXES = ['automation', 'fee', 'integration.', 'payments', 'event.retried'];

/** Audit events about automation and payment configuration. */
export function isAutomationAudit(e: Pick<AuditEvent, 'action' | 'target'>): boolean {
  if (AUDIT_PREFIXES.some((p) => e.action.startsWith(p))) return true;
  return ['automation', 'automation_run', 'fee_schedule', 'integration'].includes(e.target.type);
}

export function automationAudit(d: Pick<PlatformDataset, 'audit'>): AuditEvent[] {
  return d.audit.filter(isAutomationAudit).sort((a, b) => b.at - a.at);
}

export function relevantApprovals(d: Pick<PlatformDataset, 'approvals'>): ApprovalRequest[] {
  return d.approvals.filter((a) => a.kind === 'automation_config' || a.kind === 'fee_schedule' || a.kind === 'payments_activation').sort((a, b) => b.requestedAt - a.requestedAt);
}

/* ---------- Overview ---------- */

const OPEN_FAILURE: RunStatus[] = ['failed', 'needs_lookup'];

/** A run still waiting for a person: failed or unknown result, not yet handled. */
export const isOpenFailure = (r: Pick<AutomationRun, 'status' | 'handledBy'>) => OPEN_FAILURE.includes(r.status) && !r.handledBy;

export type Health = 'healthy' | 'failing' | 'retrying' | 'no_runs';

/** Health of one workflow from its (simulated) runs: healthy = last run succeeded and nothing left open. */
export function workflowHealth(runs: readonly AutomationRun[], automationId: string): Health {
  const mine = runsFor(runs, automationId);
  if (mine.some(isOpenFailure)) return 'failing';
  if (mine.some((r) => r.status === 'retry_scheduled')) return 'retrying';
  const last = lastRun(runs, automationId);
  if (!last) return 'no_runs';
  return last.status === 'succeeded' ? 'healthy' : last.status === 'cancelled' ? 'no_runs' : 'failing';
}

export const HEALTH_META: Record<Health, { tone: Tone; text: string; icon: IconName }> = {
  healthy: { tone: 'success', text: 'Healthy', icon: 'checkCircle' },
  failing: { tone: 'danger', text: 'Needs attention', icon: 'alert' },
  retrying: { tone: 'warning', text: 'Retrying', icon: 'refresh' },
  no_runs: { tone: 'neutral', text: 'No runs yet', icon: 'time' },
};

/** Counts for the Automation Centre overview, all computed from the run history. */
export function overviewCounts(runs: readonly AutomationRun[]) {
  return {
    total: AUTOMATIONS.length,
    healthy: AUTOMATIONS.filter((a) => workflowHealth(runs, a.id) === 'healthy').length,
    failed: runs.filter(isOpenFailure).length,
    pending: runs.filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'retry_scheduled').length,
    upcoming: runs.filter((r) => r.status === 'queued').length,
  };
}

/** Financial and safety-critical workflows: controls are restricted to roles with automation retry access. */
export const isRestricted = (def: Pick<AutomationDefinition, 'financial' | 'area'>) => def.financial || def.area === 'safety';

export const AREA_ICON: Record<AutomationDefinition['area'], IconName> = {
  subscriptions: 'ticket',
  wallet: 'wallet',
  payments: 'exchange',
  reconciliation: 'balance',
  drivers: 'fileCheck',
  bookings: 'route',
  support: 'headphone',
  safety: 'safeAlert',
  infrastructure: 'server',
};

/** Audit entries about one workflow: its settings and its runs. */
export function auditForAutomation(d: Pick<PlatformDataset, 'audit' | 'automationRuns'>, automationId: string): AuditEvent[] {
  const runIds = new Set(runsFor(d.automationRuns, automationId).map((r) => r.id));
  return d.audit.filter((e) => (e.target.type === 'automation' && e.target.id === automationId) || (e.target.type === 'automation_run' && runIds.has(e.target.id))).sort((a, b) => b.at - a.at);
}

export const AUTOMATION_OPTIONS = AUTOMATIONS.map((a) => ({ value: a.id, label: a.name }));
