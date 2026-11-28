// RNTL 14: render/fireEvent are async.
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatSheet, ColourPicker, VEHICLE_COLOURS, carArt, categoryArt, vehicleColour, vehicleNoun } from '@gobye/ui';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (el: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);

describe('ride chat sheet and car colours (D-108)', () => {
  it('shows the conversation, sends a quick message with one tap and a typed one, and shows why a send failed', async () => {
    const onSend = jest.fn(async (t: string) => (t === 'fail' ? 'Not sent. Check your connection and try again.' : null));
    const messages = [
      { id: '1', mine: false, text: 'I’ve arrived', at: 0 },
      { id: '2', mine: true, text: 'Coming out now', at: 1 },
    ];
    await show(<ChatSheet visible onClose={() => undefined} title="Tunde" messages={messages} quickReplies={['Where are you?']} onSend={onSend} note="Your number stays private." />);
    expect(screen.getByText('I’ve arrived')).toBeTruthy();
    expect(screen.getByText('Your number stays private.')).toBeTruthy();
    expect(screen.queryByTestId('chat-photo')).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Send: Where are you?' }));
    });
    expect(onSend).toHaveBeenLastCalledWith('Where are you?');

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'Blue gate');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('chat-send'));
    });
    expect(onSend).toHaveBeenLastCalledWith('Blue gate');
    expect(screen.getByTestId('chat-input').props.value).toBe('');

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'fail');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('chat-send'));
    });
    expect(screen.getByTestId('chat-error')).toBeTruthy();
    expect(screen.getByTestId('chat-input').props.value).toBe('fail');
  });

  it('a photo shows as a picture, never as text, and the camera button sends one', async () => {
    const onSendPhoto = jest.fn(async () => null);
    await show(<ChatSheet visible onClose={() => undefined} title="Ada" messages={[{ id: '1', mine: false, text: '', image: 'data:image/jpeg;base64,AAAA', at: 0 }]} quickReplies={['I’m at the gate']} onSend={async () => null} onSendPhoto={onSendPhoto} />);
    expect(screen.getByLabelText(/Ada: a photo/)).toBeTruthy();
    expect(screen.queryByText(/base64/)).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('chat-photo'));
    });
    expect(onSendPhoto).toHaveBeenCalledTimes(1);
  });

  it('a colour is picked from the list, and every listed colour has a car picture', async () => {
    const onChange = jest.fn();
    await render(<ColourPicker label="Colour" value="Silver" onChange={onChange} testID="c" />);
    expect(screen.getByRole('radio', { name: 'Silver' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'Wine' }));
    expect(onChange).toHaveBeenCalledWith('Wine');

    expect(VEHICLE_COLOURS.length).toBe(12);
    for (const c of VEHICLE_COLOURS) expect(carArt(c.name)).toBeDefined();
    expect(vehicleColour(' GRAY ')?.id).toBe('grey');
    expect(vehicleColour('Maroon')?.id).toBe('wine');
    expect(vehicleColour('Lilac')).toBeNull();
    expect(carArt('Lilac')).toBe(carArt('White'));
  });

  it('each ride type (keke, car, comfort, XL) has its own picture in every colour', () => {
    const seen = new Set<unknown>();
    for (const category of ['keke', 'go', 'comfort', 'xl']) {
      for (const c of VEHICLE_COLOURS) {
        const art = carArt(c.name, category);
        expect(art).toBeDefined();
        seen.add(`${category}:${c.id}`);
      }
    }
    expect(seen.size).toBe(48);
    // No category, or one we have no picture for, falls back to the car.
    expect(carArt('Red')).toBe(carArt('Red', 'go'));
    expect(carArt('Red', 'boat')).toBe(carArt('Red', 'go'));
    // Before a driver is matched: a yellow keke, a white car.
    expect(categoryArt('keke')).toBe(carArt('Yellow', 'keke'));
    expect(categoryArt('xl')).toBe(carArt('White', 'xl'));
    expect(vehicleNoun('keke')).toBe('keke');
    expect(vehicleNoun('comfort')).toBe('car');
  });
});
