import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { minTouch, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

/* ---------- RadioRow ---------- */

export interface RadioRowProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onSelect: () => void;
  leadingIcon?: IconName;
  trailing?: ReactNode;
  disabled?: boolean;
  testID?: string;
}

export function RadioRow({ title, subtitle, selected, onSelect, leadingIcon, trailing, disabled, testID }: RadioRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onSelect}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.radioRow,
        {
          backgroundColor: selected ? colors.surfaceSelected : pressed ? colors.surfaceMuted : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {leadingIcon ? <Icon name={leadingIcon} variant={selected ? 'filled' : 'regular'} color={selected ? 'primary' : 'text'} /> : null}
      <View style={styles.flex}>
        <Text variant="body" weight={selected ? 'semibold' : 'medium'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.textSecondary }]}>
        {selected ? <View style={[styles.radioInner, { backgroundColor: colors.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

/* ---------- Checkbox ---------- */

export interface CheckboxProps {
  label: string | ReactNode;
  accessibilityLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID?: string;
}

export function Checkbox({ label, accessibilityLabel, checked, onChange, testID }: CheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
      accessibilityState={{ checked }}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.box,
          { borderColor: checked ? colors.primary : colors.textSecondary, backgroundColor: checked ? colors.primary : 'transparent' },
        ]}
      >
        {checked ? <Icon name="check" size="xs" color="onPrimary" /> : null}
      </View>
      {typeof label === 'string' ? (
        <Text variant="callout" style={styles.flex}>
          {label}
        </Text>
      ) : (
        <View style={styles.flex}>{label}</View>
      )}
    </Pressable>
  );
}

/* ---------- SegmentedControl ---------- */

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}

export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[styles.segments, { backgroundColor: colors.surfaceMuted }]}>
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            onPress={() => onChange(s.value)}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected }}
            testID={`segment-${s.value}`}
            style={[styles.segment, selected && { backgroundColor: colors.surface, borderColor: colors.primary }]}
          >
            {s.icon ? <Icon name={s.icon} size="sm" variant={selected ? 'filled' : 'regular'} color={selected ? 'primary' : 'textSecondary'} /> : null}
            <Text variant="subhead" weight="semibold" color={selected ? 'text' : 'textSecondary'}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- SwitchRow ---------- */

export interface SwitchRowProps {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  leadingIcon?: IconName;
}

export function SwitchRow({ title, subtitle, value, onChange, leadingIcon }: SwitchRowProps) {
  const { colors, scheme } = useTheme();
  return (
    <View style={styles.switchRow}>
      {leadingIcon ? <Icon name={leadingIcon} /> : null}
      <View style={styles.flex}>
        <Text variant="body" weight="medium">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        trackColor={{ true: colors.primary, false: colors.border }}
        // Thumb contrasts with the track in both themes (black track + white thumb / white track + black thumb).
        thumbColor={value ? colors.onPrimary : scheme === 'dark' ? '#A3A3A3' : '#FFFFFF'}
        // react-native-web (QA build only) ignores thumbColor when on and uses this prop instead.
        {...({ activeThumbColor: colors.onPrimary } as object)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  radioRow: {
    minHeight: minTouch + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1.5,
  },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', padding: spacing.xs, borderRadius: radii.lg, gap: spacing.xs },
  segment: {
    flex: 1,
    minHeight: minTouch,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch + 8, paddingHorizontal: spacing.xs },
});
