import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMockServices } from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import SignUp from '@/app/auth/signup';
import SignIn from '@/app/auth/signin';
import { ServicesProvider } from '@/state/services';
import { SessionProvider } from '@/state/session';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const services = createMockServices({ flags: { latency: [0, 0] } });

async function mount(el: React.ReactElement) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ServicesProvider services={services}>
        <SessionProvider>
          <ToastProvider>{el}</ToastProvider>
        </SessionProvider>
      </ServicesProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => mockPush.mockReset());

describe('Create account and Sign in', () => {
  it('shows each problem under its own field and keeps what was typed', async () => {
    await mount(<SignUp />);
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Ada');
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'ada@');
    await fireEvent.changeText(screen.getByTestId('signup-password'), 'short');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(screen.getByText('Enter your first and last name.')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    expect(screen.getByTestId('signup-name').props.value).toBe('Ada');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('creates the account, then goes to phone verification', async () => {
    await mount(<SignUp />);
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Ada Okafor');
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('signup-phone'), '0803 123 4567');
    await fireEvent.changeText(screen.getByTestId('signup-password'), 'gobye2026');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(mockPush).toHaveBeenCalledWith('/auth/otp');
  });

  it('signs in to that account and rejects a wrong password with a neutral message', async () => {
    await mount(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('signin-id'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('signin-password'), 'wrongpass1');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signin-submit'));
    });
    expect(screen.getByTestId('signin-error')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('signin-password'), 'gobye2026');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signin-submit'));
    });
    expect(mockPush).toHaveBeenCalledWith('/auth/otp');
  });

  it('sends a new Google account to the phone step', async () => {
    await mount(<SignIn />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('social-google'));
    });
    expect(mockPush).toHaveBeenCalledWith('/auth/phone');
  });
});
