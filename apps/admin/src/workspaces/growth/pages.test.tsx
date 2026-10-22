import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Categories from '@/workspaces/config/Categories';
import Fares from '@/workspaces/config/Fares';
import Packages from '@/workspaces/config/Packages';
import Referrals from '@/workspaces/config/Referrals';
import ServiceAreas from '@/workspaces/config/ServiceAreas';
import Announcements from './Announcements';
import Events from './Events';
import Promotions from './Promotions';

/** Smoke test: every config and growth page renders on the test dataset for each relevant role. */
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

const PAGES: [string, ComponentType][] = [
  ['Service areas', ServiceAreas],
  ['Vehicle categories', Categories],
  ['Fare settings', Fares],
  ['Driver packages', Packages],
  ['Rewards and referrals', Referrals],
  ['Announcements', Announcements],
  ['Promotions', Promotions],
  ['Events and partners', Events],
];

afterEach(cleanup);

describe('config and growth pages render', () => {
  for (const staff of ['stf-owner', 'stf-admin', 'stf-mkt', 'stf-audit']) {
    for (const [title, Page] of PAGES) {
      it(`${title} as ${staff}`, () => {
        mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        // House style: no exclamation marks in visible text.
        expect(document.body.textContent).not.toMatch(/!/);
        // No hyphens or dashes in visible text. Decision references such as D-024 are identifiers.
        expect(document.body.textContent?.replace(/\bD-\d{3}\b/g, 'D024').match(/.{0,30}[-\u2010-\u2015\u2212].{0,30}/g) ?? []).toEqual([]);
      });
    }
  }

  it('fares shows the pending v3 comparison with example trips', () => {
    mount(Fares, 'stf-owner');
    expect(screen.getByText('Compare with Fare rules v3')).toBeTruthy();
    expect(screen.getAllByText('5 km, 15 min').length).toBeGreaterThan(0);
    expect(screen.getByText(/Existing bookings, purchased passes and earned rewards keep the terms/)).toBeTruthy();
  });

  it('opens the editors without crashing', () => {
    mount(Fares, 'stf-admin');
    fireEvent.click(screen.getByRole('button', { name: /New version/ }));
    expect(screen.getByText('Before and after')).toBeTruthy();
    cleanup();
    mount(Announcements, 'stf-mkt');
    fireEvent.click(screen.getAllByRole('button', { name: /New announcement/ })[0]!);
    expect(screen.getAllByText('Audience preview').length).toBeGreaterThan(0);
    cleanup();
    mount(Promotions, 'stf-mkt');
    fireEvent.click(screen.getByRole('button', { name: /New campaign/ }));
    expect(screen.getAllByText('Card preview at phone width').length).toBeGreaterThan(0);
    cleanup();
    mount(Events, 'stf-mkt');
    fireEvent.click(screen.getByRole('button', { name: /New event/ }));
    expect(screen.getByPlaceholderText('Add a gate or car park')).toBeTruthy();
    cleanup();
    mount(Categories, 'stf-owner');
    fireEvent.click(screen.getByRole('button', { name: /New version/ }));
    expect(screen.getByText('Add category')).toBeTruthy();
  });
});

describe('flows', () => {
  it('admin sends a new fares version for approval; history keeps the version in force', async () => {
    mount(Fares, 'stf-admin');
    fireEvent.click(screen.getByRole('button', { name: /New version/ }));
    fireEvent.change(screen.getByLabelText('Per km'), { target: { value: '210' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Test change' } });
    expect(screen.getAllByText('₦210').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('Fare rules v4', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getAllByText('Pending approval').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('In force').length).toBeGreaterThan(0);
  });

  it('rejects a past effective date', () => {
    mount(Fares, 'stf-admin');
    fireEvent.click(screen.getByRole('button', { name: /New version/ }));
    fireEvent.change(screen.getByLabelText('Effective date'), { target: { value: '2026-01-01' } });
    expect(screen.getByText(/can’t be in the past/)).toBeTruthy();
  });

  it('publishes a draft announcement: inbox records, snapshot and results', async () => {
    mount(Announcements, 'stf-mkt');
    fireEvent.click(screen.getByText('New: share your trip'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    expect(await screen.findByText('Sent copy', {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByText(/app inbox records created/, {}, { timeout: 4000 })).toBeTruthy();
  });

  it('retrying SMS stays failed while the provider is not connected', async () => {
    mount(Announcements, 'stf-mkt');
    fireEvent.click(screen.getByRole('tab', { name: /Retry queue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Still in the queue after the retry finishes; the history in the panel says why.
    await new Promise((r) => setTimeout(r, 900));
    fireEvent.click(screen.getByText('Daily pass price'));
    expect(await screen.findByText(/all still failed because the provider isn’t connected/, {}, { timeout: 3000 })).toBeTruthy();
  });
});
