import {
  APPROVAL_RULES,
  CASE_FLOW,
  canTransition,
  formatNaira,
  type Actor,
  type ApprovalRequest,
  type CaseCategory,
  type CasePriority,
  type CaseRecord,
  type CaseStatus,
  type DriverRecord,
  type Kobo,
  type PassengerRecord,
  type PlatformDataset,
  type RefundRecord,
  type TripRecord,
} from '@gobye/core';

/**
 * Pure helpers for the customer care and safety case workspaces. Queue rules, ages, refund validation
 * and the actions allowed per status live here so they can be tested without rendering. The `apply*`
 * functions mutate a draft dataset (they are what `act({ apply })` runs) and return a result.
 */

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

/* ---------- Queue ---------- */

export const PRIORITY_RANK: Record<CasePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
export const PRIORITIES: CasePriority[] = ['urgent', 'high', 'normal', 'low'];
/** Care categories (safety cases belong to the safety queue). */
export const CARE_CATEGORIES: Exclude<CaseCategory, 'safety'>[] = ['payment', 'fare', 'driver_conduct', 'passenger_conduct', 'lost_item', 'app_problem', 'account'];

export const isOpen = (s: CaseStatus) => s !== 'resolved' && s !== 'closed';

/** Highest priority first; within a priority, the oldest case first (it has waited longest). */
export function sortQueue<T extends Pick<CaseRecord, 'priority' | 'openedAt'>>(cases: readonly T[]): T[] {
  return cases.slice().sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.openedAt - b.openedAt);
}

export type QueueTab = 'mine' | 'unassigned' | 'open' | 'done';
export function inTab(c: Pick<CaseRecord, 'status' | 'ownerId'>, tab: QueueTab, meId: string | undefined): boolean {
  switch (tab) {
    case 'mine':
      return !!meId && c.ownerId === meId && isOpen(c.status);
    case 'unassigned':
      return !c.ownerId && isOpen(c.status);
    case 'open':
      return isOpen(c.status);
    case 'done':
      return !isOpen(c.status);
  }
}

