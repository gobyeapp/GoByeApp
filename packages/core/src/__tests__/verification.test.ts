import { ISSUES, emptyApplication, requestChanges, resolveIssuesForStep, resubmitApplication, simulatedReview, submitApplication, verificationSummary, type DriverApplication } from '../index';

const now = Date.UTC(2026, 9, 22, 12);
const complete: DriverApplication = {
  personal: { firstName: 'Tunde', lastName: 'Bakare', city: 'Lagos' },
  licence: { number: 'ABC123456789', expiry: '2029-01-01', photoUri: 'p' },
  identity: { type: 'nin', number: '12345678901', selfieUri: 's' },
  vehicle: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2016, colour: 'Silver', plate: 'KJA123AB' },
  documents: { registration: 'r', insurance: 'i', roadworthiness: 'w' },
  status: 'in_progress',
};

describe('driver verification', () => {
  it('a new driver sees how far registration is and what to do next', () => {
    const s = verificationSummary({ ...emptyApplication, personal: complete.personal });
    expect(s.stage).toBe('register');
    expect(s.title).toBe('1 of 5 steps done');
    expect(s.todo).toEqual(['licence', 'identity', 'vehicle', 'documents']);
    expect(s.action).toEqual({ label: 'Next: Driver’s licence', target: 'licence' });
    expect(verificationSummary(complete).action).toEqual({ label: 'Submit for review', target: 'submit' });
  });

  it('the simulated review runs checks, waits on the FRSC for a while, then approves', () => {
    expect(simulatedReview(now, now + 1_000).checks.find((c) => c.id === 'identity')!.state).toBe('checking');
    const mid = simulatedReview(now, now + 8_000);
    const licence = mid.checks.find((c) => c.id === 'licence')!;
    expect(licence.state).toBe('waiting');
    expect(licence.note).toContain('FRSC');
    expect(mid.approved).toBe(false);
    const s = verificationSummary({ ...complete, status: 'pending_review', checks: mid.checks });
    expect(s.title).toBe('Review is taking longer');
    expect(s.waiting.map((w) => w.id)).toEqual(['licence']);
    const end = simulatedReview(now, now + 30_000);
    expect(end.approved).toBe(true);
    expect(end.checks.every((c) => c.state === 'passed')).toBe(true);
  });

  it('staff ask for changes; fixing the step clears it; then it goes back to review', () => {
    const submitted = submitApplication(complete, now);
    if (!submitted.ok) throw new Error(submitted.error);
    const r = requestChanges(submitted.value, [{ code: 'insurance_expired', note: 'Expired in June' }, { code: 'selfie_unclear' }], now + 1, 'Two quick fixes.');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.status).toBe('changes_requested');
    const s = verificationSummary(r.value);
    expect(s.stage).toBe('changes');
    expect(s.title).toBe('Fix 2 things to continue');
    expect(s.issues.map((i) => i.step)).toEqual(['documents', 'identity']);
    expect(s.action).toEqual({ label: `Fix: ${ISSUES.insurance_expired.title}`, target: 'documents' });
    expect(resubmitApplication(r.value, now + 2)).toEqual({ ok: false, error: 'Fix the items we flagged first.' });
    expect(submitApplication(r.value, now + 2).ok).toBe(false);
    let fixed = resolveIssuesForStep(r.value, 'documents', now + 3);
    fixed = resolveIssuesForStep(fixed, 'identity', now + 4);
    expect(verificationSummary(fixed).action).toEqual({ label: 'Send back for review', target: 'resubmit' });
    const again = resubmitApplication(fixed, now + 5);
    if (!again.ok) throw new Error(again.error);
    expect(again.value.status).toBe('pending_review');
    expect(again.value.checks!.filter((c) => c.state === 'failed')).toEqual([]);
  });

  it('only an application in review can be sent back, with at least one item', () => {
    expect(requestChanges(complete, [{ code: 'plate_mismatch' }], now).ok).toBe(false);
    expect(requestChanges({ ...complete, status: 'pending_review' }, [], now)).toEqual({ ok: false, error: 'Choose at least one thing to fix.' });
  });
});
