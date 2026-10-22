import type { Result } from '../types';
import { ONBOARDING_STEPS, isStepComplete, nextOnboardingStep, onboardingProgress, type DriverApplication, type OnboardingStepId } from './onboarding';

/**
 * Driver verification after registration (D-049). Staff (or, without the demo relay, a simulated
 * reviewer) run checks; each check can pass, fail, or wait on an outside body (FRSC, NIMC, inspection).
 * A failed check becomes an issue the driver fixes in the matching registration step, then resubmits.
 * These rules drive the driver's dashboard card and the admin review queue.
 */

export type VerificationCheckId = 'identity' | 'licence' | 'vehicle' | 'documents' | 'background';
export type CheckState = 'queued' | 'checking' | 'waiting' | 'passed' | 'failed';

export interface VerificationCheck {
  id: VerificationCheckId;
  state: CheckState;
  /** Why a check is waiting (an outside delay), or a short staff note. */
  note?: string;
  updatedAt: number;
}

export const CHECKS: readonly { id: VerificationCheckId; label: string; step: OnboardingStepId | null }[] = [
  { id: 'identity', label: 'Identity (NIN or ID)', step: 'identity' },
  { id: 'licence', label: 'Driver’s licence', step: 'licence' },
  { id: 'vehicle', label: 'Vehicle details', step: 'vehicle' },
  { id: 'documents', label: 'Vehicle papers', step: 'documents' },
  { id: 'background', label: 'Background check', step: null },
];

export const CHECK_LABEL: Record<VerificationCheckId, string> = Object.fromEntries(CHECKS.map((c) => [c.id, c.label])) as Record<VerificationCheckId, string>;

/** Outside delays staff can record against a waiting check. */
export const WAITING_REASONS: readonly { id: string; check: VerificationCheckId; text: string }[] = [
  { id: 'nimc_slow', check: 'identity', text: 'Waiting for NIMC to confirm your NIN. Their service is slow right now.' },
  { id: 'frsc_pending', check: 'licence', text: 'Waiting for the FRSC licence check. This usually takes up to 24 hours.' },
  { id: 'inspection_slot', check: 'vehicle', text: 'Waiting for a vehicle inspection slot near you. We’ll message you a time.' },
  { id: 'insurer_confirm', check: 'documents', text: 'Waiting for your insurer to confirm the policy is active.' },
  { id: 'background_running', check: 'background', text: 'Background check in progress. It usually takes 1 to 2 working days.' },
];

export type IssueCode =
  | 'licence_unreadable'
  | 'licence_expired'
  | 'licence_name_mismatch'
  | 'identity_mismatch'
  | 'selfie_unclear'
  | 'vehicle_too_old'
  | 'plate_mismatch'
  | 'registration_unreadable'
  | 'insurance_expired'
  | 'roadworthiness_missing';

/** What staff can flag, the step the driver fixes it in, and how to fix it (driver-facing copy). */
export const ISSUES: Record<IssueCode, { step: OnboardingStepId; check: VerificationCheckId; title: string; fix: string }> = {
  licence_unreadable: { step: 'licence', check: 'licence', title: 'Licence photo is hard to read', fix: 'Retake it flat, in good light, with all four corners in the frame.' },
  licence_expired: { step: 'licence', check: 'licence', title: 'Your licence has expired', fix: 'Renew it with the FRSC, then add the new expiry date and a photo.' },
  licence_name_mismatch: { step: 'licence', check: 'licence', title: 'Name doesn’t match your licence', fix: 'Use your name exactly as it appears on your licence.' },
  identity_mismatch: { step: 'identity', check: 'identity', title: 'ID number doesn’t match', fix: 'Check the number matches your NIN slip or ID card.' },
  selfie_unclear: { step: 'identity', check: 'identity', title: 'Selfie isn’t clear', fix: 'Retake it facing the camera, no hat or sunglasses, in good light.' },
  vehicle_too_old: { step: 'vehicle', check: 'vehicle', title: 'Vehicle is older than allowed', fix: 'Add a vehicle that’s 2008 or newer.' },
  plate_mismatch: { step: 'vehicle', check: 'vehicle', title: 'Plate doesn’t match your papers', fix: 'Enter the plate exactly as it is on your vehicle licence.' },
  registration_unreadable: { step: 'documents', check: 'documents', title: 'Vehicle licence photo is unclear', fix: 'Retake the photo so every date and name can be read.' },
  insurance_expired: { step: 'documents', check: 'documents', title: 'Insurance certificate has expired', fix: 'Upload a current certificate (third party at minimum).' },
  roadworthiness_missing: { step: 'documents', check: 'documents', title: 'Roadworthiness certificate is unclear', fix: 'Upload a clear photo of a valid certificate.' },
};

