import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  createMemoryRelay,
  createMockServices,
  requestChanges,
  simulatedReview,
  withRelayStatus,
  type DriverApplication,
  type RelayApplication,
} from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import { VerificationCard } from '@/features/verification/VerificationCard';
import { DriverProvider, useDriver } from '@/state/driver';
import { RelayContext } from '@/state/relay';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, dismissAll: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
jest.mock('@gobye/ui/src/map/MapCanvas', () => ({ MapCanvas: () => null }));

const now = Date.UTC(2026, 9, 22, 12);
const complete: DriverApplication = {
  personal: { firstName: 'Tunde', lastName: 'Bakare', city: 'Lagos' },
  licence: { number: 'ABC123456789', expiry: '2029-01-01', photoUri: 'file://l.jpg' },
  identity: { type: 'nin', number: '12345678901', selfieUri: 'file://s.jpg' },
  vehicle: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2016, colour: 'Silver', plate: 'KJA123AB' },
  documents: { registration: 'file://r.jpg', insurance: 'file://i.jpg', roadworthiness: 'file://w.jpg' },
  status: 'in_progress',
};
const metrics = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };

describe('VerificationCard', () => {
  const card = async (application: DriverApplication) => {
    const onOpenStep = jest.fn();
    const onSubmit = jest.fn();
    const onResubmit = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <VerificationCard application={application} onOpenStep={onOpenStep} onSubmit={onSubmit} onResubmit={onResubmit} />
      </SafeAreaProvider>,
    );
    return { onOpenStep, onSubmit, onResubmit };
  };

  it('registering: shows the stage, the steps left and the next one', async () => {
    const { onOpenStep } = await card({ documents: {}, status: 'in_progress', personal: complete.personal });
    expect(screen.getByTestId('verification-register')).toBeTruthy();
    expect(screen.getByText('1 of 5 steps done')).toBeTruthy();
    expect(screen.getByTestId('todo-licence')).toBeTruthy();
    expect(screen.queryByTestId('todo-personal')).toBeNull();
    await fireEvent.press(screen.getByTestId('todo-identity'));
    expect(onOpenStep).toHaveBeenCalledWith('identity');
    expect(screen.getByText('Next: Driver’s licence')).toBeTruthy();
  });

  it('everything in: the action submits', async () => {
    const { onSubmit } = await card(complete);
    await fireEvent.press(screen.getByTestId('verification-action'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('in review: lists the checks and says which one waits on an outside office, and why', async () => {
    await card({ ...complete, status: 'pending_review', submittedAt: now, checks: simulatedReview(now, now + 8_000).checks });
    expect(screen.getByText('Review is taking longer')).toBeTruthy();
    expect(screen.getByTestId('waiting-licence')).toBeTruthy();
    expect(screen.getByText(/Waiting for the FRSC licence check/)).toBeTruthy();
    expect(screen.getAllByTestId('check-passed').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('verification-action')).toBeNull();
  });

  it('changes requested: each flagged item has its fix, the staff note and a Fix button', async () => {
    const r = requestChanges({ ...complete, status: 'pending_review' }, [{ code: 'insurance_expired', note: 'It ran out in June' }], now, 'One thing to fix.');
    if (!r.ok) throw new Error(r.error);
    const { onOpenStep } = await card(r.value);
    expect(screen.getByText('Fix 1 thing to continue')).toBeTruthy();
    expect(screen.getByText('Insurance certificate has expired')).toBeTruthy();
    expect(screen.getByText('Our team: “It ran out in June”')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fix-insurance_expired'));
    expect(onOpenStep).toHaveBeenCalledWith('documents');
  });

  it('approved: nothing blocking', async () => {
    await card({ ...complete, status: 'approved' });
    expect(screen.getByText('You’re approved')).toBeTruthy();
    expect(screen.queryByTestId('verification-action')).toBeNull();
  });
});

describe('Driver application through the demo relay', () => {
  it('is shared on submit; a staff request for changes comes back; fixing and resubmitting goes back to review', async () => {
    const mem = createMemoryRelay();
    const handle = withRelayStatus(mem);
    let session: ReturnType<typeof useSession> | null = null;
    let driver: ReturnType<typeof useDriver> | null = null;
    function Probe() {
      const s = useSession();
      const d = useDriver();
      useEffect(() => {
        session = s;
        driver = d;
      });
      return null;
    }
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <RelayContext.Provider value={handle}>
          <SettingsProvider>
            <SessionProvider services={createMockServices({ flags: { latency: [0, 0] } })}>
              <DriverProvider accountKey="t">
                <ToastProvider>
                  <Probe />
                </ToastProvider>
              </DriverProvider>
            </SessionProvider>
          </SettingsProvider>
        </RelayContext.Provider>
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(driver?.ready).toBe(true));
    await act(async () => {
      await session!.signUp({ fullName: 'Tunde Bakare', email: 'tunde@example.com', phone: '08031234567', password: 'drive2026', city: 'Lagos' });
    });
    await waitFor(() => expect(session!.pendingPhone).toBe('+2348031234567'));
    await act(async () => {
      await session!.verifyOtp('123456');
    });
    await waitFor(() => expect(session!.phone).toBe('+2348031234567'));
    await act(async () => {
      driver!.updateApplication(complete, 'documents');
    });
    await act(async () => {
      expect(driver!.submitApplication()).toEqual({ ok: true, value: true });
      await new Promise((r) => setTimeout(r, 20));
    });
    const rows = mem.tables.demo_driver_applications as unknown as RelayApplication[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending_review');
    expect(rows[0].checks.every((c) => c.state === 'queued')).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain('file://');
    expect((mem.tables.demo_people as unknown as { role: string }[])[0].role).toBe('driver');

    // Staff in the admin send it back.
    const sent = requestChanges(driver!.application, [{ code: 'selfie_unclear' }], Date.now(), 'Please retake your selfie.');
    if (!sent.ok) throw new Error(sent.error);
    await mem.update<RelayApplication>('demo_driver_applications', { id: '+2348031234567' }, { status: 'changes_requested', issues: sent.value.issues!, checks: sent.value.checks!, review_note: 'Please retake your selfie.', updated_at: Date.now() + 1_000 });
    await waitFor(() => expect(driver!.application.status).toBe('changes_requested'), { timeout: 6_000 });
    expect(driver!.application.reviewNote).toBe('Please retake your selfie.');
    expect(driver!.application.identity?.selfieUri).toBe('file://s.jpg');

    await act(async () => {
      driver!.updateApplication({ identity: { ...complete.identity!, selfieUri: 'file://s2.jpg' } }, 'identity');
    });
    await act(async () => {
      expect(driver!.resubmitApplication()).toEqual({ ok: true, value: true });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(rows[0].status).toBe('pending_review');
    expect(rows[0].issues.every((i) => !!i.resolvedAt)).toBe(true);
    // With the relay connected nobody approves automatically: staff decide.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(driver!.application.status).toBe('pending_review');
  }, 20_000);
});
