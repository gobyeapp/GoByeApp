import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Overview from '@/workspaces/overview/Overview';
import Live from '@/workspaces/operations/Live';
import Trips, { inRideTab } from '@/workspaces/operations/Trips';
import Workspace from './Workspace';
import { periodTrend, workspacePanels } from './insights';

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

const text = () => document.body.textContent ?? '';
const noDashes = () => expect(text().replace(/\bD-\d{3}\b/g, '').match(/.{0,20}[–—].{0,20}/g) ?? []).toEqual([]);

afterEach(cleanup);

describe('Home', () => {
  for (const id of ['stf-owner', 'stf-admin', 'stf-ops', 'stf-fin', 'stf-audit']) {
    it(`renders the command centre for ${id} without the staff name or invented trends`, () => {
      mount(Overview, id);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/);
      expect(text()).toContain('Here’s what’s happening across GoBye today.');
      for (const h of ['Platform activity', 'Ride activity', 'Operational attention', 'Recent activity']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
      expect(text()).not.toContain(TEST_STAFF.find((s) => s.id === id)!.name.split(' ')[0]!);
      // The test data covers about 30 days, so a 30 day comparison would be meaningless and is not shown.
      expect(text()).not.toMatch(/vs previous/);
      noDashes();
    });
  }

  it('shows money only to finance roles, and never as commission revenue', () => {
    mount(Overview, 'stf-ops');
    expect(screen.queryByRole('heading', { name: 'Revenue and money' })).toBeNull();
    cleanup();
    mount(Overview, 'stf-fin');
    expect(screen.getByRole('heading', { name: 'Revenue and money' })).toBeTruthy();
    expect(text()).toMatch(/takes no trip commission/);
  });

  it('switches the ride activity chart view', () => {
    mount(Overview, 'stf-owner');
    fireEvent.click(screen.getByRole('button', { name: 'Booking mode' }));
    expect(screen.getByRole('img', { name: /Quick Match and Negotiated per day/ })).toBeTruthy();
  });

  it('a trend needs a fully covered earlier period', () => {
    const now = 100 * 86_400_000;
    const times = [now - 1, now - 2, now - 86_400_000 * 1.5];
    expect(periodTrend(times, now, 86_400_000, 'vs previous day', 0)).toEqual({ delta: 1, vs: 'vs previous day' });
    expect(periodTrend(times, now, 86_400_000, 'vs previous day', now - 86_400_000)).toBeUndefined();
    expect(periodTrend(times, now, Number.POSITIVE_INFINITY, 'x')).toBeUndefined();
  });
});

describe('My work', () => {
  const panels: [string, string[]][] = [
    ['stf-ops', ['Operations']],
    ['stf-onb', ['Driver verification']],
    ['stf-care', ['Support', 'Finance']],
    ['stf-safety', ['Safety']],
    ['stf-fin', ['Finance']],
    ['stf-dev', ['Technical']],
    ['stf-owner', ['Operations', 'Safety', 'Finance', 'Technical']],
  ];
  for (const [id, expected] of panels) {
    it(`${id} sees only ${expected.join(', ')}`, () => {
      mount(Workspace, id);
      const shown = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(shown).toEqual(expected);
      noDashes();
    });
  }

  it('panel choice follows responsibility permissions', () => {
    expect(workspacePanels(() => false)).toEqual([]);
    expect(workspacePanels((p) => p === 'drivers.verify')).toEqual(['verification']);
  });
});

describe('Live operations and rides', () => {
  it('Live shows the honest simulated map and opens a ride sheet', () => {
    mount(Live, 'stf-owner');
    expect(text()).toContain('Simulated positions · map provider not chosen');
    const list = screen.getByRole('heading', { name: 'Active rides' }).closest('.card')!;
    fireEvent.click(within(list as HTMLElement).getAllByRole('button')[0]!);
    const sheet = screen.getByRole('dialog');
    for (const k of ['Ride ID', 'Passenger', 'Driver', 'Pickup', 'Destination', 'Booking mode', 'Agreed fare']) expect(within(sheet).getByText(k)).toBeTruthy();
  });

  it('Trips has the six ride tabs and a negotiation timeline', () => {
    mount(Trips, 'stf-owner');
    for (const t of ['All rides', 'Booking requests', 'Quick Match', 'Fare negotiations', 'Cancelled', 'Trip issues']) expect(screen.getByRole('tab', { name: new RegExp(t) })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Fare negotiations/ }));
    expect(screen.getByRole('columnheader', { name: /Rider offer/ })).toBeTruthy();
    const firstRow = screen.getAllByRole('row')[1]!;
    fireEvent.click(firstRow);
    const sheet = screen.getByRole('dialog');
    const neg = within(sheet).getByRole('region', { name: 'Fare negotiation' });
    for (const k of ['Suggested fare', 'Rider offer', 'Final agreed fare', 'Offer expiry', 'Accepted at', 'Outcome']) expect(within(neg).getByText(k)).toBeTruthy();
    expect(within(neg).getByText('Rider offered')).toBeTruthy();
    expect(within(sheet).getByText(/not GoBye revenue/)).toBeTruthy();
    noDashes();
  });

  it('ride tabs filter correctly', () => {
    const d = createPlatformDataset();
    const none = new Set<string>();
    expect(d.trips.filter((t) => inRideTab(t, 'negotiations', none)).every((t) => t.mode === 'negotiate')).toBe(true);
    expect(d.trips.filter((t) => inRideTab(t, 'requests', none)).every((t) => t.status === 'searching' || t.status === 'matched')).toBe(true);
    expect(d.trips.filter((t) => inRideTab(t, 'issues', none)).length).toBeGreaterThan(0);
  });
});
