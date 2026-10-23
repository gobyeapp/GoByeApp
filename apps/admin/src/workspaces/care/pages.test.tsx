import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Suspense, type ComponentType } from 'react';
import { HashRouter } from 'react-router-dom';
import { createPlatformDataset } from '@gobye/core';
import { RecordProvider } from '@/data/records';
import { FilterProvider, SessionProvider, TEST_STAFF } from '@/data/session';
import { PlatformProvider, ToastProvider } from '@/data/store';
import Approvals from '../approvals/Approvals';
import Audit from '../audit/Audit';
import Safety from '../safety/Safety';
import Cases from './Cases';

const DATA = createPlatformDataset();
const staffWith = (role: string) => TEST_STAFF.find((s) => s.status === 'active' && s.roles.includes(role as never) && !s.cities.length)!;

function mount(Page: ComponentType, staffId: string, hash = '#/') {
  window.location.hash = hash;
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

afterEach(() => {
  cleanup();
  window.location.hash = '#/';
});

describe('case deep links (?open=)', () => {
  it('opens a support case from the link and clears the link on close', () => {
    const c = DATA.cases.find((x) => x.team === 'care')!;
    mount(Cases, staffWith('care').id, `#/cases?open=${c.id}`);
    const dialog = screen.getByRole('dialog', { name: `${c.ref} · ${c.subject}` });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    expect(screen.queryByRole('dialog', { name: `${c.ref} · ${c.subject}` })).toBeNull();
    expect(window.location.hash).not.toContain('open=');
  });

  it('says so when the linked case is not in the support queue', () => {
    const c = DATA.cases.find((x) => x.team === 'safety')!;
    mount(Cases, staffWith('care').id, `#/cases?open=${c.id}`);
    expect(screen.getByText(/That case isn’t in your support queue/)).toBeTruthy();
  });

  it('opens a safety case from the link', () => {
    const c = DATA.cases.find((x) => x.team === 'safety')!;
    mount(Safety, staffWith('safety').id, `#/safety?open=${c.id}`);
    expect(screen.getByRole('dialog', { name: `${c.ref} · ${c.subject}` })).toBeTruthy();
  });
});

describe('oversight pages render', () => {
  it('approvals explains the two-person rule and lists pending requests', () => {
    mount(Approvals, staffWith('owner').id);
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeTruthy();
    expect(screen.getByText(/Two-person rule/)).toBeTruthy();
  });

  it('audit switches between timeline and table', () => {
    mount(Audit, staffWith('auditor').id);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Audit entries' })).toBeTruthy();
  });
});
