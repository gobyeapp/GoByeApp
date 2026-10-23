import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Subscriptions from '@/workspaces/subscriptions/Subscriptions';
import Drivers from './Drivers';
import Passengers from './Passengers';

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
  ['Drivers', Drivers],
  ['Passengers', Passengers],
  ['Driver subscriptions', Subscriptions],
];

afterEach(cleanup);

describe('people and subscription pages render for each role', () => {
  for (const staff of ['stf-owner', 'stf-onb', 'stf-fin', 'stf-care', 'stf-audit']) {
    for (const [title, Page] of PAGES) {
      it(`${title} as ${staff}`, () => {
        mount(Page, staff);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
        const text = document.body.textContent ?? '';
        expect(text).not.toMatch(/!/);
        expect(text).not.toMatch(/[–—]/);
      });
    }
  }
});

describe('driver profile sheet', () => {
  it('opens on documents for an applicant and shows the honest file placeholder', () => {
    mount(Drivers, 'stf-onb');
    const firstRow = document.querySelector('tbody tr.clickable') as HTMLElement;
    fireEvent.click(firstRow);
    expect(screen.getAllByText(/Document file not available in this prototype: stored privately in R2 once the backend exists/).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Subscription/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Subscription/ }));
    expect(screen.getByText(/Manual: the driver buys a new pass/)).toBeTruthy();
  });

  it('hides contact details from roles without access', () => {
    mount(Drivers, 'stf-fin');
    fireEvent.click(document.querySelector('tbody tr.clickable') as HTMLElement);
    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(screen.getAllByText(/Hidden for your role/).length).toBeGreaterThan(0);
  });
});

describe('driver subscriptions page', () => {
  it('states that renewal is manual and shows the confirmed plans', () => {
    mount(Subscriptions, 'stf-fin');
    expect(screen.getAllByText(/Renewal is manual/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₦2,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₦60,000').length).toBeGreaterThan(0);
    expect(screen.getByText(/24 hours from successful activation/)).toBeTruthy();
  });
});
