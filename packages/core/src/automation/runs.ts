import type { GatewayErrorClass } from '../gateway/adapter';
import type { Permission } from '../platform/permissions';
import { AUTOMATIONS, type AutomationDefinition, type RetryPolicy } from './registry';

/**
 * Automation runs, failure classification and the protected retry rules (D-055).
 *
 * Status: logic + SIMULATED run history for the admin prototype. No job runner exists yet; every run
 * shown in the admin is test data and is labelled so.
 */

export type FailureClass = GatewayErrorClass | 'timeout';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  /** Failed with a transient error; another attempt is scheduled. */
  | 'retry_scheduled'
  /** Out of automatic attempts, or a permanent failure: needs a person. */
  | 'failed'
  /** The outcome is not known (e.g. timed out after sending money). Must be looked up, never re-run blindly. */
  | 'needs_lookup'
  | 'cancelled';

export interface RunAttempt {
  n: number;
  startedAt: number;
  finishedAt?: number;
  outcome: 'succeeded' | 'failed';
  failure?: { class: FailureClass; code: string; message: string };
}

export interface AutomationRun {
  id: string;
  automationId: string;
  /** What started it: an event id, a schedule tick, a webhook event id or a staff retry. */
  triggeredBy: { kind: 'event' | 'schedule' | 'webhook' | 'condition' | 'staff_retry'; ref: string; staffName?: string };
  subject?: { type: 'driver' | 'passenger' | 'withdrawal' | 'collection' | 'case' | 'booking' | 'provider' | 'day'; id: string; label: string };
  idempotencyKey: string;
  status: RunStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextAttemptAt?: number;
  attempts: RunAttempt[];
  escalated?: { at: number; toRoles: string[] };
  /** Set when a person retried, looked up or cancelled it. */
  handledBy?: { name: string; at: number; action: 'retried' | 'looked_up' | 'cancelled' | 'resolved'; reason: string };
  simulated: true;
}

/**
 * Classify a raw failure. Anything that might have reached the other side counts as `unknown_outcome`
 * for financial work, so it can never be retried blindly.
 */
export function classifyFailure(e: { class?: FailureClass; status?: number; code?: string; sent?: boolean }, financial: boolean): FailureClass {
  if (e.class === 'unknown_outcome') return 'unknown_outcome';
  if (e.class === 'timeout' || e.code === 'timeout') return financial && e.sent !== false ? 'unknown_outcome' : 'timeout';
  if (e.class) return e.class;
  if (e.status === 429 || (e.status !== undefined && e.status >= 500)) return financial && e.sent ? 'unknown_outcome' : 'transient';
  if (e.status !== undefined && e.status >= 400) return 'permanent';
  return financial ? 'unknown_outcome' : 'transient';
}

/** Delay before attempt `n` (2 = first retry): exponential backoff with ±20% jitter, capped. */
export function retryDelay(policy: RetryPolicy, n: number, rand: () => number = Math.random): number {
  if (n < 2) return 0;
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (n - 2));
  return Math.round(raw * (0.8 + rand() * 0.4));
}

/** What happens after an attempt fails. */
export function afterFailure(def: Pick<AutomationDefinition, 'retry' | 'financial'>, attemptsSoFar: number, failure: FailureClass, now: number, rand?: () => number): { status: RunStatus; nextAttemptAt?: number } {
  if (failure === 'unknown_outcome') return { status: 'needs_lookup' };
  const retryable = failure === 'transient' || (failure === 'timeout' && !def.financial);
  if (retryable && attemptsSoFar < def.retry.maxAttempts) return { status: 'retry_scheduled', nextAttemptAt: now + retryDelay(def.retry, attemptsSoFar + 1, rand) };
  return { status: 'failed' };
}

export type ManualAction = 'retry' | 'lookup' | 'cancel';
export interface ManualCheck {
  allowed: boolean;
  /** Why not, or what will happen. */
  message: string;
}

const RETRY_PERMISSION: Permission = 'automation.retry';

/**
 * The protected retry rules. A person may:
 *  - retry a FAILED non-financial run, or a failed financial run whose last failure was definitely not
 *    processed (transient/permanent), only after the cause is fixed, with a reason; the retry reuses the
 *    same idempotency key, so the other side can't apply it twice;
 *  - look up a NEEDS_LOOKUP run (never retry it);
 *  - never replay a SUCCEEDED run, financial or not (a new run must come from a new event).
 */
export function manualActionCheck(run: Pick<AutomationRun, 'status' | 'attempts' | 'automationId'>, action: ManualAction, can: (p: Permission) => boolean): ManualCheck {
  const def = AUTOMATIONS.find((a) => a.id === run.automationId);
  if (!def) return { allowed: false, message: 'Unknown automation.' };
  if (!can(RETRY_PERMISSION)) return { allowed: false, message: 'Your role can’t act on automation runs.' };
  if (run.status === 'succeeded') return { allowed: false, message: 'Finished successfully. Successful runs are never replayed.' };
  if (action === 'lookup') {
    return run.status === 'needs_lookup' || (def.financial && run.status === 'failed')
      ? { allowed: true, message: 'Ask the provider for the result by reference. Nothing is resent.' }
      : { allowed: false, message: 'Only runs with an unknown result need a lookup.' };
  }
  if (action === 'cancel') {
    return run.status === 'queued' || run.status === 'retry_scheduled' ? { allowed: true, message: 'Stops further automatic attempts.' } : { allowed: false, message: 'Only queued or waiting runs can be cancelled.' };
  }
  // retry
  if (run.status === 'needs_lookup') return { allowed: false, message: 'The result is unknown. Look it up first; retrying could pay or credit twice.' };
  if (run.status !== 'failed') return { allowed: false, message: 'Only failed runs can be retried.' };
  if (def.manualRetry === 'not_allowed') return { allowed: false, message: 'This automation is never retried by hand; the next event starts a new run.' };
  const last = run.attempts.at(-1)?.failure?.class;
  if (def.financial && (last === 'unknown_outcome' || last === 'timeout')) return { allowed: false, message: 'Money may have moved. Look it up with the provider instead.' };
  if (def.manualRetry === 'lookup_first') return { allowed: true, message: 'Retries with the same reference after a lookup confirms nothing was processed.' };
  return { allowed: true, message: 'Runs again with the same idempotency key.' };
}

/** Counts for the Automation Centre header. */
export function runSummary(runs: readonly AutomationRun[]) {
  const by = (s: RunStatus) => runs.filter((r) => r.status === s).length;
  return { total: runs.length, succeeded: by('succeeded'), failed: by('failed'), needsLookup: by('needs_lookup'), retrying: by('retry_scheduled'), queued: by('queued') + by('running') };
}

/** Consecutive failures at the end of an automation's history (for escalation). */
export function consecutiveFailures(runs: readonly AutomationRun[], automationId: string): number {
  const xs = runs.filter((r) => r.automationId === automationId && r.finishedAt).sort((a, b) => b.finishedAt! - a.finishedAt!);
  let n = 0;
  for (const r of xs) {
    if (r.status === 'failed' || r.status === 'needs_lookup') n += 1;
    else break;
  }
  return n;
}

export function shouldEscalate(def: Pick<AutomationDefinition, 'escalation'>, run: Pick<AutomationRun, 'status'>, consecutive: number): boolean {
  if (run.status !== 'failed' && run.status !== 'needs_lookup') return false;
  return def.escalation.immediate === true || consecutive >= def.escalation.afterFailures;
}
