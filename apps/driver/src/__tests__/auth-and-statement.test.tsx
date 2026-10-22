import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMockServices, mockTripHistory, receiptReference } from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import SignUp from '@/app/auth/signup';
import SignIn from '@/app/auth/signin';
import { TripStatement } from '@/features/trip/TripStatement';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, dismissAll: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
jest.mock('@gobye/ui/src/map/MapCanvas', () => ({ MapCanvas: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function mount(el: React.ReactElement, services = createMockServices({ flags: { latency: [0, 0] } })) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SettingsProvider>
        <SessionProvider services={services}>
          <ToastProvider>{el}</ToastProvider>
        </SessionProvider>
      </SettingsProvider>
    </SafeAreaProvider>,
  );
}

const press = async (id: string) => {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(id));
    await new Promise((r) => setTimeout(r, 10));
  });
};

beforeEach(() => mockPush.mockReset());

describe('Driver account', () => {
  it('creates an account over four steps (launch cities only), with live password rules', async () => {
    await mount(<SignUp />);
    expect(screen.getByText('Become a driver')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Tunde Bakare');
    await press('signup-submit');
    expect(screen.getByText('Where will you drive, Tunde?')).toBeTruthy();
    expect(screen.queryByTestId('city-other')).toBeNull();
    await press('signup-submit');
    expect(screen.getByText('Choose where you’ll drive.')).toBeTruthy();
    await press('city-abuja');
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'tunde@example.com');
    await fireEvent.changeText(screen.getByTestId('signup-phone'), '0803 123 4567');
    await press('signup-submit');
    await fireEvent.changeText(screen.getByTestId('signup-password'), 'drive2026');
    expect(screen.getByTestId('signup-rules-number-met')).toBeTruthy();
    await press('signup-submit');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/auth/otp', params: { next: 'pass' } });
  });

  it('signs in over two steps and gives one neutral message for a wrong detail', async () => {
    await mount(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('signin-id'), 'nobody@example.com');
    await press('signin-submit');
    expect(screen.getByText('nobody@example.com')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('signin-password'), 'wrong2026');
    await press('signin-submit');
    expect(screen.getByTestId('signin-error')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps the sign-up details as the driver profile once the phone is verified', async () => {
    let session: ReturnType<typeof useSession> | null = null;
    function Probe() {
      const s = useSession();
      useEffect(() => {
        session = s;
      });
      return null;
    }
    await mount(<Probe />);
    await act(async () => {
      await session!.signUp({ fullName: 'Tunde Bakare', email: 'tunde@example.com', phone: '08031234567', password: 'drive2026', city: 'Abuja' });
    });
    let verified: unknown = null;
    await act(async () => {
      verified = await session!.verifyOtp('123456');
    });
    expect(verified).toEqual({ ok: true, value: { isNew: true } });
    expect(session!.status).toBe('signed_in');
    expect(session!.profile).toEqual({ firstName: 'Tunde', lastName: 'Bakare', email: 'tunde@example.com', city: 'Abuja' });
  });
});

describe('Trip statement', () => {
  const history = mockTripHistory(Date.UTC(2026, 9, 22, 12));
  const completed = history.find((t) => t.stage === 'completed')!;
  const cancelled = history.find((t) => t.stage === 'cancelled')!;

  it('shows what the driver earned, ₦0 commission and the reference', async () => {
    await mount(<TripStatement trip={completed} />);
    expect(screen.getByText('TRIP EARNINGS')).toBeTruthy();
    expect(screen.getByText('You earned')).toBeTruthy();
    expect(screen.getByText('GoBye commission')).toBeTruthy();
    expect(screen.getByText('₦0')).toBeTruthy();
    expect(screen.getByText('You keep')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText(receiptReference(completed.id))).toBeTruthy();
  });

  it('shows a cancelled trip without money lines', async () => {
    await mount(<TripStatement trip={cancelled} />);
    expect(screen.getByText('CANCELLED TRIP')).toBeTruthy();
    expect(screen.getByText('Rider didn’t come')).toBeTruthy();
    expect(screen.queryByText('You keep')).toBeNull();
  });

  it('says so when the trip is missing', async () => {
    await mount(<TripStatement trip={undefined} />);
    expect(screen.getByText('Trip not found')).toBeTruthy();
  });
});