export interface VerificationIssue {
  id: string;
  code: IssueCode;
  /** Optional staff note shown to the driver under the fix. */
  note?: string;
  raisedAt: number;
  resolvedAt?: number;
}

export const queuedChecks = (now: number): VerificationCheck[] => CHECKS.map((c) => ({ id: c.id, state: 'queued', updatedAt: now }));

export const openIssues = (app: Pick<DriverApplication, 'issues'>): VerificationIssue[] => (app.issues ?? []).filter((i) => !i.resolvedAt);

/**
 * The preview reviewer when no demo relay is connected: checks run one after another, the licence
 * check waits on the FRSC for a while (so the dashboard shows a real-world delay), then approval.
 * Pure: the same elapsed time always gives the same state.
 */
export const SIM_REVIEW_MS = 24_000;
export function simulatedReview(submittedAt: number, now: number): { checks: VerificationCheck[]; approved: boolean } {
  const t = now - submittedAt;
  const at = (ms: number) => submittedAt + ms;
  const state = (start: number, done: number, wait?: [number, number]): CheckState =>
    t >= done ? 'passed' : wait && t >= wait[0] && t < wait[1] ? 'waiting' : t >= start ? 'checking' : 'queued';
  const plan: Record<VerificationCheckId, { start: number; done: number; wait?: [number, number]; note?: string }> = {
    identity: { start: 0, done: 4_000 },
    licence: { start: 2_000, done: 18_000, wait: [5_000, 16_000], note: WAITING_REASONS.find((w) => w.id === 'frsc_pending')!.text },
    vehicle: { start: 4_000, done: 9_000 },
    documents: { start: 6_000, done: 12_000 },
    background: { start: 9_000, done: 21_000, wait: [12_000, 20_000], note: WAITING_REASONS.find((w) => w.id === 'background_running')!.text },
  };
  const checks = CHECKS.map(({ id }) => {
    const p = plan[id];
    const s = state(p.start, p.done, p.wait);
    const changed = s === 'passed' ? p.done : s === 'waiting' ? p.wait![0] : s === 'checking' ? p.start : 0;
    return { id, state: s, note: s === 'waiting' ? p.note : undefined, updatedAt: at(changed) };
  });
  return { checks, approved: t >= SIM_REVIEW_MS };
}

/** Staff ask for changes: the listed issues open and their checks fail; other checks keep their state. */
export function requestChanges(app: DriverApplication, issues: { code: IssueCode; note?: string }[], now: number, reviewNote?: string): Result<DriverApplication> {
  if (app.status !== 'pending_review') return { ok: false, error: 'Only an application in review can be sent back.' };
  if (issues.length === 0) return { ok: false, error: 'Choose at least one thing to fix.' };
  const raised: VerificationIssue[] = issues.map((x, i) => ({ id: `iss-${now.toString(36)}-${i}`, code: x.code, note: x.note?.trim() || undefined, raisedAt: now }));
  const failing = new Set(raised.map((r) => ISSUES[r.code].check));
  const checks = (app.checks ?? queuedChecks(now)).map((c) => (failing.has(c.id) ? { ...c, state: 'failed' as const, note: undefined, updatedAt: now } : c));
  return { ok: true, value: { ...app, status: 'changes_requested', issues: [...(app.issues ?? []), ...raised], checks, reviewNote: reviewNote?.trim() || undefined } };
}

/** Saving a registration step marks the open issues for that step as fixed. */
export function resolveIssuesForStep(app: DriverApplication, step: OnboardingStepId, now: number): DriverApplication {
  if (!openIssues(app).some((i) => ISSUES[i.code].step === step)) return app;
  return { ...app, issues: (app.issues ?? []).map((i) => (!i.resolvedAt && ISSUES[i.code].step === step ? { ...i, resolvedAt: now } : i)) };
}

/** Send a fixed application back for review: failed checks go back in the queue. */
export function resubmitApplication(app: DriverApplication, now: number): Result<DriverApplication> {
  if (app.status !== 'changes_requested') return { ok: false, error: 'Nothing to resubmit.' };
  if (openIssues(app).length) return { ok: false, error: 'Fix the items we flagged first.' };
  if (nextOnboardingStep(app)) return { ok: false, error: 'Finish every step before you submit.' };
  const checks = (app.checks ?? queuedChecks(now)).map((c) => (c.state === 'failed' ? { ...c, state: 'queued' as const, updatedAt: now } : c));
  return { ok: true, value: { ...app, status: 'pending_review', submittedAt: now, checks, reviewNote: undefined } };
}

export type VerificationStage = 'register' | 'review' | 'changes' | 'approved' | 'rejected';

