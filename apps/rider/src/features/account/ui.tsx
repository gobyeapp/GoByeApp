import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Bone, Icon, Text, layout, shadows, spacing, useTheme, type IconName } from '@gobye/ui';

/**
 * Account visual language (profile.jpg): a circular back button with a left-aligned title, then
 * nested groups — a pale outer container carrying the section title, holding a raised inner card of
 * compact rows (icon column, label, value, chevron). Light: #F7F7F7 outer, white inner with a soft
 * shadow. Dark: #111111 outer, #1A1A1A inner with a hairline border.
 */

export function PageHeader({ title, onBack, trailing }: { title: string; onBack?: () => void; trailing?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          testID="header-back"
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? colors.secondaryPressed : colors.surfaceMuted }]}
        >
          <Icon name="back" size="sm" color="text" />
        </Pressable>
      ) : null}
      <Text variant="headline" accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

/** `inset`: where dividers start, aligned with the row text (icon column + gap). */
export function SettingsGroup({ title, children, footer, inset = 32 }: { title?: string; children: ReactNode; footer?: string; inset?: number }) {
  const { colors, scheme } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.outer, { backgroundColor: colors.surfaceMuted }]}>
      {title ? (
        <Text variant="footnote" weight="medium" color="textSecondary" accessibilityRole="header" style={styles.groupTitle}>
          {title}
        </Text>
      ) : null}
      <View
        style={[
          styles.inner,
          { backgroundColor: colors.card, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 },
          scheme === 'light' && shadows.card,
        ]}
      >
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: inset }]} /> : null}
            {child}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="caption" color="textSecondary" style={styles.groupFooter}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export interface SettingsRowProps {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  trailing?: 'chevron' | 'none' | 'switch' | ReactNode;
  switchValue?: boolean;
  onSwitch?: (v: boolean) => void;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
  accessibilityHint?: string;
}

export function SettingsRow({ icon, title, subtitle, value, trailing = 'chevron', switchValue, onSwitch, onPress, destructive, testID, accessibilityHint }: SettingsRowProps) {
  const { colors, scheme } = useTheme();
  const tone = destructive ? 'danger' : 'text';
  const label = [title, subtitle, value].filter(Boolean).join(', ');
  const body = (
    <>
      {icon ? (
        <View style={styles.iconCol}>
          <Icon name={icon} size="sm" color={tone} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="callout" weight="medium" color={tone}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="subhead" color="textSecondary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing === 'chevron' ? (
        <Icon name="chevronRight" size="sm" color="textSecondary" />
      ) : trailing === 'switch' ? (
        <Switch
          value={!!switchValue}
          onValueChange={onSwitch}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={switchValue ? colors.onPrimary : scheme === 'dark' ? '#A3A3A3' : '#FFFFFF'}
          {...({ activeThumbColor: colors.onPrimary } as object)}
          accessibilityLabel={title}
        />
      ) : trailing === 'none' ? null : (
        trailing
      )}
    </>
  );
  if (trailing === 'switch') {
    return (
      <View style={styles.row} testID={testID}>
        {body}
      </View>
    );
  }
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label} accessibilityHint={accessibilityHint} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      {body}
    </Pressable>
  );
}

/** Skeleton for a settings group while data loads (mirrors SettingsGroup proportions). */
export function SettingsGroupSkeleton({ rows = 3 }: { rows?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.outer, { backgroundColor: colors.surfaceMuted }]}>
      <View style={styles.groupTitle}>
        <Bone width={90} height={11} />
      </View>
      <View style={[styles.inner, { backgroundColor: colors.card }]}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={styles.row}>
            <Bone width={20} height={20} radius={6} />
            <Bone width={`${50 + ((i * 17) % 30)}%`} height={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

export const accountStyles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xxl },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: layout.page, minHeight: 56 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  outer: { borderRadius: layout.cardRadius, padding: spacing.xs + 2, gap: 0 },
  groupTitle: { paddingHorizontal: spacing.sm + 2, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  groupFooter: { paddingHorizontal: spacing.sm + 2, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  inner: { borderRadius: layout.cardRadius - 6, paddingHorizontal: spacing.md, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 50, paddingVertical: spacing.sm },
  iconCol: { width: 20, alignItems: 'center' },
  texts: { flex: 1, minWidth: 0, gap: 1 },
  value: { maxWidth: '40%' },
});
