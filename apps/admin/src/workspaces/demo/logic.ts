import {
  CHECKS,
  ISSUES,
  WAITING_REASONS,
  createRelay,
  withRelayStatus,
  type CheckState,
  type IssueCode,
  type Relay,
  type RelayApplication,
  type RelayPerson,
  type RelayRide,
  type RelayRideStatus,
  type RelayStatus,
  type Result,
  type VerificationCheck,
  type VerificationCheckId,
  type VerificationStatus,
} from '@gobye/core';
import type { Tone } from '@/ui/kit';

/** Connected demo (D-049): pure helpers for the admin view of the shared demo relay. */

export interface DemoConnection {
  relay: Relay;
  status: RelayStatus;
}

/** Relay from the build's env (VITE_DEMO_RELAY_URL / _KEY); null when the admin isn't connected. */
export function connectionFromEnv(env: { VITE_DEMO_RELAY_URL?: string; VITE_DEMO_RELAY_KEY?: string }): DemoConnection | null {
  const url = env.VITE_DEMO_RELAY_URL?.trim();
  if (!url) return null;
  const { relay, status } = withRelayStatus(createRelay({ url, key: env.VITE_DEMO_RELAY_KEY?.trim() || undefined }));
  return relay ? { relay, status } : null;
}

export const ACTIVE_RIDE: readonly RelayRideStatus[] = ['searching', 'negotiating', 'accepted', 'arrived', 'in_progress'];
export const isActiveRide = (r: Pick<RelayRide, 'status'>) => ACTIVE_RIDE.includes(r.status);

export function demoCounts(people: RelayPerson[], apps: RelayApplication[], rides: RelayRide[]) {
  return {
    riders: people.filter((p) => p.role === 'rider').length,
    drivers: people.filter((p) => p.role === 'driver').length,
    inReview: apps.filter((a) => a.status === 'pending_review').length,
    changes: apps.filter((a) => a.status === 'changes_requested').length,
    approved: apps.filter((a) => a.status === 'approved').length,
    live: rides.filter(isActiveRide).length,
    completed: rides.filter((r) => r.status === 'completed').length,
  };
}

