import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ROLE_PERMISSIONS, createPlatformDataset } from '@gobye/core';
import { ALL_ITEMS, ROLE_HOME } from '@/nav';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Balances from '@/workspaces/costs/Balances';
import Summary from './Summary';

function mount(Page: ComponentType, staffId: string) {
  const s = TEST_STAFF.find((x) => x.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: s.id, name: s.name }} initial={createPlatformDataset()}>
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

afterEach(cleanup);

describe('stakeholder view (D-068)', () => {
  it('lands on the business summary, in plain words and view only', () => {
    expect(ROLE_HOME.stakeholder).toBe('/summary');
    mount(Summary, 'stf-partner');
    expect(screen.getByRole('heading', { name: 'Business summary' })).toBeTruthy();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Money in and running costs by month' })).toBeTruthy();
    expect(screen.getByRole('meter', { name: /running costs covered/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Drivers by status' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('sees only the summary, reports and costs pages: nothing technical, no people records', () => {
    const perms = new Set(ROLE_PERMISSIONS.stakeholder);
    const visible = ALL_ITEMS.filter((i) => i.anyOf.some((p) => perms.has(p))).map((i) => i.path);
    expect(visible).toContain('/summary');
    expect(visible).toContain('/costs/balances');
    for (const hidden of ['/developer', '/developer/events', '/drivers', '/passengers', '/safety', '/staff', '/live', '/finance/ledger']) expect(visible).not.toContain(hidden);
  });
});

describe('service balances (D-068)', () => {
  it('shows money left and how many more drivers can be checked', () => {
    mount(Balances, 'stf-dev');
    expect(screen.getAllByText(/drivers fully checked/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sign in codes/).length).toBeGreaterThan(0);
    expect(screen.getByText('Top up soon')).toBeTruthy();
  });
});

describe('settings (D-069)', () => {
  it('switches appearance and shows the team with two step status', async () => {
    const { default: Settings } = await import('@/workspaces/settings/Settings');
    mount(Settings, 'stf-owner');
    expect(screen.getByRole('tab', { name: /General/ }).getAttribute('aria-selected')).toBe('true');
    const dark = screen.getByRole('radio', { name: 'Dark mode' });
    dark.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    screen.getByRole('radio', { name: 'Light mode' }).click();
    expect(document.documentElement.dataset.theme).toBe('light');
    screen.getByRole('tab', { name: /Team/ }).click();
    expect(await screen.findByPlaceholderText('Search members')).toBeTruthy();
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
  });
});
