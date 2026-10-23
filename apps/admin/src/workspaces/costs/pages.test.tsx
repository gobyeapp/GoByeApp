import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { can as canDo, createPlatformDataset, monthKey, type Actor, type PlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import MoneyOverview from '@/workspaces/finance/MoneyOverview';
import { applyDecision } from '@/workspaces/approvals/logic';
import BreakEven from './BreakEven';
import Budgets from './Budgets';
import CostDashboard from './CostDashboard';
import Expenses from './Expenses';
import Vendors from './Vendors';
import { applyExpenseAction, captureExpense, operatingSummary, setBudget } from './logic';

function mount(Page: ComponentType, staffId: string, data = createPlatformDataset()) {
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

const PAGES: [string, ComponentType][] = [
  ['Money overview', MoneyOverview],
  ['Cost dashboard', CostDashboard],
  ['Expenses', Expenses],
  ['Vendors', Vendors],
  ['Budgets', Budgets],
  ['Break-even', BreakEven],
];

afterEach(cleanup);

describe('money overview and costs pages render', () => {
  for (const staff of ['stf-owner', 'stf-fin', 'stf-dev', 'stf-audit']) {
    for (const [title, Page] of PAGES) {
      if (title === 'Money overview' && staff === 'stf-dev') continue; // developers have no finance access
      it(`${title} as ${staff}`, () => {
        mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/!/);
        // No commission revenue anywhere: GoBye takes 0%.
        expect(document.body.textContent).not.toMatch(/commission revenue/i);
      });
    }
  }

  it('shows honest empty states while no expenses are recorded', () => {
    mount(CostDashboard, 'stf-fin');
    expect(screen.getByText('No costs recorded yet')).toBeTruthy();
    expect(screen.getAllByText('No budget set').length).toBeGreaterThan(0);
    cleanup();
    mount(BreakEven, 'stf-fin');
    expect(screen.getByText(/No operating costs recorded/)).toBeTruthy();
  });

  it('money overview keeps fee revenue apart and at zero without a fee schedule', () => {
    mount(MoneyOverview, 'stf-fin');
    expect(screen.getByText('Fee revenue')).toBeTruthy();
    expect(screen.getByText('No fee schedule approved yet')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('record expense is disabled for the auditor', () => {
    mount(Expenses, 'stf-audit');
    const btn = screen.getAllByRole('button', { name: /Record an expense/ })[0]!;
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});

const actor = (id: string): Actor => {
  const s = TEST_STAFF.find((x) => x.id === id)!;
  return { kind: 'staff', id: s.id, name: s.name };
};
const canOf = (id: string) => (p: Parameters<typeof canDo>[1]) => canDo(TEST_STAFF.find((x) => x.id === id)!, p);

describe('expense approvals', () => {
  const base = (d: PlatformDataset) => ({ vendorId: d.vendors[0]!.id, description: 'Pro plan', currency: 'NGN' as const, month: monthKey(d.generatedAt), recurring: false });

  it('below the threshold: a different finance person approves; the creator cannot', () => {
    const d = createPlatformDataset();
    const r = captureExpense(d, { ...base(d), amountMinor: 30_000 }, { now: d.generatedAt, actor: actor('stf-fin') });
    expect(r.ok).toBe(true);
    const id = d.expenses[0]!.id;
    expect(d.approvals.some((a) => a.kind === 'expense')).toBe(false);
    expect(applyExpenseAction(d, id, 'approve', { now: d.generatedAt, actor: actor('stf-fin'), can: canOf('stf-fin') })).toMatchObject({ ok: false });
    expect(applyExpenseAction(d, id, 'approve', { now: d.generatedAt, actor: actor('stf-fin2'), can: canOf('stf-fin2') })).toEqual({ ok: true });
    expect(d.expenses[0]!.status).toBe('approved');
    expect(operatingSummary(d, d.expenses[0]!.month).operating).toBe(3_000_000);
  });

  it('at or above the threshold: an owner approval request is created and the owner approves it', () => {
    const d = createPlatformDataset();
    captureExpense(d, { ...base(d), amountMinor: 80_000 }, { now: d.generatedAt, actor: actor('stf-fin') });
    const e = d.expenses[0]!;
    expect(applyExpenseAction(d, e.id, 'approve', { now: d.generatedAt, actor: actor('stf-fin2'), can: canOf('stf-fin2') })).toMatchObject({ ok: false });
    const req = d.approvals.find((a) => a.kind === 'expense' && a.target.id === e.id)!;
    expect(req.status).toBe('pending');
    const r = applyDecision(d, req.id, 'approved', { now: d.generatedAt, actor: actor('stf-owner'), staff: TEST_STAFF.find((x) => x.id === 'stf-owner')! });
    expect(r.ok).toBe(true);
    expect(d.expenses[0]!.status).toBe('approved');
  });

  it('marketing is excluded from operating cost and break-even', () => {
    const d = createPlatformDataset();
    d.vendors.push({ id: 'ven-mkt', name: 'Ads', category: 'marketing', plan: 'Pay as you go', status: 'active_paid', billing: 'manual', currency: 'NGN', note: '', owner: 'Lola' });
    captureExpense(d, { ...base(d), vendorId: 'ven-mkt', amountMinor: 20_000 }, { now: d.generatedAt, actor: actor('stf-fin') });
    applyExpenseAction(d, d.expenses[0]!.id, 'approve', { now: d.generatedAt, actor: actor('stf-fin2'), can: canOf('stf-fin2') });
    const s = operatingSummary(d, d.expenses[0]!.month);
    expect(s.marketing).toBe(2_000_000);
    expect(s.operating).toBe(0);
    expect(s.breakEven.coverage).toBeNull();
  });

  it('rejecting needs a reason; budgets need an amount', () => {
    const d = createPlatformDataset();
    captureExpense(d, { ...base(d), amountMinor: 1_000 }, { now: d.generatedAt, actor: actor('stf-fin') });
    expect(applyExpenseAction(d, d.expenses[0]!.id, 'reject', { now: d.generatedAt, actor: actor('stf-fin2'), can: canOf('stf-fin2') })).toMatchObject({ ok: false });
    expect(setBudget(d, { month: '2026-10', scope: 'operating', naira: 0 }, { now: d.generatedAt, actor: actor('stf-fin') })).toMatchObject({ ok: false });
    expect(setBudget(d, { month: '2026-10', scope: 'operating', naira: 100_000 }, { now: d.generatedAt, actor: actor('stf-fin') })).toMatchObject({ ok: true });
  });
});
