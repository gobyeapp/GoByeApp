import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type ApprovalRequest } from '@gobye/core';
import { revealedCount } from '../developer/logic';
import {
  DEFAULT_SETTLEMENT,
  liveGate,
  maskAccount,
  parseSettlementRequest,
  paymentIntegrations,
  providerExposure,
  providerKey,
  readinessSteps,
  settlementRequestNote,
  settlementRequestTitle,
  settlementState,
  setupProblems,
  splitCapabilities,
  validateSettlement,
} from './logic';

const d = createPlatformDataset();
const { test, live } = paymentIntegrations(d.integrations);

describe('payments readiness', () => {
  it('finds the Paystack test and live configurations', () => {
    expect(test?.id).toBe('int-pay-test');
    expect(live?.id).toBe('int-pay-live');
  });
  it('blocks live unless every live check passes and the record is tested', () => {
    expect(liveGate(live).allowed).toBe(false);
    expect(liveGate(live).reason).toMatch(/3 of 3/);
    expect(liveGate(undefined).allowed).toBe(false);
    const passing = { ...live!, checks: live!.checks.map((c) => ({ ...c, passed: true })) };
    expect(liveGate(passing).allowed).toBe(false); // still prototype
    expect(liveGate({ ...passing, state: 'tested' }).allowed).toBe(true);
  });
  it('builds five steps per environment; test mode skips business steps', () => {
    const t = readinessSteps(test, 'test');
    expect(t.map((s) => s.label)).toEqual(['Business verification', 'Settlement account', 'Webhooks', 'Checks passed', 'Live']);
    expect(t[0]!.status).toBe('not_needed');
    expect(t[2]!.status).toBe('done');
    const l = readinessSteps(live, 'live');
    expect(l[0]!.status).toBe('blocked');
    expect(l[4]!.status).toBe('todo');
  });
  it('lists failing checks as owner to dos', () => {
    const p = setupProblems([live, test]);
    expect(p.length).toBe(3);
    expect(p[0]!.waitingOn).toBe('Owner');
    expect(p.map((x) => x.text)).toContain('Business verification complete: waiting on owner (CAC documents)');
  });
  it('splits capabilities into collections and payouts', () => {
    const c = splitCapabilities(test!.capabilities);
    expect(c.collection).toContain('Bank transfer collection');
    expect(c.payout).toContain('Transfers (payouts)');
    expect(c.other).toContain('Refunds');
  });
});

describe('provider switch exposure', () => {
  it('counts in flight records by provider', () => {
    expect(providerKey('Paystack (test)')).toBe('paystack');
    const e = providerExposure(d, 'paystack');
    expect(e.pendingCollections).toBe(d.collections.filter((c) => c.status === 'pending').length);
    expect(e.processingWithdrawals).toBe(d.withdrawals.filter((w) => w.status === 'processing').length);
    expect(providerExposure(d, 'flutterwave')).toEqual({ provider: 'flutterwave', pendingCollections: 0, processingWithdrawals: 0, openRefunds: 0 });
  });
});

describe('settlement destination', () => {
  it('masks the account number to 4 digits', () => {
    const m = maskAccount('0123456789');
    expect(m).toBe('••••6789');
    expect(revealedCount(m)).toBeLessThanOrEqual(4);
  });
  it('validates the form', () => {
    expect(validateSettlement({ bankName: '', accountNumber: '12', accountName: '' })).toHaveProperty('accountNumber');
    expect(validateSettlement({ bankName: 'Example Bank (test)', accountNumber: '0123456789', accountName: 'GOBYE LTD' })).toEqual({});
  });
  it('round trips a change request and applies only when approved', () => {
    const dest = { bankName: 'Sample Microfinance (test)', accountMasked: '••••6789', accountName: 'GOBYE LTD' };
    const req: ApprovalRequest = { id: 'apr-0009', kind: 'payments_activation', title: settlementRequestTitle(dest), note: settlementRequestNote(dest), requestedBy: { kind: 'system', name: 'x' }, requestedAt: 1, target: { type: 'integration', id: 'int-pay-live', label: 'x' }, status: 'pending', approverRoles: ['owner'] };
    expect(parseSettlementRequest(req)).toEqual(dest);
    expect(settlementState([req]).current).toEqual(DEFAULT_SETTLEMENT);
    expect(settlementState([req]).pending?.dest).toEqual(dest);
    expect(settlementState([{ ...req, status: 'approved', decidedAt: 2 }]).current).toEqual(dest);
    // The live switch request (apr-0004) is not a settlement request.
    expect(settlementState(d.approvals).pending).toBeUndefined();
  });
});