export const APP_STATUS: Record<VerificationStatus, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'Registering', tone: 'neutral' },
  pending_review: { label: 'Waiting for review', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const CHECK_STATE: Record<CheckState, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  checking: { label: 'Checking', tone: 'info' },
  waiting: { label: 'Waiting', tone: 'warning' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const RIDE_STATUS: Record<RelayRideStatus, { label: string; tone: Tone }> = {
  searching: { label: 'Searching', tone: 'warning' },
  negotiating: { label: 'Offer open', tone: 'warning' },
  accepted: { label: 'Driver on the way', tone: 'info' },
  arrived: { label: 'Driver arrived', tone: 'info' },
  in_progress: { label: 'On trip', tone: 'brand' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'No driver', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<RelayRide['payment_status'], { label: string; tone: Tone }> = {
  not_due: { label: 'Not due', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  processing: { label: 'Confirming', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const PAYMENT_METHOD: Record<RelayRide['payment_method'], string> = { wallet: 'GoBye Wallet', bank_transfer: 'Bank transfer', cash: 'Cash' };

export const openIssueCount = (a: RelayApplication) => a.issues.filter((i) => !i.resolvedAt).length;
export const waitingChecks = (a: RelayApplication) => a.checks.filter((c) => c.state === 'waiting');

/** Every check, in the standard order, with "queued" for any the driver app hasn't sent yet. */
export function fullChecks(a: RelayApplication, now: number): VerificationCheck[] {
  return CHECKS.map((c) => a.checks.find((x) => x.id === c.id) ?? { id: c.id, state: 'queued' as const, updatedAt: now });
}

export const waitingReasonsFor = (id: VerificationCheckId) => {
  const own = WAITING_REASONS.filter((w) => w.check === id);
  return own.length ? own : WAITING_REASONS.slice(0, 1);
};

type Patch = Partial<RelayApplication>;

/** Set one check's state (waiting needs a reason: the first reason for that check unless one is given). */
export function setCheckPatch(a: RelayApplication, id: VerificationCheckId, state: CheckState, now: number, note?: string): Result<Patch> {
  if (a.status !== 'pending_review') return { ok: false, error: 'Checks can only change while the application is in review.' };
  const reason = state === 'waiting' ? note ?? waitingReasonsFor(id)[0].text : undefined;
  const checks = fullChecks(a, now).map((c) => (c.id === id ? { ...c, state, note: reason, updatedAt: now } : c));
  return { ok: true, value: { checks, updated_at: now } };
}

/** Same rules as `requestChanges` in core, on the shared row: issues open, their checks fail. */
export function requestChangesPatch(a: RelayApplication, issues: { code: IssueCode; note?: string }[], now: number, reviewNote?: string): Result<Patch> {
  if (a.status !== 'pending_review') return { ok: false, error: 'Only an application in review can be sent back.' };
  if (!issues.length) return { ok: false, error: 'Choose at least one thing to fix.' };
  const raised = issues.map((x, i) => ({ id: `iss-${now.toString(36)}-${i}`, code: x.code, note: x.note?.trim() || undefined, raisedAt: now }));
  const failing = new Set(raised.map((r) => ISSUES[r.code].check));
  const checks = fullChecks(a, now).map((c) => (failing.has(c.id) ? { ...c, state: 'failed' as const, note: undefined, updatedAt: now } : c));
  return { ok: true, value: { status: 'changes_requested', issues: [...a.issues, ...raised], checks, review_note: reviewNote?.trim() || null, updated_at: now } };
}

export function approvePatch(a: RelayApplication, staff: string, now: number): Result<Patch> {
  if (a.status !== 'pending_review') return { ok: false, error: 'Only an application in review can be approved.' };
  if (openIssueCount(a)) return { ok: false, error: 'The driver still has items to fix.' };
  const checks = fullChecks(a, now).map((c) => (c.state === 'passed' ? c : { ...c, state: 'passed' as const, note: undefined, updatedAt: now }));
  return { ok: true, value: { status: 'approved', checks, decided_at: now, decided_by: staff, review_note: null, updated_at: now } };
}

export const allChecksPassed = (a: RelayApplication, now: number) => fullChecks(a, now).every((c) => c.state === 'passed');

export function rejectPatch(a: RelayApplication, reason: string, staff: string, now: number): Result<Patch> {
  if (a.status === 'approved' || a.status === 'rejected') return { ok: false, error: 'This application already has a decision.' };
  if (!reason.trim()) return { ok: false, error: 'Add a reason.' };
  return { ok: true, value: { status: 'rejected', review_note: reason.trim(), decided_at: now, decided_by: staff, updated_at: now } };
}

export function cancelRidePatch(r: RelayRide, reason: string, now: number): Result<Partial<RelayRide>> {
  if (!isActiveRide(r)) return { ok: false, error: 'Only an active ride can be cancelled.' };
  if (!reason.trim()) return { ok: false, error: 'Add a reason.' };
  return { ok: true, value: { status: 'cancelled', cancelled_by: 'admin', cancel_reason: reason.trim(), updated_at: now } };
}

/** What happened to a ride, in order (cancellation time is the last update). */
export function rideTimeline(r: RelayRide): { at: number; title: string; sub?: string }[] {
  const items: { at: number; title: string; sub?: string }[] = [{ at: r.created_at, title: r.kind === 'negotiate' ? 'Rider sent an offer' : 'Rider requested a ride' }];
  if (r.matched_at) items.push({ at: r.matched_at, title: `Matched with ${r.driver?.firstName ?? 'a driver'}` });
  if (r.arrived_at) items.push({ at: r.arrived_at, title: 'Driver arrived' });
  if (r.started_at) items.push({ at: r.started_at, title: 'Trip started', sub: 'PIN checked' });
  if (r.completed_at) items.push({ at: r.completed_at, title: 'Trip completed' });
  if (r.status === 'cancelled') items.push({ at: r.updated_at, title: `Cancelled by ${r.cancelled_by ?? 'someone'}`, sub: r.cancel_reason ?? undefined });
  if (r.status === 'expired') items.push({ at: r.updated_at, title: 'No driver accepted' });
  return items.sort((a, b) => a.at - b.at);
}

export const ISSUE_OPTIONS = (Object.keys(ISSUES) as IssueCode[]).map((code) => ({ code, ...ISSUES[code] }));
