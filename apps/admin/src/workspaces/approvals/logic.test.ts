import { describe, expect, it } from 'vitest';
import { createPlatformDataset, withdrawable, type Actor, type PlatformDataset, type StaffMember } from '@gobye/core';
import { applyDecision, decideBlockReason, failingChecks, requestedRoles, roleRequestNote } from './logic';

const fresh = () => createPlatformDataset();
const staffOf = (d: PlatformDataset, id: string) => d.staff.find((s) => s.id === id)!;
const actorOf = (s: StaffMember): Actor => ({ kind: 'staff', id: s.id, name: s.name });
const decide = (d: PlatformDataset, id: string, who: string, decision: 'approved' | 'rejected', reason?: string, now = d.generatedAt) =>
  applyDecision(d, id, decision, { now, actor: actorOf(staffOf(d, who)), staff: staffOf(d, who), reason });

describe('decideBlockReason', () => {
  it('stops the requester deciding their own request', () => {
    const d = fresh();
    const req = { ...d.approvals[0]!, requestedBy: actorOf(staffOf(d, 'stf-owner')) };
    expect(decideBlockReason(req, staffOf(d, 'stf-owner'))).toBe('You requested this, so someone else must decide');
  });
  it('names the roles that can decide', () => {
    const d = fresh();
    expect(decideBlockReason(d.approvals[0]!, staffOf(d, 'stf-care'))).toMatch(/Company owner/);
  });
});

describe('applyDecision', () => {
  it('config publish in the future becomes scheduled', () => {
    const d = fresh();
    expect(decide(d, 'apr-0001', 'stf-owner', 'approved')).toEqual({ ok: true });
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-3')!.status).toBe('scheduled');
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-2')!.status).toBe('active');
    expect(d.approvals.find((a) => a.id === 'apr-0001')!.status).toBe('approved');
  });
  it('config publish already effective becomes active and supersedes the old one', () => {
    const d = fresh();
    expect(decide(d, 'apr-0001', 'stf-owner', 'approved', undefined, d.generatedAt + 6 * 86_400_000)).toEqual({ ok: true });
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-3')!.status).toBe('active');
    expect(d.configVersions.find((v) => v.id === 'cfg-fares-2')!.status).toBe('superseded');
  });
  it('refund approval and rejection', () => {
    const a = fresh();
    expect(decide(a, 'apr-0002', 'stf-fin', 'approved').ok).toBe(true);
    expect(a.refunds.find((r) => r.id === 'ref-0001')!.status).toBe('approved');
    const b = fresh();
    expect(decide(b, 'apr-0002', 'stf-fin', 'rejected').ok).toBe(false);
    expect(decide(b, 'apr-0002', 'stf-fin', 'rejected', 'Duplicate request').ok).toBe(true);
    expect(b.refunds.find((r) => r.id === 'ref-0001')!.status).toBe('rejected');
  });
  it('announcement with a future schedule becomes scheduled; rejection returns it to draft', () => {
    const a = fresh();
    expect(decide(a, 'apr-0003', 'stf-owner', 'approved').ok).toBe(true);
    const ann = a.announcements.find((x) => x.id === 'ann-0003')!;
    expect(ann.status).toBe('scheduled');
    expect(ann.approvedBy?.kind).toBe('staff');
    const b = fresh();
    expect(decide(b, 'apr-0003', 'stf-admin', 'rejected', 'Wrong audience').ok).toBe(true);
    expect(b.announcements.find((x) => x.id === 'ann-0003')!.status).toBe('draft');
  });
  it('payments activation is blocked while live checks fail', () => {
    const d = fresh();
    const req = d.approvals.find((x) => x.id === 'apr-0004')!;
    expect(failingChecks(d, req)!.length).toBeGreaterThan(0);
    const r = decide(d, 'apr-0004', 'stf-owner', 'approved');
    expect(r.ok).toBe(false);
    expect(d.approvals.find((x) => x.id === 'apr-0004')!.status).toBe('pending');
    expect(d.integrations.find((x) => x.id === 'int-pay-live')!.state).toBe('prototype');
  });
  it('withdrawal approval moves to processing; rejection releases the reserve', () => {
    const a = fresh();
    const req = a.approvals.find((x) => x.kind === 'withdrawal');
    if (!req) return;
    expect(decide(a, req.id, 'stf-fin', 'approved').ok).toBe(true);
    const w = a.withdrawals.find((x) => x.id === req.target.id)!;
    expect(w.status).toBe('processing');
    expect(w.history.at(-1)!.status).toBe('processing');

    const b = fresh();
    const wb = b.withdrawals.find((x) => x.id === req.target.id)!;
    const before = withdrawable(b.ledger, wb.driverId);
    expect(decide(b, req.id, 'stf-fin', 'rejected', 'Name mismatch').ok).toBe(true);
    expect(wb.status).toBe('rejected');
    expect(withdrawable(b.ledger, wb.driverId)).toBe(before + wb.amount);
  });
  it('a decided request cannot be decided again', () => {
    const d = fresh();
    decide(d, 'apr-0002', 'stf-fin', 'approved');
    expect(decide(d, 'apr-0002', 'stf-fin2', 'approved').ok).toBe(false);
  });
  it('staff role approval adds the requested roles', () => {
    const d = fresh();
    d.approvals.push({ id: 'apr-x', kind: 'staff_role', title: 'Grant finance', requestedBy: actorOf(staffOf(d, 'stf-admin')), requestedAt: d.generatedAt, target: { type: 'staff', id: 'stf-care', label: 'Ruth Care' }, status: 'pending', approverRoles: ['owner'], note: roleRequestNote(['finance']) });
    expect(requestedRoles(d.approvals.at(-1)!)).toEqual(['finance']);
    expect(decide(d, 'apr-x', 'stf-owner', 'approved').ok).toBe(true);
    expect(staffOf(d, 'stf-care').roles).toEqual(['care', 'finance']);
  });
});
