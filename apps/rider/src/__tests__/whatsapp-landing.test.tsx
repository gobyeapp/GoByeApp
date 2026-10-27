import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMockServices } from '@gobye/core';
import { ToastProvider } from '@gobye/ui';
import OpenRide from '@/app/open/ride/[id]';
import { AccountProvider } from '@/state/account';
import { BookingProvider } from '@/state/booking';
import { ServiceConfigProvider } from '@/state/config';
import { ServicesProvider } from '@/state/services';
import { WalletProvider } from '@/state/wallet';

/** D-064: "Open GoBye" from a WhatsApp booking lands on an honest screen while rides are simulated. */
const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false, dismissAll: jest.fn() };
jest.mock('expo-router', () => ({ router: mockRouter, useFocusEffect: () => undefined, useLocalSearchParams: () => ({ id: '3f1c2b9a-0000-4000-8000-000000000001' }) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

it('without a live ride in the app, explains that WhatsApp rides appear once the ride service is connected', async () => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ServicesProvider services={createMockServices()}>
        <ServiceConfigProvider>
          <WalletProvider>
            <AccountProvider>
              <BookingProvider>
                <ToastProvider>
                  <OpenRide />
                </ToastProvider>
              </BookingProvider>
            </AccountProvider>
          </WalletProvider>
        </ServiceConfigProvider>
      </ServicesProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
  expect(screen.getByText('Ride booked on WhatsApp')).toBeTruthy();
  expect(screen.getByText(/simulated rides/)).toBeTruthy();
  expect(screen.getByText(/reply CANCEL/)).toBeTruthy();
  expect(screen.getByText(/3f1c2b9a/)).toBeTruthy();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
