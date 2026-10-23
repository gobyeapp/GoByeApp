import { VERIFICATION_FLOW, canTransition, type DocumentKind, type DriverDocument, type DriverRecord, type DriverVerification, type PassengerRecord } from '@gobye/core';

const DAY = 86_400_000;

/** Documents a driver must have accepted and in date before approval. The photo is not a blocker. */
export const REQUIRED_DOCS: readonly DocumentKind[] = ['licence', 'vehicle_registration', 'insurance', 'roadworthiness', 'id_card'];

export const DOC_LABELS: Record<DocumentKind, string> = {
  licence: 'Driver’s licence',
  vehicle_registration: 'Vehicle registration',
  insurance: 'Insurance',
  roadworthiness: 'Roadworthiness',
  id_card: 'ID card',
  photo: 'Profile photo',
};

export const isExpired = (doc: DriverDocument, now: number) => doc.status === 'expired' || (doc.expiresAt !== undefined && doc.expiresAt <= now);

/** Effective status: a document past its expiry date counts as expired whatever it was. */
export const docStatus = (doc: DriverDocument, now: number): DriverDocument['status'] => (isExpired(doc, now) ? 'expired' : doc.status);

export interface Readiness {
  ready: boolean;
  blockers: string[];
}

export function documentReadiness(driver: Pick<DriverRecord, 'documents'>, now: number): Readiness {
  const blockers: string[] = [];
  for (const kind of REQUIRED_DOCS) {
    const doc = driver.documents.find((x) => x.kind === kind);
    const st = doc ? docStatus(doc, now) : 'missing';
    if (st !== 'accepted') blockers.push(`${DOC_LABELS[kind]}: ${st === 'submitted' ? 'not reviewed yet' : st}`);
  }
  return { ready: blockers.length === 0, blockers };
}

export const REVIEW_STATES: readonly DriverVerification[] = ['applied', 'documents_pending', 'in_review'];

export interface ExpiryRow {
  driverId: string;
  kind: DocumentKind;
  expiresAt: number;
  expired: boolean;
  daysLeft: number;
}

/** Documents expired or expiring within `days`, soonest first. Only drivers who are or were on the road. */
export function expiringDocuments(drivers: readonly DriverRecord[], now: number, days = 30): ExpiryRow[] {
  const rows: ExpiryRow[] = [];
  for (const d of drivers) {
    if (d.verification === 'rejected') continue;
    for (const doc of d.documents) {
      if (doc.expiresAt === undefined || doc.expiresAt - now > days * DAY) continue;
      rows.push({ driverId: d.id, kind: doc.kind, expiresAt: doc.expiresAt, expired: doc.expiresAt <= now, daysLeft: Math.ceil((doc.expiresAt - now) / DAY) });
    }
  }
  return rows.sort((a, b) => a.expiresAt - b.expiresAt);
}

export type VerificationAction = 'start_review' | 'approve' | 'request_documents' | 'reject' | 'suspend' | 'reinstate';
export const ACTION_TARGET: Record<VerificationAction, DriverVerification> = {
  start_review: 'in_review',
  approve: 'approved',
  request_documents: 'documents_pending',
  reject: 'rejected',
  suspend: 'suspended',
  reinstate: 'approved',
};

/** Actions the workflow allows from the current state (reinstate = approve from suspended). */
export function verificationActions(from: DriverVerification): VerificationAction[] {
  const all: VerificationAction[] = ['start_review', 'approve', 'request_documents', 'reject', 'suspend', 'reinstate'];
  return all.filter((a) => {
    if (a === 'approve' && from === 'suspended') return false;
    if (a === 'reinstate' && from !== 'suspended') return false;
    return canTransition(VERIFICATION_FLOW, from, ACTION_TARGET[a]);
  });
}

type Result = { ok: true } | { ok: false; error: string };