export interface VerificationSummary {
  stage: VerificationStage;
  title: string;
  body: string;
  /** Register → Review → Drive, for the stepper on the card. */
  steps: { id: 'register' | 'review' | 'drive'; label: string; state: 'done' | 'current' | 'todo' | 'blocked' }[];
  /** Registration steps still to complete, in order. */
  todo: OnboardingStepId[];
  /** Flagged items the driver must fix (with the step to open). */
  issues: (VerificationIssue & { step: OnboardingStepId; title: string; fix: string })[];
  /** Checks held up by an outside body, with the reason. */
  waiting: { id: VerificationCheckId; label: string; reason: string; since: number }[];
  checks: { id: VerificationCheckId; label: string; state: CheckState }[];
  progress: { done: number; total: number };
  /** What the main button on the card should do. */
  action: { label: string; target: OnboardingStepId | 'submit' | 'resubmit' } | null;
}

const STEP_TITLE: Record<OnboardingStepId, string> = { personal: 'About you', licence: 'Driver’s licence', identity: 'Identity check', vehicle: 'Your vehicle', documents: 'Vehicle papers' };
export const onboardingStepTitle = (s: OnboardingStepId) => STEP_TITLE[s];

/** Everything the driver's dashboard card shows, from the application alone. */
export function verificationSummary(app: DriverApplication): VerificationSummary {
  const progress = onboardingProgress(app);
  const todo = ONBOARDING_STEPS.filter((s) => !isStepComplete(app, s));
  const issues = openIssues(app).map((i) => ({ ...i, ...ISSUES[i.code], step: ISSUES[i.code].step }));
  const checks = (app.checks ?? []).map((c) => ({ id: c.id, label: CHECK_LABEL[c.id], state: c.state }));
  const waiting = (app.checks ?? []).filter((c) => c.state === 'waiting').map((c) => ({ id: c.id, label: CHECK_LABEL[c.id], reason: c.note ?? 'Waiting on an outside check.', since: c.updatedAt }));
  const steps = (reg: 'done' | 'current', review: VerificationSummary['steps'][number]['state'], drive: VerificationSummary['steps'][number]['state']): VerificationSummary['steps'] => [
    { id: 'register', label: 'Register', state: reg },
    { id: 'review', label: 'Review', state: review },
    { id: 'drive', label: 'Drive', state: drive },
  ];

  if (app.status === 'approved') {
    return { stage: 'approved', title: 'You’re approved', body: 'Get an access pass and go online whenever you’re ready.', steps: steps('done', 'done', 'current'), todo: [], issues: [], waiting: [], checks, progress, action: null };
  }
  if (app.status === 'rejected') {
    return {
      stage: 'rejected',
      title: 'We couldn’t approve your account',
      body: app.rejectionReason ?? app.reviewNote ?? 'Contact driver support to find out more.',
      steps: steps('done', 'blocked', 'todo'),
      todo: [],
      issues,
      waiting: [],
      checks,
      progress,
      action: null,
    };
  }
  if (app.status === 'changes_requested') {
    const first = issues[0];
    return {
      stage: 'changes',
      title: issues.length ? `Fix ${issues.length === 1 ? '1 thing' : `${issues.length} things`} to continue` : 'Ready to send back',
      body: issues.length ? app.reviewNote ?? 'Our team checked your documents and needs a few changes.' : 'You’ve fixed everything we flagged. Send it back for review.',
      steps: steps('done', 'blocked', 'todo'),
      todo,
      issues,
      waiting,
      checks,
      progress,
      action: first ? { label: `Fix: ${first.title}`, target: first.step } : todo[0] ? { label: `Continue: ${STEP_TITLE[todo[0]]}`, target: todo[0] } : { label: 'Send back for review', target: 'resubmit' },
    };
  }
  if (app.status === 'pending_review') {
    const passed = checks.filter((c) => c.state === 'passed').length;
    return {
      stage: 'review',
      title: waiting.length ? 'Review is taking longer' : 'We’re checking your documents',
      body: waiting.length
        ? `${passed} of ${CHECKS.length} checks done. ${waiting.length === 1 ? 'One check is' : `${waiting.length} checks are`} waiting on an outside office.`
        : `${passed} of ${CHECKS.length} checks done. We’ll let you know as soon as you’re approved.`,
      steps: steps('done', 'current', 'todo'),
      todo: [],
      issues: [],
      waiting,
      checks,
      progress,
      action: null,
    };
  }
  // not_started / in_progress
  const next = todo[0];
  return {
    stage: 'register',
    title: next ? `${progress.done} of ${progress.total} steps done` : 'Ready to submit',
    body: next ? 'Finish registering so we can check your documents. Your progress is saved.' : 'Everything’s in. Submit it for review.',
    steps: steps('current', 'todo', 'todo'),
    todo,
    issues: [],
    waiting: [],
    checks,
    progress,
    action: next ? { label: progress.done === 0 ? `Start: ${STEP_TITLE[next]}` : `Next: ${STEP_TITLE[next]}`, target: next } : { label: 'Submit for review', target: 'submit' },
  };
}
