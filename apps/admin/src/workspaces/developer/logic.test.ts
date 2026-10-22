import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type IntegrationRecord } from '@gobye/core';
import {
  NO_CREDENTIALS,
  RETRY_ACTION,
  applyTestResults,
  buildEventStream,
  canApplyTransition,
  cleanText,
  credentialHintFor,
  filterEvents,
  hintTail,
  maskSecret,
  nextApprovalId,
  revealedCount,
  simulateConnectionTest,
  transitionOptions,
  validateSecret,
  webhookUrl,
} from './logic';

const base = (x: Partial<IntegrationRecord>): IntegrationRecord => ({
  id: 'int-x',
  area: 'email',
  provider: 'Example mail',
  environment: 'test',
  state: 'prototype',
  owner: 'Dev',
  capabilities: [],
  checks: [],
  failures: [],
  dependsOn: [],
  usedBy: [],
  ...x,
});

describe('masking', () => {
  it('never reveals more than 4 characters', () => {
    for (const v of ['', 'a', 'abcd', 'abcdefgh', 'sk_test_0123456789abcdef', 'x'.repeat(200)]) {
      const m = maskSecret(v);
      expect(revealedCount(m)).toBeLessThanOrEqual(4);
      expect(m.startsWith('••••')).toBe(true);
    }
    expect(maskSecret('sk_test_0123456789abcdef')).toBe('••••cdef');
  });
  it('reveals less of short values', () => {
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('abcdefgh')).toBe('••••gh');
  });
  it('keeps only the non secret Paystack prefix plus 4 characters', () => {
    const h = credentialHintFor('sk_live_supersecretvalue9z8y');
    expect(h).toBe('sk_live_••••9z8y');
    expect(h).not.toContain('supersecret');
    expect(hintTail(h)).toBe('••••9z8y');
    expect(hintTail(undefined)).toBe('None');
  });
  it('validates Paystack keys per environment', () => {
    const pay = { area: 'payments' as const, provider: 'Paystack' };
    expect(validateSecret('sk_live_0123456789abcdef', { ...pay, environment: 'test' })).toMatch(/test secret key/);
    expect(validateSecret('sk_test_0123456789abcdef', { ...pay, environment: 'test' })).toBeNull();
    expect(validateSecret('short', { ...pay, environment: 'live' })).toMatch(/too short/);
  });
});

describe('connection tests', () => {
  it('fails every check with no credentials', () => {
    const r = simulateConnectionTest(base({}), 1000);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((c) => !c.passed && c.detail === NO_CREDENTIALS)).toBe(true);
  });
  it('passes technical checks with credentials but never owner steps', () => {
    const live = base({ area: 'payments', provider: 'Paystack', environment: 'live', credentialHint: 'sk_live_••••1234', checks: [{ name: 'Business verification complete', passed: false }, { name: 'Live webhook configured', passed: false }] });
    const none = simulateConnectionTest({ ...live, credentialHint: undefined }, 5);
    expect(none.find((c) => c.name === 'Live webhook configured')!.detail).toBe(NO_CREDENTIALS);
    expect(none.find((c) => c.name === 'Business verification complete')!.detail).toMatch(/owner/);
    const r = simulateConnectionTest(live, 5);
    expect(r.find((c) => c.name === 'Live webhook configured')!.passed).toBe(true);
    expect(r.find((c) => c.name === 'Business verification complete')!.passed).toBe(false);
  });
  it('records a failure and degrades a live integration when a test fails', () => {
    const x = base({ state: 'live', environment: 'live' });
    const ok = applyTestResults(x, [{ name: 'A', passed: false, detail: 'nope' }], 9);
    expect(ok).toBe(false);
    expect(x.state).toBe('degraded');
    expect(x.failures[0]!.resolved).toBe(false);
  });
});

