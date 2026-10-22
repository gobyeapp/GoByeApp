import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '@gobye/ui';
import { PickupSheet } from '@/features/home/PickupSheet';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/state/haptics', () => ({ useHaptics: () => () => undefined }));

const mockLocation = { permission: 'granted', accuracyMeters: 12, coordinate: { latitude: 6.5, longitude: 3.37 }, openSettings: jest.fn() };
jest.mock('@/state/location', () => ({ useCurrentLocation: () => mockLocation }));
const mockLocate = jest.fn();
jest.mock('@/features/home/useLocatePickup', () => ({ useLocatePickup: () => ({ locate: mockLocate, busy: false }) }));

// Toasts hide on a timer; fake timers keep the test from leaving it running.
jest.useFakeTimers();

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function open(onClose = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ToastProvider>
        <PickupSheet visible onClose={onClose} />
      </ToastProvider>
    </SafeAreaProvider>,
  );
  return onClose;
}

beforeEach(() => {
  mockPush.mockReset();
  mockLocate.mockReset();
  mockLocation.permission = 'granted';
  mockLocation.openSettings.mockReset();
});

describe('Change pickup sheet', () => {
  it('leads with address search and opens it for the pickup field', async () => {
    const onClose = await open();
    expect(screen.getByText('Change pickup')).toBeTruthy();
    expect(screen.getByText('Drag the map to pinpoint your pickup.')).toBeTruthy();
    expect(screen.getByText('Accurate to about 12 m')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pickup-search'));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/booking/search', params: { field: 'pickup' } });
  });

  it('opens map selection', async () => {
    await open();
    fireEvent.press(screen.getByTestId('pickup-on-map'));
    expect(mockPush).toHaveBeenCalledWith('/booking/pickup-map');
  });

  it('explains before asking for location when permission is undetermined', async () => {
    mockLocation.permission = 'undetermined';
    await open();
    expect(screen.getByText('Allow location access to use this')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pickup-my-location'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/permission-location', params: { next: 'pickup' } });
    expect(mockLocate).not.toHaveBeenCalled();
  });

  it('sends the rider to Settings when location is off', async () => {
    mockLocation.permission = 'denied';
    await open();
    fireEvent.press(screen.getByTestId('pickup-my-location'));
    expect(mockLocation.openSettings).toHaveBeenCalled();
  });

  it('keeps the sheet open with a message when the lookup fails, and closes on success', async () => {
    mockLocate.mockResolvedValueOnce({ ok: false, error: 'We couldn’t find your position.' });
    const onClose = await open();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pickup-my-location'));
    });
    expect(screen.getByText('We couldn’t find your position.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    mockLocate.mockResolvedValueOnce({ ok: true, value: {} });
    await act(async () => {
      fireEvent.press(screen.getByTestId('pickup-my-location'));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
