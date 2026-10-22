import {
  ANNOUNCEMENT_FLOW,
  CONNECTION_FLOW,
  REFUND_FLOW,
  ROLE_LABELS,
  WITHDRAWAL_FLOW,
  canDecide,
  canGoLive,
  canTransition,
  postApprovedAdjustment,
  releaseWithdrawal,
  type Actor,
  type ApprovalRequest,
  type PlatformDataset,
  type StaffMember,
  type StaffRole,
} from '@gobye/core';

/**
 * Approval decisions (four eyes). Approving applies the effect on the target record; rejecting leaves
 * the target unapplied (and releases reserved money for withdrawals). Pure: mutates the draft passed
 * in and returns a result, so `act()` keeps the old data when a decision is refused.
 */
export type Result = { ok: true } | { ok: false; error: string };
export type Decision = 'approved' | 'rejected';

const ROLE_NOTE = /^Requested roles: (.+)$/;

/** Staff role requests carry the roles in the note: "Requested roles: finance, developer". */
export function requestedRoles(req: Pick<ApprovalRequest, 'kind' | 'note'>): StaffRole[] {
  if (req.kind !== 'staff_role' || !req.note) return [];
  const m = ROLE_NOTE.exec(req.note);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is StaffRole => s in ROLE_LABELS);
}

export const roleRequestNote = (roles: StaffRole[]) => `Requested roles: ${roles.join(', ')}`;

/** Why the viewer can't decide, or null if they can. */
export function decideBlockReason(req: ApprovalRequest, staff: Pick<StaffMember, 'id' | 'roles' | 'status'>): string | null {
  if (req.status !== 'pending') return 'Already decided';
  if (req.requestedBy.kind === 'staff' && req.requestedBy.id === staff.id) return 'You requested this, so someone else must decide';
  if (!canDecide(req, staff)) return `Needs ${req.approverRoles.map((r) => ROLE_LABELS[r]).join(' or ')}`;
  return null;
}

/** For payments activation: the live checks that have not passed (empty list = ready). */
export function failingChecks(d: PlatformDataset, req: ApprovalRequest): string[] | null {
  if (req.kind !== 'payments_activation') return null;
  const i = d.integrations.find((x) => x.id === req.target.id);
  if (!i) return ['Integration not found'];
  if (!i.checks.length) return ['No connection checks recorded yet'];
  return i.checks.filter((c) => !c.passed).map((c) => c.name);
}

export function applyDecision(
  draft: PlatformDataset,
  approvalId: string,
  decision: Decision,
  ctx: { now: number; actor: Actor; staff: Pick<StaffMember, 'id' | 'roles' | 'status'>; reason?: string },
): Result {
  const req = draft.approvals.find((a) => a.id === approvalId);
  if (!req) return { ok: false, error: 'Approval request not found' };
  const blocked = decideBlockReason(req, ctx.staff);
  if (blocked) return { ok: false, error: blocked };
  if (decision === 'rejected' && !ctx.reason?.trim()) return { ok: false, error: 'Add a reason to reject' };

  const effect = decision === 'approved' ? approveEffect(draft, req, ctx) : rejectEffect(draft, req, ctx);
  if (!effect.ok) return effect;
  req.status = decision;
  req.decidedBy = ctx.actor;
  req.decidedAt = ctx.now;
  return { ok: true };
}