/** "Just now", "6 min", "3 h", "2 days": elapsed time, never a countdown. */
export function formatAge(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/**
 * First response targets for care, in minutes, per priority. PLACEHOLDERS for the owner to set; the
 * screen labels them as such. Only unassigned new cases can be over target.
 */
export const CARE_RESPONSE_TARGET_MIN: Record<CasePriority, number> = { urgent: 15, high: 60, normal: 240, low: 1440 };
export function overResponseTarget(c: Pick<CaseRecord, 'status' | 'ownerId' | 'priority' | 'openedAt'>, now: number): boolean {
  if (c.ownerId || c.status !== 'new') return false;
  return now - c.openedAt > CARE_RESPONSE_TARGET_MIN[c.priority] * 60_000;
}

/* ---------- Allowed actions per status ---------- */

export type CaseAction = 'assign_me' | 'assign' | 'priority' | 'in_progress' | 'waiting' | 'escalate' | 'resolve' | 'reopen' | 'close' | 'reply';

export function allowedCaseActions(c: Pick<CaseRecord, 'status' | 'ownerId'>, opts: { canWork: boolean; canAssign: boolean; meId?: string }): CaseAction[] {
  if (!opts.canWork) return [];
  const out: CaseAction[] = [];
  const open = isOpen(c.status);
  if (open && opts.meId && c.ownerId !== opts.meId) out.push('assign_me');
  if (open && opts.canAssign) out.push('assign');
  if (open) out.push('priority', 'reply');
  if (c.status !== 'new' && canTransition(CASE_FLOW, c.status, 'in_progress') && open) out.push('in_progress');
  if (canTransition(CASE_FLOW, c.status, 'waiting')) out.push('waiting');
  if (canTransition(CASE_FLOW, c.status, 'escalated')) out.push('escalate');
  if (canTransition(CASE_FLOW, c.status, 'resolved')) out.push('resolve');
  if (c.status === 'resolved' && canTransition(CASE_FLOW, 'resolved', 'in_progress')) out.push('reopen');
  if (canTransition(CASE_FLOW, c.status, 'closed')) out.push('close');
  return out;
}

/* ---------- Refunds ---------- */

/** Parse a naira amount typed by staff ("1,500" or "1500.50") into integer kobo. */
export function parseNairaInput(input: string): Kobo | null {
  const s = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const k = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(k) ? (k as Kobo) : null;
}

/** Refunds that still hold part of the fare (anything not rejected; a failed refund can be retried). */
export const holdsFare = (r: Pick<RefundRecord, 'status'>) => r.status !== 'rejected';

/** How much of the trip's agreed fare can still be refunded. */
export function refundableKobo(trip: Pick<TripRecord, 'id' | 'agreedFare'>, refunds: readonly Pick<RefundRecord, 'tripId' | 'amount' | 'status'>[]): Kobo {
  const fare = trip.agreedFare ?? 0;
  const used = refunds.filter((r) => r.tripId === trip.id && holdsFare(r)).reduce((s, r) => s + r.amount, 0);
  return Math.max(0, fare - used) as Kobo;
}

export const REFUND_CATEGORIES: CaseCategory[] = ['payment', 'fare'];

/** Why a refund can't be requested from this case right now, or undefined if it can. */
export function refundBlockReason(
  c: Pick<CaseRecord, 'id' | 'category' | 'status'>,
  trip: Pick<TripRecord, 'id' | 'agreedFare' | 'payment'> | undefined,
  refunds: readonly Pick<RefundRecord, 'tripId' | 'caseId' | 'amount' | 'status'>[],
  canRequest: boolean,
): string | undefined {
  if (!canRequest) return 'Your role can’t request refunds';
  if (!REFUND_CATEGORIES.includes(c.category)) return 'Refunds are requested from payment or fare cases';
  if (!isOpen(c.status)) return 'Reopen the case to request a refund';
  if (!trip) return 'Link a trip first';
  if (trip.payment !== 'paid' && trip.payment !== 'partly_refunded') return 'The trip has no confirmed payment to refund';
  if (refunds.some((r) => r.caseId === c.id && r.status === 'requested')) return 'A refund request is already waiting for approval';
  if (refundableKobo(trip, refunds) <= 0) return 'The agreed fare has already been fully refunded';
  return undefined;
}

export function validateRefund(input: { amountText: string; reason: string }, trip: Pick<TripRecord, 'id' | 'agreedFare'>, refunds: readonly Pick<RefundRecord, 'tripId' | 'amount' | 'status'>[]): { ok: true; amount: Kobo } | { ok: false; field: 'amount' | 'reason'; error: string } {
  const amount = parseNairaInput(input.amountText);
  if (amount === null) return { ok: false, field: 'amount', error: 'Enter an amount in naira, for example 1500' };
  if (amount <= 0) return { ok: false, field: 'amount', error: 'Amount must be more than zero' };
  const max = refundableKobo(trip, refunds);
  if (amount > max) return { ok: false, field: 'amount', error: `Can’t exceed ${formatNaira(max)} (agreed fare less earlier refunds)` };
  if (!input.reason.trim()) return { ok: false, field: 'reason', error: 'Add a reason for finance' };
  return { ok: true, amount };
}

/* ---------- Lost items ---------- */

export const LOST_ITEM_STEPS = [
  { key: 'contact_driver', label: 'Lost item: contacted driver' },
  { key: 'arrange_return', label: 'Lost item: return arranged' },
  { key: 'confirm_passenger', label: 'Lost item: confirmed with passenger' },
] as const;
export type LostItemStep = (typeof LOST_ITEM_STEPS)[number]['key'];
export function lostItemDone(actions: readonly { label: string }[]): Record<LostItemStep, boolean> {
  const has = (l: string) => actions.some((a) => a.label === l);
  return { contact_driver: has(LOST_ITEM_STEPS[0].label), arrange_return: has(LOST_ITEM_STEPS[1].label), confirm_passenger: has(LOST_ITEM_STEPS[2].label) };
}

/* ---------- References and search ---------- */

export function nextRef(cases: readonly Pick<CaseRecord, 'ref'>[], prefix: 'C-' | 'S-'): string {
  const max = cases.reduce((m, c) => (c.ref.startsWith(prefix) ? Math.max(m, Number(c.ref.slice(prefix.length)) || 0) : m), prefix === 'C-' ? 2399 : 309);
  return `${prefix}${max + 1}`;
}

export type Person = { type: 'passenger'; rec: PassengerRecord } | { type: 'driver'; rec: DriverRecord };
export function searchPeople(passengers: readonly PassengerRecord[], drivers: readonly DriverRecord[], q: string, limit = 8): Person[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const p: Person[] = passengers.filter((x) => x.name.toLowerCase().includes(s)).map((rec) => ({ type: 'passenger', rec }));
  const d: Person[] = drivers.filter((x) => x.name.toLowerCase().includes(s)).map((rec) => ({ type: 'driver', rec }));
  return [...p, ...d].slice(0, limit);
}

/* ---------- Draft mutations (run inside act({ apply })) ---------- */

let seq = 0;
export const newId = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${(seq++).toString(36)}`;

export function findCase(draft: PlatformDataset, id: string) {
  return draft.cases.find((c) => c.id === id);
}

export function addAction(c: CaseRecord, by: Actor, now: number, label: string) {
  c.actions.push({ at: now, by, label });
}

export function applyMessage(draft: PlatformDataset, caseId: string, channel: 'customer' | 'internal', body: string, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!body.trim()) return fail('Write a message first');
  if (!isOpen(c.status)) return fail('Reopen the case to add messages');
  c.messages.push({ id: newId('msg', now), at: now, channel, author: by, body: body.trim() });
  addAction(c, by, now, channel === 'customer' ? 'Replied to customer' : 'Added internal note');
  return { ok: true };
}

export function applyStatus(draft: PlatformDataset, caseId: string, to: CaseStatus, by: Actor, now: number, label?: string): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!canTransition(CASE_FLOW, c.status, to)) return fail(`Can’t move a case from ${c.status.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}`);
  c.status = to;
  addAction(c, by, now, label ?? `Status set to ${to.replace(/_/g, ' ')}`);
  return { ok: true };
}

/** Assign an owner; a new case moves to in progress at the same time. */
export function applyAssign(draft: PlatformDataset, caseId: string, ownerId: string, by: Actor, now: number, label?: string): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!isOpen(c.status)) return fail('Reopen the case before assigning it');
  const owner = draft.staff.find((s) => s.id === ownerId && s.status === 'active');
  if (!owner) return fail('That staff member isn’t active');
  if (c.ownerId === ownerId) return fail(`Already assigned to ${owner.name}`);
  c.ownerId = ownerId;
  addAction(c, by, now, label ?? `Assigned to ${owner.name}`);
  if (c.status === 'new') c.status = 'in_progress';
  return { ok: true };
}

export function applyPriority(draft: PlatformDataset, caseId: string, priority: CasePriority, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (c.priority === priority) return fail('Priority is unchanged');
  const from = c.priority;
  c.priority = priority;
  addAction(c, by, now, `Priority changed from ${from} to ${priority}`);
  return { ok: true };
}

export type EscalationTeam = 'finance' | 'safety' | 'operations';
export const TEAM_LABEL: Record<EscalationTeam, string> = { finance: 'Finance', safety: 'Safety', operations: 'Operations' };

/** Escalate a care case. An escalation to Safety also opens a linked safety case (urgent, unassigned). */
export function applyEscalate(draft: PlatformDataset, caseId: string, team: EscalationTeam, reason: string, by: Actor, now: number): Result & { safetyRef?: string } {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!reason.trim()) return fail('Add a reason for the escalation');
  if (!canTransition(CASE_FLOW, c.status, 'escalated')) return fail('This case can’t be escalated from its current status');
  c.status = 'escalated';
  let safetyRef: string | undefined;
  if (team === 'safety') {
    safetyRef = nextRef(draft.cases, 'S-');
    draft.cases.push({
      id: newId('saf', now),
      ref: safetyRef,
      team: 'safety',
      category: 'safety',
      priority: 'urgent',
      status: 'new',
      subject: c.subject,
      openedAt: now,
      openedBy: by,
      city: c.city,
      links: { passengerId: c.links.passengerId, driverId: c.links.driverId, tripId: c.links.tripId },
      messages: [{ id: newId('msg', now), at: now, channel: 'internal', author: by, body: `Escalated from care case ${c.ref}: ${reason.trim()}` }],
      actions: [{ at: now, by, label: `Created from care case ${c.ref}` }],
    });
    addAction(c, by, now, `Escalated to Safety as ${safetyRef}: ${reason.trim()}`);
  } else {
    addAction(c, by, now, `Escalated to ${TEAM_LABEL[team]}: ${reason.trim()}`);
  }
  return { ok: true, safetyRef };
}

export function applyResolve(draft: PlatformDataset, caseId: string, summary: string, followUpAt: number | undefined, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!summary.trim()) return fail('Add a resolution summary');
  if (followUpAt !== undefined && followUpAt <= now) return fail('Follow up date must be in the future');
  if (!canTransition(CASE_FLOW, c.status, 'resolved')) return fail('This case can’t be resolved from its current status');
  c.status = 'resolved';
  c.resolution = { at: now, summary: summary.trim(), followUpAt };
  addAction(c, by, now, `Resolved: ${summary.trim()}`);
  return { ok: true };
}

/** Reopen a resolved case: back to in progress; the earlier resolution stays in the action history. */
export function applyReopen(draft: PlatformDataset, caseId: string, reason: string, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (!reason.trim()) return fail('Add a reason for reopening');
  if (c.status !== 'resolved' || !canTransition(CASE_FLOW, 'resolved', 'in_progress')) return fail('Only resolved cases can be reopened');
  c.status = 'in_progress';
  c.resolution = undefined;
  addAction(c, by, now, `Reopened: ${reason.trim()}`);
  return { ok: true };
}

/** Record one lost item checklist step as an action (each step once). */
export function applyLostItemStep(draft: PlatformDataset, caseId: string, step: LostItemStep, by: Actor, now: number): Result {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  if (c.category !== 'lost_item') return fail('Only lost item cases have this checklist');
  if (!isOpen(c.status)) return fail('Reopen the case to update the checklist');
  if (lostItemDone(c.actions)[step]) return fail('Already recorded');
  addAction(c, by, now, LOST_ITEM_STEPS.find((s) => s.key === step)!.label);
  return { ok: true };
}

/** Care requests a refund: a RefundRecord (requested) plus an approval for finance. No money moves here. */
export function applyRefundRequest(
  draft: PlatformDataset,
  caseId: string,
  input: { amountText: string; reason: string; destination: RefundRecord['destination'] },
  by: Actor,
  now: number,
): Result & { refundId?: string } {
  const c = findCase(draft, caseId);
  if (!c) return fail('Case not found');
  const trip = c.links.tripId ? draft.trips.find((t) => t.id === c.links.tripId) : undefined;
  const block = refundBlockReason(c, trip, draft.refunds, true);
  if (block) return fail(block);
  const v = validateRefund(input, trip!, draft.refunds);
  if (!v.ok) return fail(v.error);
  const refundId = newId('ref', now);
  const passengerId = trip!.passengerId;
  draft.refunds.unshift({ id: refundId, tripId: trip!.id, caseId: c.id, passengerId, amount: v.amount, reason: input.reason.trim(), destination: input.destination, status: 'requested', requestedBy: by, requestedAt: now });
  const approval: ApprovalRequest = {
    id: newId('apr', now),
    kind: 'refund',
    title: `Refund ${formatNaira(v.amount)} to ${input.destination === 'wallet' ? 'wallet' : 'original method'} (case ${c.ref})`,
    requestedBy: by,
    requestedAt: now,
    target: { type: 'refund', id: refundId, label: `Refund for trip ${trip!.ref}` },
    amount: v.amount,
    status: 'pending',
    approverRoles: APPROVAL_RULES.refund.approverRoles.slice(),
    note: input.reason.trim(),
  };
  draft.approvals.unshift(approval);
  c.links.refundId = refundId;
  addAction(c, by, now, `Refund of ${formatNaira(v.amount)} requested; waiting for finance approval`);
  return { ok: true, refundId };
}

export interface NewCaseInput {
  person: { type: 'passenger' | 'driver'; id: string };
  category: Exclude<CaseCategory, 'safety'>;
  priority: CasePriority;
  subject: string;
  firstMessage: string;
  tripId?: string;
}

export function validateNewCase(i: Partial<NewCaseInput>): Partial<Record<'person' | 'subject' | 'firstMessage', string>> {
  const e: Partial<Record<'person' | 'subject' | 'firstMessage', string>> = {};
  if (!i.person) e.person = 'Choose a passenger or driver';
  if (!i.subject?.trim()) e.subject = 'Add a short subject';
  else if (i.subject.trim().length > 90) e.subject = 'Keep the subject under 90 characters';
  if (!i.firstMessage?.trim()) e.firstMessage = 'Add what the customer reported';
  return e;
}

export function applyNewCase(draft: PlatformDataset, input: NewCaseInput, by: Actor, now: number): Result & { caseId?: string; ref?: string } {
  const errs = validateNewCase(input);
  const first = Object.values(errs)[0];
  if (first) return fail(first);
  const person = input.person.type === 'passenger' ? draft.passengers.find((p) => p.id === input.person.id) : draft.drivers.find((d) => d.id === input.person.id);
  if (!person) return fail('Person not found');
  const trip = input.tripId ? draft.trips.find((t) => t.id === input.tripId) : undefined;
  if (input.tripId && !trip) return fail('Trip not found');
  const customer: Actor = { kind: input.person.type, id: person.id, name: person.name };
  const ref = nextRef(draft.cases, 'C-');
  const id = newId('cas', now);
  draft.cases.push({
    id,
    ref,
    team: 'care',
    category: input.category,
    priority: input.priority,
    status: 'new',
    subject: input.subject.trim(),
    openedAt: now,
    openedBy: by,
    city: trip?.city ?? person.city,
    links: {
      passengerId: input.person.type === 'passenger' ? person.id : trip?.passengerId,
      driverId: input.person.type === 'driver' ? person.id : trip?.driverId,
      tripId: trip?.id,
    },
    messages: [{ id: newId('msg', now), at: now, channel: 'customer', author: customer, body: input.firstMessage.trim() }],
    actions: [{ at: now, by, label: `Case opened for ${person.name}` }],
  });
  return { ok: true, caseId: id, ref };
}
