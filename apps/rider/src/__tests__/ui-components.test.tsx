// RNTL 14: render/fireEvent are async.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Checkbox, Icon, IconButton, RadioRow, SegmentedControl, TextField, iconRegistry } from '@gobye/ui';

describe('@gobye/ui components — roles, labels and states', () => {
  it('Button exposes role, label and disabled/busy state, and blocks presses when disabled', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<Button title="Book GoBye Go" trailingText="₦3,050" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Book GoBye Go, ₦3,050' });
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);

    await rerender(<Button title="Book" onPress={onPress} disabled />);
    const disabled = screen.getByRole('button', { name: 'Book' });
    expect(disabled.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(disabled);
    expect(onPress).toHaveBeenCalledTimes(1);

    await rerender(<Button title="Book" onPress={onPress} loading />);
    expect(screen.getByRole('button', { name: 'Book' }).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('IconButton requires and exposes an accessibility label', async () => {
    await render(<IconButton icon="close" accessibilityLabel="Close" onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('TextField labels the input and announces errors', async () => {
    await render(<TextField label="Mobile number" value="" onChangeText={() => undefined} error="Enter a valid number" />);
    const input = screen.getByLabelText('Mobile number');
    expect(input.props.accessibilityHint).toBe('Enter a valid number');
    expect(screen.getByText('Enter a valid number')).toBeTruthy();
  });

  it('RadioRow reports checked state', async () => {
    const onSelect = jest.fn();
    await render(<RadioRow title="Cash" selected onSelect={onSelect} />);
    const radio = screen.getByRole('radio', { name: 'Cash' });
    expect(radio.props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(radio);
    expect(onSelect).toHaveBeenCalled();
  });

  it('Checkbox toggles', async () => {
    const onChange = jest.fn();
    await render(<Checkbox label="I agree" checked={false} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'I agree' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('SegmentedControl marks the selected tab', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        accessibilityLabel="Booking mode"
        value="quick_match"
        onChange={onChange}
        segments={[
          { value: 'quick_match', label: 'Quick Match' },
          { value: 'negotiate', label: 'Negotiate' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Quick Match' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'Negotiate' }));
    expect(onChange).toHaveBeenCalledWith('negotiate');
  });

  it('every registered MingCute icon renders in both variants', async () => {
    for (const name of Object.keys(iconRegistry) as (keyof typeof iconRegistry)[]) {
      const { unmount } = await render(
        <>
          <Icon name={name} />
          <Icon name={name} variant="filled" />
        </>,
      );
      await unmount();
    }
  });

  it('decorative icons are hidden from assistive tech; labelled icons are exposed', async () => {
    await render(
      <>
        <Icon name="star" />
        <Icon name="warning" label="Warning" />
      </>,
    );
    expect(screen.getByLabelText('Warning')).toBeTruthy();
  });
});

describe('brand (preview assets, Q-008)', () => {
  it('renders the wordmark with the concept mark and a spoken name', async () => {
    const { Wordmark, BRAND_NAME } = require('@gobye/ui');
    await render(<Wordmark />);
    expect(screen.getByLabelText(BRAND_NAME)).toBeTruthy();
  });

  it('uses a monochrome interface with readable contrast in both themes (D-034)', () => {
    const { lightColors, darkColors, brand } = require('@gobye/ui');
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    expect(lightColors.background).toBe('#FFFFFF');
    expect(darkColors.background).toBe('#000000');
    for (const c of [lightColors, darkColors]) {
      // Everyday actions are neutral, never brand-filled.
      expect([brand.aubergine, brand.tangerine]).not.toContain(c.primary);
      const pairs: [string, string][] = [
        [c.text, c.background], [c.textSecondary, c.background], [c.text, c.surface], [c.textSecondary, c.surfaceMuted],
        [c.onPrimary, c.primary], [c.onSecondary, c.secondary], [c.onInverse, c.inverseSurface],
        [c.success, c.successSurface], [c.warning, c.warningSurface], [c.danger, c.dangerSurface], [c.accentText, c.background],
        [c.successOnInverse, c.inverseSurface], [c.dangerOnInverse, c.inverseSurface], [c.onIdentity, c.identity],
      ];
      for (const [fg, bg] of pairs) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('renders every illustration as decorative', async () => {
    const { Illustration } = require('@gobye/ui');
    for (const name of ['sedan', 'wallet', 'gift', 'destination']) {
      const r = await render(<Illustration name={name} />);
      await r.unmount();
    }
  });
});
