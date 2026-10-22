import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Suspense, type ReactNode } from 'react';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Integrations from './Integrations';
import EventLog from './EventLog';
import PaymentsSetup from '../payments/PaymentsSetup';

function wrap(node: ReactNode, staffId: string, path = '/') {
  const data = createPlatformDataset();
  const staff = data.staff.find((s) => s.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: staff.id, name: staff.name }} initial={data}>
        <ToastProvider>
          <FilterProvider>
            <MemoryRouter initialEntries={[path]}>
              <RecordProvider>
                <Suspense>{node}</Suspense>
              </RecordProvider>
            </MemoryRouter>
          </FilterProvider>
        </ToastProvider>
      </PlatformProvider>
    </SessionProvider>,
  );
}

/** Visible copy rule: no dashes and no exclamation marks (identifiers like apr-0004 or GB-FUND-1 are allowed). */
function visibleTextProblems(container: HTMLElement) {
  const isId = (w: string) => /^[(]?(int|apr|ann|col|wd|wdr|ref|drv|pas|pax|stf|aud|evt|cfg|stl|GB|STL)-[\w-]+/i.test(w);
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const w of (n.textContent ?? '').split(/\s+/)) if (/[—–!]/.test(w) || (/[a-z]-[a-z]/i.test(w) && !isId(w))) out.push(w);
  }
  return out;
}

describe('pages render on test data', () => {
  it('Integrations lists every area and opens a drawer from the query', () => {
    const { container } = wrap(<Integrations />, 'stf-dev', '/?open=int-pay-test');
    expect(screen.getAllByText('Payments and payouts').length).toBeGreaterThan(0);
    expect(screen.getByText('Identity checks')).toBeTruthy();
    expect(screen.getByText('https://api.example.test/webhooks/paystack/test')).toBeTruthy();
    expect(screen.getByText('sk_test_••••7f2a')).toBeTruthy();
    expect(visibleTextProblems(container)).toEqual([]);
    cleanup();
  });
  it('Database drawer is read only', () => {
    wrap(<Integrations />, 'stf-dev', '/?open=int-db');
    expect(screen.getByText(/no form here to switch or edit the database/)).toBeTruthy();
    expect(screen.queryByText('Mark configured')).toBeNull();
    cleanup();
  });
  it('Event log shows duplicates, failures and the monitoring empty state', () => {
    const { container } = wrap(<EventLog />, 'stf-dev');
    expect(screen.getByText('Monitoring is not connected yet')).toBeTruthy();
    expect(screen.getAllByText('Retry').length).toBeGreaterThan(0);
    expect(visibleTextProblems(container)).toEqual([]);
    cleanup();
  });
  it('Payments setup blocks live approval with a reason', () => {
    const { container } = wrap(<PaymentsSetup />, 'stf-owner');
    expect(screen.getByText(/Changing gateway keeps the provider on existing transactions/)).toBeTruthy();
    expect(screen.getByText('Business verification complete: waiting on owner (CAC documents)')).toBeTruthy();
    const approve = screen.getByText('Approve live').closest('button')!;
    expect(approve.disabled).toBe(true);
    expect(approve.title).toMatch(/Blocked/);
    expect(screen.getAllByText('Not implemented').length).toBe(2);
    expect(visibleTextProblems(container)).toEqual([]);
    cleanup();
  });
});
