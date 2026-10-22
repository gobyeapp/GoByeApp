import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type Actor } from '@gobye/core';
import { ACK_TARGET_MIN, ackState, allowedSafetyActions, applyAcknowledge, applyEscalateLead, applyRecordAction, applyRestrictDriver, firstResponseAt, restrictBlockReason, safetyQueue } from './logic';

const MIN = 60_000;
const safety: Actor & { kind: 'staff' } = { kind: 'staff', id: 'stf-safety', name: 'Daniel Safety' };
const sys: Actor = { kind: 'system', name: 'Safety alert' };

describe('safety queue', () => {
  it('shows only open safety cases: unassigned first, then escalated, then oldest', () => {
    const rows = [
      { id: 'a', team: 'safety', status: 'in_progress', ownerId: 'x', openedAt: 1 },
      { id: 'b', team: 'safety', status: 'new', ownerId: undefined, openedAt: 50 },
      { id: 'c', team: 'safety', status: 'escalated', ownerId: 'x', openedAt: 40 },
      { id: 'd', team: 'safety', status: 'resolved', ownerId: 'x', openedAt: 0 },
      { id: 'e', team: 'care', status: 'new', ownerId: undefined, openedAt: 0 },
      { id: 'f', team: 'safety', status: 'new', ownerId: undefined, openedAt: 10 },
    ] as const;
    expect(safetyQueue(rows).map((r) => r.id)).toEqual(['f', 'b', 'c', 'a']);
  });

  it('measures elapsed time to acknowledgement against the target', () => {
    const raised = { openedAt: 0, ownerId: undefined, actions: [{ at: 0, by: sys, label: 'Case created' }] };
    expect(ackState(raised, 6 * MIN)).toEqual({ elapsedMin: 6, acknowledged: false, overTarget: true });
    expect(ackState(raised, 3 * MIN)).toEqual({ elapsedMin: 3, acknowledged: false, overTarget: false });
    const answered = { openedAt: 0, ownerId: 'stf-safety', actions: [...raised.actions, { at: 4 * MIN, by: safety, label: 'Called passenger' }] };
    expect(firstResponseAt(answered)).toBe(4 * MIN);
    // Stops counting once acknowledged, however late "now" is.
    expect(ackState(answered, 90 * MIN)).toEqual({ elapsedMin: 4, acknowledged: true, overTarget: false });
    expect(ACK_TARGET_MIN).toBe(5);
  });

  it('the test data has one unacknowledged alert raised 6 minutes ago', () => {
    const d = createPlatformDataset();
    const q = safetyQueue(d.cases);
    expect(q[0]).toMatchObject({ status: 'new', ownerId: undefined });
    expect(ackState(q[0]!, d.generatedAt)).toMatchObject({ elapsedMin: 6, overTarget: true });
  });
});

describe('safety actions', () => {
  it('offers actions by status and permission', () => {
    const approved = { verification: 'approved' as const };
    const a = allowedSafetyActions({ status: 'new', ownerId: undefined }, { canWork: true, canRestrict: true, meId: 'me', driver: approved });
    expect(a).toEqual(expect.arrayContaining(['acknowledge', 'call', 'emergency', 'escalate_lead', 'restrict_driver', 'resolve']));
    expect(a).not.toContain('close');
    expect(allowedSafetyActions({ status: 'escalated', ownerId: 'me' }, { canWork: true, canRestrict: true, meId: 'me', driver: approved })).not.toContain('escalate_lead');
    expect(allowedSafetyActions({ status: 'resolved', ownerId: 'me' }, { canWork: true, canRestrict: true, meId: 'me' })).toEqual(['close']);
    expect(allowedSafetyActions({ status: 'new' }, { canWork: false, canRestrict: false })).toEqual([]);
  });

  it('explains why a driver cannot be restricted', () => {
    expect(restrictBlockReason({ verification: 'approved' }, false)).toMatch(/role/);
    expect(restrictBlockReason(undefined, true)).toMatch(/No driver/);
    expect(restrictBlockReason({ verification: 'suspended' }, true)).toMatch(/already/);
    expect(restrictBlockReason({ verification: 'in_review' }, true)).toMatch(/Only approved/);
    expect(restrictBlockReason({ verification: 'approved' }, true)).toBeUndefined();
  });

  it('acknowledge takes ownership and moves a new case to in progress', () => {
    const d = createPlatformDataset();
    const c = d.cases.find((x) => x.team === 'safety' && x.status === 'new')!;
    expect(applyAcknowledge(d, c.id, safety, d.generatedAt).ok).toBe(true);
    expect(c).toMatchObject({ ownerId: 'stf-safety', status: 'in_progress' });
    expect(c.actions.at(-1)!.label).toBe('Acknowledged by Daniel Safety, 6 min after the alert');
    expect(applyAcknowledge(d, c.id, safety, d.generatedAt).ok).toBe(false);
  });

  it('escalation needs a reason and follows CASE_FLOW', () => {
    const d = createPlatformDataset();
    const c = d.cases.find((x) => x.team === 'safety' && x.status === 'new')!;
    expect(applyEscalateLead(d, c.id, ' ', safety, d.generatedAt).ok).toBe(false);
    expect(applyEscalateLead(d, c.id, 'Passenger not answering', safety, d.generatedAt).ok).toBe(true);
    expect(c.status).toBe('escalated');
    expect(applyEscalateLead(d, c.id, 'Again', safety, d.generatedAt).ok).toBe(false);
  });

  it('restricting suspends an approved driver via VERIFICATION_FLOW and records it on the case', () => {
    const d = createPlatformDataset();
    const c = d.cases.find((x) => x.team === 'safety' && x.status === 'new')!;
    const driver = d.drivers.find((x) => x.id === c.links.driverId)!;
    driver.verification = 'approved';
    expect(applyRestrictDriver(d, c.id, '', safety, d.generatedAt).ok).toBe(false);
    const r = applyRestrictDriver(d, c.id, 'Pending review of SOS', safety, d.generatedAt);
    expect(r).toMatchObject({ ok: true, from: 'approved' });
    expect(driver.verification).toBe('suspended');
    expect(driver.online).toBe(false);
    expect(applyRestrictDriver(d, c.id, 'Again', safety, d.generatedAt).ok).toBe(false);
  });

  it('records simulated calls on open cases only', () => {
    const d = createPlatformDataset();
    const open = d.cases.find((x) => x.team === 'safety' && x.status === 'new')!;
    const done = d.cases.find((x) => x.team === 'safety' && x.status === 'resolved')!;
    expect(applyRecordAction(d, open.id, 'Called passenger (simulated, no call placed)', safety, d.generatedAt).ok).toBe(true);
    expect(applyRecordAction(d, done.id, 'Called passenger', safety, d.generatedAt).ok).toBe(false);
  });
});
