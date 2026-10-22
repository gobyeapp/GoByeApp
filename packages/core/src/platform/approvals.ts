import type { Kobo } from '../types';
import type { StaffMember, StaffRole } from './permissions';
import { postJournal, reverseJournal } from './ledger';
import type { Actor, ApprovalKind, ApprovalRequest, LedgerEntry } from './types';

/**
 * Four-eyes rules: who must approve which sensitive change. The requester can never approve their
 * own request, even if they hold an approving role. Thresholds are placeholders for the owner to set.
 */
export const APPROVAL_RULES: Record<ApprovalKind, { approverRoles: StaffRole[]; thresholdKobo?: Kobo; note: string }> = {
  config_publish: { approverRoles: ['owner'], note: 'Fares, packages, categories, referrals and cancellation rules' },
  refund: { approverRoles: ['finance', 'owner'], thresholdKobo: 0 as Kobo, note: 'Every refund needs finance approval' },
  ledger_adjustment: { approverRoles: ['owner'], note: 'Manual corrections to any balance' },
  withdrawal: { approverRoles: ['finance'], thresholdKobo: 10_000_000 as Kobo, note: 'Driver withdrawals at or above ₦100,000 need review' },
  payments_activation: { approverRoles: ['owner'], note: 'Switching a payment provider to live, or changing settlement destination' },
  announcement: { approverRoles: ['owner', 'admin'], note: 'Messages to all users, or any SMS campaign' },
  staff_role: { approverRoles: ['owner'], note: 'Granting owner, finance or developer access' },
};

export function needsApproval(kind: ApprovalKind, amount?: Kobo): boolean {
  const rule = APPROVAL_RULES[kind];
  if (rule.thresholdKobo === undefined || amount === undefined) return true;
  return amount >= rule.thresholdKobo;
}

export function canDecide(req: Pick<ApprovalRequest, 'approverRoles' | 'requestedBy' | 'status'>, staff: Pick<StaffMember, 'id' | 'roles' | 'status'>): boolean {
  if (req.status !== 'pending' || staff.status !== 'active') return false;
  if (req.requestedBy.kind === 'staff' && req.requestedBy.id === staff.id) return false;
  return staff.roles.some((r) => req.approverRoles.includes(r));
}

/**
 * Post an approved ledger correction. Uses the approval id as the reference, so approving twice (or a
 * retried request) never posts twice. Returns the new entries, or an error that leaves the ledger alone.
 */
export function postApprovedAdjustment(
  entries: readonly LedgerEntry[],
  req: Pick<ApprovalRequest, 'id' | 'kind' | 'adjustment' | 'note' | 'title'>,
  ctx: { by: Actor; now: number },
): { ok: true; entries: LedgerEntry[] } | { ok: false; error: string } {
  if (req.kind !== 'ledger_adjustment' || !req.adjustment) return { ok: false, error: 'This request has no posting details. Ask finance to send it again.' };
  const reason = req.note?.trim() || req.title;
  const a = req.adjustment;
  if (a.reverseJournalId) {
    if (entries.some((e) => e.reference === `adj:${req.id}`)) return { ok: true, entries: entries.slice() };
    const r = reverseJournal(entries, a.reverseJournalId, { by: ctx.by, now: ctx.now, reason });
    if (!r.ok) return { ok: false, error: r.error === 'already_reversed' ? 'That journal was already reversed' : 'Journal not found' };
    // Tag the reversal with the approval so a repeat approval is recognised.
    const tagged = r.posted.map((e) => ({ ...e, reference: `adj:${req.id}` }));
    return { ok: true, entries: [...tagged, ...entries] };
  }
  const r = postJournal(entries, { lines: a.lines ?? [], kind: 'adjustment', description: a.description, by: ctx.by, now: ctx.now, reason, reference: `adj:${req.id}` });
  if (!r.ok) return { ok: false, error: r.error === 'unbalanced' ? 'The correction doesn’t balance' : 'Nothing to post' };
  return { ok: true, entries: r.entries };
}
