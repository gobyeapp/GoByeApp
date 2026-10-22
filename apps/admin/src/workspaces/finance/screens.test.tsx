import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Suspense, type ComponentType } from 'react';
import { HashRouter } from 'react-router-dom';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Collections from './Collections';
import Earnings from './Earnings';
import Ledger from './Ledger';
import Reconciliation from './Reconciliation';
import Refunds from './Refunds';
import Reports from './Reports';
import Settlements from './Settlements';
import Wallets from './Wallets';
import Withdrawals from './Withdrawals';

/** Smoke test: every finance screen renders on the test dataset for finance and for the read only auditor. */
function mount(Page: ComponentType, staffId: string) {
  const s = TEST_STAFF.find((x) => x.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: s.id, name: s.name }} initial={createPlatformDataset()}>
        <ToastProvider>
          <FilterProvider>
            <HashRouter>
              <RecordProvider>
                <Suspense fallback={null}>
                  <Page />
                </Suspense>
              </RecordProvider>
            </HashRouter>
          </FilterProvider>
        </ToastProvider>
      </PlatformProvider>
    </SessionProvider>,
  );
}

const PAGES: [string, ComponentType, string][] = [
  ['Collections', Collections, 'Collections'],
  ['Wallets', Wallets, 'Passenger wallets'],
  ['Earnings', Earnings, 'Driver earnings'],
  ['Withdrawals', Withdrawals, 'Withdrawals'],
  ['Refunds', Refunds, 'Refunds and disputes'],
  ['Settlements', Settlements, 'Settlements'],
  ['Reconciliation', Reconciliation, 'Reconciliation'],
  ['Ledger', Ledger, 'Ledger'],
  ['Reports', Reports, 'Reports'],
];

describe('finance screens', () => {
  for (const [name, Page, title] of PAGES) {
    for (const staff of ['stf-fin', 'stf-audit']) {
      it(`${name} renders for ${staff} with test data marked and no dashes or exclamation marks`, () => {
        mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        expect(screen.getAllByText(/Paystack \(test\)/).length).toBeGreaterThan(0);
        const text = document.body.textContent ?? '';
        expect(text).not.toMatch(/[—–!]/);
        cleanup();
      });
    }
  }

  it('auditor sees no finance actions on a pending collection', () => {
    mount(Collections, 'stf-audit');
    fireEvent.click(screen.getAllByText('Pending')[0]!);
    const pendingRow = screen.getAllByText('Not verified')[0]!.closest('tr')!;
    fireEvent.click(pendingRow);
    expect(screen.getByText(/Not credited until the provider confirms/)).toBeTruthy();
    expect(screen.queryByText('Verify with provider')).toBeNull();
    cleanup();
  });

  it('finance verifies a pending collection once (simulated) and the drawer shows the journal', async () => {
    mount(Collections, 'stf-fin');
    fireEvent.click(screen.getAllByText('Not verified')[0]!.closest('tr')!);
    fireEvent.click(screen.getByText('Verify with provider'));
    expect(await screen.findByText('Verified. Credited once.', undefined, { timeout: 3000 })).toBeTruthy();
    fireEvent.click(screen.getByText('Check again with provider'));
    expect(await screen.findByText('Already verified. Nothing was credited again.', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getAllByText('Duplicate, not applied').length).toBeGreaterThan(0);
    cleanup();
  });

  for (const [name, Page] of PAGES) {
    it(`${name}: opening the first record shows a drawer`, () => {
      const { container } = mount(Page, 'stf-fin');
      const row = container.querySelector('tr.clickable') as HTMLElement | null;
      if (row) {
        fireEvent.click(row);
        expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
        expect(document.body.textContent ?? '').not.toMatch(/[—–!]/);
      }
      cleanup();
    });
  }
});
