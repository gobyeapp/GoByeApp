import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMockServices } from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import SignUp from '@/app/auth/signup';
import SignIn from '@/app/auth/signin';
import { AccountProvider } from '@/state/account';
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
          <AccountProvider>
            <ToastProvider>{el}</ToastProvider>
          </AccountProvider>
        </SessionProvider>
      </ServicesProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => mockPush.mockReset());

describe('Create account and Sign in', () => {
  it('walks the journey one question at a time and keeps what was typed', async () => {
    await mount(<SignUp />);
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Ada');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(screen.getByText('Enter your first and last name.')).toBeTruthy();
    expect(screen.getByTestId('signup-name').props.value).toBe('Ada');
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Ada Okafor');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    // City: Continue without a choice asks for one; a tile moves on by itself.
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(screen.getByText('Choose where you’ll ride.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('city-lagos'));
      await new Promise((r) => setTimeout(r, 10));
    });
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'ada@');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('creates the account after the last step, then verifies the phone and ends on the pass', async () => {
    await mount(<SignUp />);
    await fireEvent.changeText(screen.getByTestId('signup-name'), 'Ada Okafor');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('city-abuja'));
      await new Promise((r) => setTimeout(r, 10));
    });
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'ada@example.com');
    await fireEvent.changeText(screen.getByTestId('signup-phone'), '0803 123 4567');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    await fireEvent.changeText(screen.getByTestId('signup-password'), 'gobye2026');
    expect(screen.getByText('Good')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signup-submit'));
    });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/auth/otp', params: { next: 'pass' } });
  });

  it('signs in over two steps and rejects a wrong password with a neutral message', async () => {
    await mount(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('signin-id'), 'ada@');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signin-submit'));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('signin-id'), 'ada@example.com');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('signin-submit'));
    });
    expect(screen.getByText('ada@example.com')).toBeTruthy();
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
