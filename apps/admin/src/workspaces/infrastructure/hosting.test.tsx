import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HOSTING_PARTS, createPlatformDataset, hostingCost } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Hosting from './Hosting';

function mount(staffId: string) {
  const s = TEST_STAFF.find((x) => x.id === staffId)!;
  return render(
    <SessionProvider initialStaffId={staffId}>
      <PlatformProvider actor={{ kind: 'staff', id: s.id, name: s.name }} initial={createPlatformDataset()}>
        <ToastProvider>
          <FilterProvider>
            <MemoryRouter>
              <RecordProvider>
                <Hosting />
              </RecordProvider>
            </MemoryRouter>
          </FilterProvider>
        </ToastProvider>
      </PlatformProvider>
    </SessionProvider>,
  );
}
afterEach(cleanup);

describe('hosting switch (D-073)', () => {
  it('paid parts start off; free parts cost nothing', () => {
    expect(createPlatformDataset().paidHosting.enabled).toBe(false);
    expect(hostingCost(HOSTING_PARTS, false)).toBe(0);
    expect(hostingCost(HOSTING_PARTS, true)).toBe(12);
  });

  it('the owner turns it on after confirming; it is recorded', async () => {
    mount('stf-owner');
    const sw = screen.getByRole('switch', { name: 'Paid hosting' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(/Next: turn on Workers Paid/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Paid hosting' }).getAttribute('aria-checked')).toBe('true');
  });

  it('staff without owner rights cannot change it', () => {
    mount('stf-dev');
    expect((screen.getByRole('switch', { name: 'Paid hosting' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