/** Move a driver through VERIFICATION_FLOW; approval and reinstatement need every required document. */
export function applyVerification(driver: DriverRecord | undefined, action: VerificationAction, now: number, reason?: string): Result {
  if (!driver) return { ok: false, error: 'Driver not found' };
  const to = ACTION_TARGET[action];
  if (!verificationActions(driver.verification).includes(action)) return { ok: false, error: `Can’t move from ${driver.verification.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}` };
  if (to === 'approved') {
    const r = documentReadiness(driver, now);
    if (!r.ready) return { ok: false, error: `Can’t approve yet. ${r.blockers.join('; ')}` };
  }
  if ((action === 'reject' || action === 'suspend') && !reason?.trim()) return { ok: false, error: 'Add a reason' };
  driver.verification = to;
  if (to === 'rejected') driver.rejectionReason = reason!.trim();
  if (to === 'approved') driver.rejectionReason = undefined;
  if (to === 'suspended' || to === 'rejected') driver.online = false;
  return { ok: true };
}

export function reviewDocument(driver: DriverRecord | undefined, kind: DocumentKind, decision: 'accepted' | 'rejected', now: number, note?: string): Result {
  if (!driver) return { ok: false, error: 'Driver not found' };
  const doc = driver.documents.find((x) => x.kind === kind);
  if (!doc) return { ok: false, error: 'Document not found' };
  if (decision === 'accepted') {
    if (doc.status === 'missing') return { ok: false, error: 'Nothing uploaded yet' };
    if (isExpired(doc, now)) return { ok: false, error: 'This document has expired. Ask the driver for a current one' };
    doc.status = 'accepted';
    doc.note = undefined;
  } else {
    if (!note?.trim()) return { ok: false, error: 'Add a note so the driver knows what to fix' };
    if (doc.status === 'missing') return { ok: false, error: 'Nothing uploaded yet' };
    doc.status = 'rejected';
    doc.note = note.trim();
  }
  return { ok: true };
}

export function accessStatus(driver: Pick<DriverRecord, 'access'>, now: number): { active: boolean; label: string } {
  if (!driver.access) return { active: false, label: 'No package' };
  const pkg = driver.access.packageId === 'daily' ? 'Daily' : 'Monthly';
  return driver.access.expiresAt > now ? { active: true, label: `${pkg} access active` } : { active: false, label: `${pkg} access expired` };
}

/* ---------- Passengers ---------- */
const digits = (s: string) => s.replace(/\D/g, '');

/** Search by name or id; phone matching only when the viewer may see contact details. */
export function searchPassengers(passengers: readonly PassengerRecord[], q: string, canContact: boolean): PassengerRecord[] {
  const s = q.trim().toLowerCase();
  if (!s) return passengers.slice();
  const ds = digits(s);
  return passengers.filter((p) => p.name.toLowerCase().includes(s) || p.id.toLowerCase().includes(s) || (canContact && ds.length >= 3 && digits(p.phone).includes(ds)));
}

export function restrictPassenger(p: PassengerRecord | undefined, input: { reason: string; until?: number; by: string }, now: number): Result {
  if (!p) return { ok: false, error: 'Passenger not found' };
  if (p.status !== 'active') return { ok: false, error: `Passenger is ${p.status}` };
  if (!input.reason.trim()) return { ok: false, error: 'Add a reason' };
  if (input.until !== undefined && input.until <= now) return { ok: false, error: 'The end date must be in the future' };
  p.status = 'restricted';
  p.restriction = { reason: input.reason.trim(), until: input.until, by: input.by };
  return { ok: true };
}

export function liftRestriction(p: PassengerRecord | undefined): Result {
  if (!p) return { ok: false, error: 'Passenger not found' };
  if (p.status !== 'restricted') return { ok: false, error: 'Passenger is not restricted' };
  p.status = 'active';
  p.restriction = undefined;
  return { ok: true };
}

/* ---------- Driver subscription state (for filters) ---------- */
export type SubscriptionState = 'active_daily' | 'active_monthly' | 'expired' | 'none';
export const SUBSCRIPTION_STATE_LABEL: Record<SubscriptionState, string> = {
  active_daily: 'Active daily pass',
  active_monthly: 'Active monthly pass',
  expired: 'Pass expired',
  none: 'No pass bought',
};
export function subscriptionState(driver: Pick<DriverRecord, 'access'>, now: number): SubscriptionState {
  if (!driver.access) return 'none';
  if (driver.access.expiresAt <= now) return 'expired';
  return driver.access.packageId === 'daily' ? 'active_daily' : 'active_monthly';
}

/** Vehicle category label for the admin (one category at launch). */
export const categoryLabel = (c: string) => (c === 'go' ? 'GoBye Car' : c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' '));
