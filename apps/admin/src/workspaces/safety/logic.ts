import { CASE_FLOW, VERIFICATION_FLOW, canTransition, type Actor, type CaseRecord, type DriverRecord, type PlatformDataset } from '@gobye/core';
import { addAction, findCase, isOpen, type Result } from '../care/logic';

/**
 * Safety queue rules. The acknowledge target is a PLACEHOLDER for the owner to confirm. The screen shows
 * elapsed time against it ("raised 6 min ago, target 5 min"), never a live countdown or a promise.
 */
export const ACK_TARGET_MIN = 5;

export const isSafetyOpen = (c: Pick<CaseRecord, 'team' | 'status'>) => c.team === 'safety' && isOpen(c.status);

/** Unassigned first, then escalated, then oldest first (it has waited longest). */
export function safetyQueue<T extends Pick<CaseRecord, 'team' | 'status' | 'ownerId' | 'openedAt'>>(cases: readonly T[]): T[] {
  return cases
    .filter(isSafetyOpen)
    .slice()
    .sort((a, b) => Number(!!a.ownerId) - Number(!!b.ownerId) || Number(b.status === 'escalated') - Number(a.status === 'escalated') || a.openedAt - b.openedAt);
}

/** When staff first responded: the first action by a staff member (acknowledge, call, escalate). */
export function firstResponseAt(c: Pick<CaseRecord, 'actions'>): number | undefined {
  return c.actions.filter((a) => a.by.kind === 'staff').reduce<number | undefined>((m, a) => (m === undefined || a.at < m ? a.at : m), undefined);
}

export interface AckState {
  /** Minutes since the alert was raised (or until it was first answered). */
  elapsedMin: number;
  acknowledged: boolean;
  /** True when the first response came, or is still missing, after the target. */
  overTarget: boolean;
}
export function ackState(c: Pick<CaseRecord, 'openedAt' | 'ownerId' | 'actions'>, now: number): AckState {
  const first = firstResponseAt(c);
  const acknowledged = !!c.ownerId;
  const end = acknowledged && first !== undefined ? first : now;
  const elapsedMin = Math.max(0, Math.floor((end - c.openedAt) / 60_000));
  return { elapsedMin, acknowledged, overTarget: (end - c.openedAt) > ACK_TARGET_MIN * 60_000 };
}

export type SafetyAction = 'acknowledge' | 'call' | 'escalate_lead' | 'restrict_driver' | 'emergency' | 'resolve' | 'close' | 'reply';

export function allowedSafetyActions(c: Pick<CaseRecord, 'status' | 'ownerId'>, opts: { canWork: boolean; canRestrict: boolean; meId?: string; driver?: Pick<DriverRecord, 'verification'> }): SafetyAction[] {
  if (!opts.canWork) return [];
  const out: SafetyAction[] = [];
  const open = isOpen(c.status);
  if (open && opts.meId && c.ownerId !== opts.meId) out.push('acknowledge');
  if (open) out.push('call', 'emergency', 'reply');
  if (canTransition(CASE_FLOW, c.status, 'escalated')) out.push('escalate_lead');
  if (open && opts.canRestrict && opts.driver && canTransition(VERIFICATION_FLOW, opts.driver.verification, 'suspended')) out.push('restrict_driver');
  if (canTransition(CASE_FLOW, c.status, 'resolved')) out.push('resolve');
  if (canTransition(CASE_FLOW, c.status, 'closed')) out.push('close');
  return out;
}

/** Why the driver can't be restricted from this case, or undefined. */
export function restrictBlockReason(driver: Pick<DriverRecord, 'verification'> | undefined, canRestrict: boolean): string | undefined {
  if (!canRestrict) return 'Your role can’t restrict drivers';
  if (!driver) return 'No driver is linked to this case';
  if (driver.verification === 'suspended') return 'The driver is already suspended';
  if (!canTransition(VERIFICATION_FLOW, driver.verification, 'suspended')) return 'Only approved drivers can be suspended';
  return undefined;
}

/** Acknowledge: take ownership; a new case moves to in progress. */
export function applyAcknowledge(draft: PlatformDataset, caseId: string, by: Actor & { kind: 'staff' }, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c || c.team !== 'safety') return { ok: false, error: 'Safety case not found' };
  if (!isOpen(c.status)) return { ok: false, error: 'This case is already resolved' };
  if (c.ownerId === by.id) return { ok: false, error: 'You already own this case' };
  const mins = Math.max(0, Math.floor((now - c.openedAt) / 60_000));
  c.ownerId = by.id;
  if (c.status === 'new') c.status = 'in_progress';
  addAction(c, by, now, `Acknowledged by ${by.name}, ${mins} min after the alert`);
  return { ok: true };
}

export function applyRecordAction(draft: PlatformDataset, caseId: string, labelText: string, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return { ok: false, error: 'Case not found' };
  if (!isOpen(c.status)) return { ok: false, error: 'Reopen the case first' };
  addAction(c, by, now, labelText);
  return { ok: true };
}

export function applyEscalateLead(draft: PlatformDataset, caseId: string, reason: string, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return { ok: false, error: 'Case not found' };
  if (!reason.trim()) return { ok: false, error: 'Add a reason for the escalation' };
  if (!canTransition(CASE_FLOW, c.status, 'escalated')) return { ok: false, error: 'This case can’t be escalated from its current status' };
  c.status = 'escalated';
  addAction(c, by, now, `Escalated to safety lead: ${reason.trim()}`);
  return { ok: true };
}

/** Suspend the linked driver pending review (VERIFICATION_FLOW approved to suspended), with a reason. */
export function applyRestrictDriver(draft: PlatformDataset, caseId: string, reason: string, by: Actor, now: number): Result & { from?: string } {
  const c = findCase(draft, caseId);
  if (!c) return { ok: false, error: 'Case not found' };
  if (!reason.trim()) return { ok: false, error: 'Add a reason' };
  const driver = c.links.driverId ? draft.drivers.find((d) => d.id === c.links.driverId) : undefined;
  const block = restrictBlockReason(driver, true);
  if (block) return { ok: false, error: block };
  const from = driver!.verification;
  driver!.verification = 'suspended';
  driver!.online = false;
  addAction(c, by, now, `Driver ${driver!.name} restricted pending review: ${reason.trim()}`);
  return { ok: true, from };
}
