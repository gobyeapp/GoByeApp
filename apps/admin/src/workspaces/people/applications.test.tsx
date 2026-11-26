import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@gobye/core';
import { SessionProvider } from '@/data/session';
import { ToastProvider } from '@/data/store';
import { actionError, applicationsApi, masked } from './applicationsApi';

const { calls, fakeApi } = vi.hoisted(() => {
/** A fake GoBye API: one application in review, version 3. */
const calls: { method: string; path: string; body?: unknown }[] = [];
const detail = (status: string, version: number) => ({
  driverId: 'd-1',
  status,
  version,
  application: {
    city: 'lagos',
    status,
    documents: {},
    personal: { firstName: 'Tunde', lastName: 'Bakare', city: 'Lagos' },
    licence: { number: 'ABC123456789', expiry: '2031-01-01', photoUri: 'f1' },
    identity: { type: 'nin', number: '12345678901', selfieUri: 'f2' },
    vehicle: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2016, colour: 'Silver', plate: 'KJA 123 AB' },
  },
  summary: { stage: status === 'approved' ? 'approved' : 'review', title: status === 'approved' ? 'You’re approved' : 'We’re checking your documents', checks: [{ id: 'identity', label: 'Identity', state: 'queued' }], issues: [], steps: [], todo: [], waiting: [], progress: { done: 5, total: 5 }, action: null, body: '' },
  files: [{ slot: 'licence', fileId: 'f1', state: 'ready' }],
  driver: { name: 'Tunde Bakare', phone: '+2348031234567' },
  events: [{ at: '2026-11-26T10:00:00Z', by: 'driver', kind: 'submitted', version: 3 }],
});
let state = detail('pending_review', 3);
const fakeApi = {
  get: async (path: string) => {
    calls.push({ method: 'GET', path });
    if (path === '/me') return { ok: true, value: { staff: { id: 's-1', name: 'Ada', email: 'ada@gobye.app', roles: ['onboarding'], cities: [], status: 'active', mfaRequired: false } } };
    if (path === '/staff/driver-applications') return { ok: true, value: { items: [{ driverId: 'd-1', name: 'Tunde Bakare', city: 'lagos', status: 'pending_review', version: 3, submittedAt: '2026-11-26T10:00:00Z', updatedAt: '2026-11-26T10:00:00Z', openIssues: 0 }] } };
    return { ok: true, value: state };
  },
  post: async (path: string, body: { version: number }) => {
    calls.push({ method: 'POST', path, body });
    if (body.version !== state.version) return { ok: false, error: { kind: 'conflict', code: 'VERSION_CONFLICT', message: 'changed' } };
    state = detail('approved', state.version + 1);
    return { ok: true, value: state };
  },
} as unknown as ApiClient;
  return { calls, fakeApi };

});

vi.mock('@/data/live', () => ({
  LIVE: { api: fakeApi, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }), signOut: async () => undefined } } },
  nextStep: async () => ({ ok: true, value: { step: 'done', staff: { id: 's-1', name: 'Ada', email: 'ada@gobye.app', roles: ['onboarding'], cities: [], status: 'active', twoStep: true } } }),
}));

afterEach(cleanup);

describe('driver applications on the API (D-081)', () => {
  it('lists the queue, opens an application and approves it with its version', async () => {
    const { default: Applications } = await import('./Applications');
    render(
      <SessionProvider>
        <ToastProvider>
          <Applications />
        </ToastProvider>
      </SessionProvider>,
    );
    fireEvent.click(await screen.findByText('Tunde Bakare'));
    expect(await screen.findByText('ABC123456789 · expires 2031-01-01')).toBeTruthy();
    expect(screen.getByText('NIN •••• 8901')).toBeTruthy();
    expect(screen.getByText('Checked')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Approve')!);
    await waitFor(() => expect(calls.some((c) => c.path === '/staff/driver-applications/d-1/decision')).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/decision'))!.body).toEqual({ version: 3, decision: 'approve' });
    expect(await screen.findByText('You’re approved')).toBeTruthy();
  });

  it('client helpers', async () => {
    const posts: unknown[][] = [];
    const api = { post: async (...a: unknown[]) => (posts.push(a), { ok: true, value: {} }), get: async () => ({ ok: true, value: {} }) } as unknown as ApiClient;
    await applicationsApi(api).requestChanges('d-2', 4, [{ code: 'licence_unreadable' }], 'Glare');
    expect(posts[0]![0]).toBe('/staff/driver-applications/d-2/request-changes');
    expect(posts[0]![1]).toEqual({ version: 4, issues: [{ code: 'licence_unreadable' }], note: 'Glare' });
    expect((posts[0]![2] as { idempotencyKey: string }).idempotencyKey).toMatch(/^adm-/);
    expect(actionError({ ok: false, error: { kind: 'conflict', code: 'VERSION_CONFLICT', message: 'x' } })).toMatch(/reloaded/);
    expect(masked('12345678901')).toBe('•••• 8901');
  });
});
