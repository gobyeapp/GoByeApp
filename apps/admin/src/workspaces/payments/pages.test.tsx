import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createPlatformDataset, quoteFee, scheduleInForce, type PlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import { applyDecision } from '../approvals/logic';
import Fees from './Fees';
import Health from './Health';
import { formToRule, movementRows, nairaToKobo, percentToBps, ruleToForm } from './model';
import Operations from './Operations';
import PaymentsSetup from './PaymentsSetup';

function mount(Page: ComponentType, staffId: string, data: PlatformDataset = createPlatformDataset()) {
  const s = TEST_STAFF.find((x) => x.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: s.id, name: s.name }} initial={data}>
        <ToastProvider>
          <FilterProvider>
            <MemoryRouter>
              <RecordProvider>
                <Page />
              </RecordProvider>
            </MemoryRouter>
          </FilterProvider>
        </ToastProvider>
      </PlatformProvider>
    </SessionProvider>,
  );
}

/** Visible copy rule: no dashes and no exclamation marks (identifiers such as apr-0001 or GB-FUND-1 are allowed). */
function visibleTextProblems(container: HTMLElement) {
  const isId = (w: string) => /^[(]?(int|apr|fee|run|col|wd|wdr|ref|drv|pas|pax|stf|GB|Q)-[\w-]+/i.test(w) || /^[(]?D-\d{3}/.test(w);
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const w of (n.textContent ?? '').split(/\s+/)) if (/[—–!]/.test(w) || (/[a-z]-[a-z]/i.test(w) && !isId(w))) out.push(w);
  return out;
}

const PAGES: [string, ComponentType][] = [
  ['Payments setup', PaymentsSetup],
  ['Fee configuration', Fees],
  ['Gateway health', Health],
  ['Payment operations', Operations],
];

afterEach(cleanup);

describe('payments pages render', () => {
  for (const staff of ['stf-owner', 'stf-fin', 'stf-dev', 'stf-audit']) {
    for (const [title, Page] of PAGES) {
      it(`${title} as ${staff}`, () => {
        const { container } = mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        expect(visibleTextProblems(container)).toEqual([]);
      });
    }
  }

  it('fees: honest state with no approved schedule and no invented amounts', () => {
    mount(Fees, 'stf-owner');
    expect(screen.getByText(/No fee schedule approved: wallet funding and withdrawals can’t be charged a fee yet/)).toBeTruthy();
    // The customer preview refuses to quote.
    expect(screen.getByText('Fees for this are not approved yet.')).toBeTruthy();
    // Confirmed pricing is shown read only.
    expect(screen.getByText('₦2,000')).toBeTruthy();
    expect(screen.getByText('₦60,000')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    // Only finance can prepare a draft.
    expect((screen.getByRole('button', { name: /New draft/ }) as HTMLButtonElement).disabled).toBe(true);
    // The starting draft holds no amounts: every fee is Not set.
    fireEvent.click(screen.getByText('Version 1'));
    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(4);
  });

  it('operations: gateway health says monitoring is not connected rather than inventing numbers', () => {
    mount(Health, 'stf-dev');
    expect(screen.getByText('Needs monitoring (not connected)')).toBeTruthy();
    cleanup();
    mount(Operations, 'stf-fin');
    expect(screen.getAllByText('Money movement').length).toBeGreaterThan(0);
  });

  it('finance sends a draft for approval; the owner approves it and it is scheduled', async () => {
    const data = createPlatformDataset();
    const draft = data.feeSchedules[0]!;
    draft.effectiveFrom = data.generatedAt + 7 * 86_400_000;
    mount(Fees, 'stf-fin', data);
    fireEvent.click(screen.getByText('Version 1'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    });
    // Before: only the KPI label says it. After: the version row's status pill does too.
    await waitFor(() => expect(screen.queryAllByText('Waiting for approval').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('approval logic: the owner approves a pending fee schedule and it becomes scheduled', () => {
    const d = createPlatformDataset();
    const s = d.feeSchedules[0]!;
    s.status = 'pending_approval';
    s.effectiveFrom = d.generatedAt + 7 * 86_400_000;
    d.approvals.unshift({ id: 'apr-0100', kind: 'fee_schedule', title: 'Approve fee schedule version 1', requestedBy: { kind: 'staff', id: 'stf-fin', name: 'Grace Finance' }, requestedAt: d.generatedAt, target: { type: 'fee_schedule', id: s.id, label: 'Fee schedule version 1' }, status: 'pending', approverRoles: ['owner'] });
    const owner = d.staff.find((x) => x.id === 'stf-owner')!;
    const fin = d.staff.find((x) => x.id === 'stf-fin')!;
    expect(applyDecision(d, 'apr-0100', 'approved', { now: d.generatedAt, actor: { kind: 'staff', id: fin.id, name: fin.name }, staff: fin }).ok).toBe(false);
    expect(applyDecision(d, 'apr-0100', 'approved', { now: d.generatedAt, actor: { kind: 'staff', id: owner.id, name: owner.name }, staff: owner })).toEqual({ ok: true });
    expect(s.status).toBe('scheduled');
    expect(s.approvedBy?.id).toBe('stf-owner');
    // Not in force before its date; in force after.
    expect(scheduleInForce(d.feeSchedules, d.generatedAt)).toBeUndefined();
    expect(scheduleInForce(d.feeSchedules, s.effectiveFrom + 1)?.id).toBe(s.id);
    // Still no quote: every fee in it is Not set.
    expect(quoteFee(d.feeSchedules, 'wallet_funding', 500_000 as never, s.effectiveFrom + 1, { provider: 'paystack' })).toMatchObject({ ok: false, block: 'fee_not_set' });
  });
});

describe('payments model', () => {
  it('converts naira and percent input to kobo and basis points', () => {
    expect(nairaToKobo('1,250.50')).toBe(125_050);
    expect(nairaToKobo('')).toBeNull();
    expect(nairaToKobo('abc')).toBeNaN();
    expect(percentToBps('1.5')).toBe(150);
  });

  it('round trips a rule through the form and reports bad input', () => {
    const d = createPlatformDataset();
    const r = d.feeSchedules[0]!.rules[0]!;
    expect(formToRule(ruleToForm(r)).rule).toEqual(r);
    const f = ruleToForm(r);
    const bad = formToRule({ ...f, gobye: { set: true, fixed: 'x', percent: '', min: '', cap: '' }, max: '' });
    expect(Object.keys(bad.errors).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps gross, provider charge, fee, movement and settlement apart', () => {
    const d = createPlatformDataset();
    const rows = movementRows(d, d.generatedAt);
    const paid = rows.find((r) => r.source === 'collection' && r.status === 'successful')!;
    expect(paid.settlement).toBe(paid.gross - (paid.providerCharge ?? 0));
    expect(paid.gobyeFee).toBe(0);
    const pending = rows.find((r) => r.source === 'collection' && r.status === 'pending');
    if (pending) expect(pending.movement).toBeNull();
    const processing = rows.find((r) => r.source === 'withdrawal' && r.status === 'processing');
    if (processing) expect(processing.safety).toMatch(/Look the transfer up/);
  });
});