describe('transitions', () => {
  it('needs credentials and a provider before configured', () => {
    expect(transitionOptions(base({ provider: 'Not chosen' }))[0]!.blocked).toMatch(/provider/);
    expect(transitionOptions(base({}))[0]!.blocked).toMatch(/credential/);
    expect(transitionOptions(base({ credentialHint: '••••1234' }))[0]!.blocked).toBeUndefined();
  });
  it('marks tested only when every check passes', () => {
    const x = base({ state: 'configured', checks: [{ name: 'A', passed: true }, { name: 'B', passed: false }] });
    expect(transitionOptions(x).find((o) => o.to === 'tested')!.blocked).toBeTruthy();
    expect(canApplyTransition(x, 'tested').ok).toBe(false);
    x.checks[1]!.passed = true;
    expect(canApplyTransition(x, 'tested').ok).toBe(true);
  });
  it('blocks live unless all checks pass, and payments always go through approval', () => {
    const pay = base({ area: 'payments', provider: 'Paystack', environment: 'live', state: 'tested', checks: [{ name: 'A', passed: false }] });
    expect(transitionOptions(pay).find((o) => o.to === 'live')!.blocked).toMatch(/check/);
    pay.checks[0]!.passed = true;
    const opt = transitionOptions(pay).find((o) => o.to === 'live')!;
    expect(opt.viaApproval).toBe(true);
    expect(canApplyTransition(pay, 'live').ok).toBe(false);
    const testEnv = base({ state: 'tested', checks: [{ name: 'A', passed: true }] });
    expect(canApplyTransition(testEnv, 'live').ok).toBe(false);
    const liveEmail = base({ environment: 'live', state: 'tested', checks: [{ name: 'A', passed: true }] });
    expect(canApplyTransition(liveEmail, 'live').ok).toBe(true);
  });
  it('offers no database transitions (controlled deployment)', () => {
    expect(transitionOptions(base({ area: 'database' }))).toEqual([]);
  });
  it('rejects transitions outside CONNECTION_FLOW', () => {
    expect(canApplyTransition(base({ credentialHint: '••••1' }), 'live').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('numbers approvals in apr-0004 style', () => {
    expect(nextApprovalId([{ id: 'apr-0004' }, { id: 'apr-0002' }])).toBe('apr-0005');
    expect(nextApprovalId([])).toBe('apr-0001');
  });
  it('builds test and live webhook addresses on the example domain', () => {
    expect(webhookUrl({ provider: 'Paystack', environment: 'live' })).toBe('https://api.example.test/webhooks/paystack');
    expect(webhookUrl({ provider: 'Paystack', environment: 'test' })).toBe('https://api.example.test/webhooks/paystack/test');
  });
  it('removes dashes from dataset text', () => {
    expect(cleanText('Mismatch — fixed by rotation')).toBe('Mismatch: fixed by rotation');
    expect(cleanText('Google Maps Platform (proposed, D-025)')).toBe('Google Maps Platform (proposed)');
  });
});

describe('event stream', () => {
  const d = createPlatformDataset();
  const events = buildEventStream(d);

  it('flags duplicate webhook deliveries', () => {
    const dupInData = d.collections.flatMap((c) => c.events).filter((e) => e.duplicate).length;
    expect(events.filter((e) => e.outcome === 'duplicate').length).toBe(dupInData);
    const repeat = buildEventStream({ ...d, collections: [{ ...d.collections[0]!, events: [{ at: 1, event: 'charge.success' }, { at: 2, event: 'charge.success' }] }] });
    expect(repeat.filter((e) => e.source === 'collection').map((e) => e.outcome).sort()).toEqual(['duplicate', 'processed']);
  });
  it('includes payout provider events and announcement failures', () => {
    expect(events.some((e) => e.source === 'payout' && e.type.startsWith('transfer.'))).toBe(true);
    const sms = events.find((e) => e.id === 'ann-0002:sms')!;
    expect(sms.outcome).toBe('failed');
  });
  it('reads retries back from the audit trail', () => {
    const retried = buildEventStream({ ...d, audit: [{ id: 'a', at: 5, actor: { kind: 'system', name: 'Test' }, action: RETRY_ACTION, target: { type: 'event', id: 'ann-0002:sms', label: 'x' }, summary: 'x' }, ...d.audit] });
    const sms = retried.find((e) => e.id === 'ann-0002:sms')!;
    expect(sms.outcome).toBe('processed');
    expect(sms.retried?.by).toBe('Test');
  });
  it('filters by source, outcome and reference', () => {
    const ref = d.collections.find((c) => c.events.length)!.reference;
    expect(filterEvents(events, { source: 'all', outcome: 'all', query: ref }).every((e) => e.reference.includes(ref))).toBe(true);
    expect(filterEvents(events, { source: 'announcement', outcome: 'failed', query: '' }).every((e) => e.source === 'announcement')).toBe(true);
  });
  it('never shows dashes in event details', () => {
    expect(events.every((e) => !/[—–]/.test(e.detail))).toBe(true);
  });
});