function approveEffect(draft: PlatformDataset, req: ApprovalRequest, ctx: { now: number; actor: Actor }): Result {
  switch (req.kind) {
    case 'config_publish': {
      const v = draft.configVersions.find((x) => x.id === req.target.id);
      if (!v) return { ok: false, error: 'Configuration version not found' };
      if (v.status !== 'pending_approval' && v.status !== 'draft') return { ok: false, error: `This version is ${v.status.replace(/_/g, ' ')}, not waiting for approval` };
      v.approvedBy = ctx.actor;
      if (v.effectiveFrom <= ctx.now) {
        for (const o of draft.configVersions) if (o.key === v.key && o.id !== v.id && o.status === 'active') o.status = 'superseded';
        v.status = 'active';
      } else {
        v.status = 'scheduled';
      }
      return { ok: true };
    }
    case 'refund': {
      const r = draft.refunds.find((x) => x.id === req.target.id);
      if (!r) return { ok: false, error: 'Refund not found' };
      if (!canTransition(REFUND_FLOW, r.status, 'approved')) return { ok: false, error: `Refund is ${r.status} and can’t be approved` };
      r.status = 'approved';
      r.approvedBy = ctx.actor;
      return { ok: true };
    }
    case 'announcement': {
      const a = draft.announcements.find((x) => x.id === req.target.id);
      if (!a) return { ok: false, error: 'Announcement not found' };
      const to = a.scheduledFor && a.scheduledFor > ctx.now ? 'scheduled' : 'sending';
      if (!canTransition(ANNOUNCEMENT_FLOW, a.status, to)) return { ok: false, error: `Announcement is ${a.status.replace(/_/g, ' ')} and can’t be approved` };
      a.status = to;
      a.approvedBy = ctx.actor;
      return { ok: true };
    }
    case 'withdrawal': {
      const w = draft.withdrawals.find((x) => x.id === req.target.id);
      if (!w) return { ok: false, error: 'Withdrawal not found' };
      if (!canTransition(WITHDRAWAL_FLOW, w.status, 'processing')) return { ok: false, error: `Withdrawal is ${w.status.replace(/_/g, ' ')} and can’t be approved` };
      w.status = 'processing';
      w.history.push({ at: ctx.now, status: 'processing', by: ctx.actor, note: 'Approved in review; transfer submitted (simulated)' });
      return { ok: true };
    }
    case 'payments_activation': {
      const i = draft.integrations.find((x) => x.id === req.target.id);
      if (!i) return { ok: false, error: 'Integration not found' };
      if (!canGoLive(i.checks)) {
        const failing = i.checks.filter((c) => !c.passed).length;
        return { ok: false, error: i.checks.length ? `Can’t approve yet: ${failing} of ${i.checks.length} live checks haven’t passed` : 'Can’t approve yet: no connection checks recorded' };
      }
      if (!canTransition(CONNECTION_FLOW, i.state, 'live')) return { ok: false, error: `Can’t go live from ${i.state}: it must be tested first` };
      i.state = 'live';
      return { ok: true };
    }
    case 'staff_role': {
      const s = draft.staff.find((x) => x.id === req.target.id);
      const roles = requestedRoles(req);
      if (s && roles.length) s.roles = [...new Set([...s.roles, ...roles])];
      return { ok: true };
    }
    case 'ledger_adjustment': {
      // Post exactly what finance asked for, as a traceable adjustment or reversal (never a balance edit).
      const res = postApprovedAdjustment(draft.ledger, req, { by: ctx.actor, now: ctx.now });
      if (!res.ok) return res;
      draft.ledger = res.entries;
      return { ok: true };
    }
  }
}

function rejectEffect(draft: PlatformDataset, req: ApprovalRequest, ctx: { now: number; actor: Actor; reason?: string }): Result {
  const reason = ctx.reason?.trim() ?? '';
  switch (req.kind) {
    case 'config_publish': {
      const v = draft.configVersions.find((x) => x.id === req.target.id);
      if (v && (v.status === 'pending_approval' || v.status === 'draft')) v.status = 'rejected';
      return { ok: true };
    }
    case 'refund': {
      const r = draft.refunds.find((x) => x.id === req.target.id);
      if (r) {
        if (!canTransition(REFUND_FLOW, r.status, 'rejected')) return { ok: false, error: `Refund is ${r.status} and can’t be rejected` };
        r.status = 'rejected';
      }
      return { ok: true };
    }
    case 'announcement': {
      // Announcements have no rejected status: they return to draft so the author can change them.
      const a = draft.announcements.find((x) => x.id === req.target.id);
      if (a && canTransition(ANNOUNCEMENT_FLOW, a.status, 'draft')) a.status = 'draft';
      return { ok: true };
    }
    case 'withdrawal': {
      const w = draft.withdrawals.find((x) => x.id === req.target.id);
      if (!w) return { ok: false, error: 'Withdrawal not found' };
      if (!canTransition(WITHDRAWAL_FLOW, w.status, 'rejected')) return { ok: false, error: `Withdrawal is ${w.status.replace(/_/g, ' ')} and can’t be rejected` };
      const res = releaseWithdrawal(draft.ledger, { driverId: w.driverId, withdrawalId: w.id, amount: w.amount, now: ctx.now, by: ctx.actor, reason });
      if (!res.ok) return { ok: false, error: 'Couldn’t release the reserved earnings' };
      draft.ledger = res.entries;
      w.status = 'rejected';
      w.reviewNote = reason;
      w.history.push({ at: ctx.now, status: 'rejected', by: ctx.actor, note: reason });
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** One line on what approving will change, shown before the decision. */
export function approvalEffectText(req: ApprovalRequest): string {
  switch (req.kind) {
    case 'config_publish':
      return 'The version becomes scheduled, or active now if its effective date has passed. Existing bookings keep their terms.';
    case 'refund':
      return 'The refund moves to approved; finance then processes it and the ledger records the money.';
    case 'announcement':
      return 'The announcement is scheduled, or starts sending if it has no schedule.';
    case 'withdrawal':
      return 'The transfer is submitted (simulated). Submitted is not paid: the provider’s final event completes it.';
    case 'payments_activation':
      return 'The provider switches to live, only if every live check has passed.';
    case 'staff_role':
      return 'The requested roles are added to the staff member.';
    case 'ledger_adjustment':
      return req.adjustment?.reverseJournalId ? 'A reversal journal posts against the original. Nothing is edited.' : 'An adjustment journal posts exactly the lines shown, with this reason. Nothing is edited.';
  }
}
