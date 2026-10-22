import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SocialProvider } from '@gobye/core';
import { BrandMark, Icon, Text, TextField, layout, spacing, useTheme, type IconName, type TextFieldProps } from '@gobye/ui';

/**
 * Building blocks for the sign-up / sign-in screens (owner's "GoBYE Auth Flow" design, built on the
 * design system): a top bar with a round back button and the mark centred, a bold heading, password
 * field with show/hide, Apple / Google buttons and an "or" divider.
 */

export function AuthTopBar({ onBack }: { onBack?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={4}
          testID="auth-back"
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? colors.secondaryPressed : colors.surface, borderColor: colors.border }]}
        >
          <Icon name="back" size="sm" color="text" />
        </Pressable>
      ) : null}
      <BrandMark size={32} />
    </View>
  );
}

export function AuthHeading({ title, subtitle, icon, centered }: { title: string; subtitle?: ReactNode; icon?: IconName; centered?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.heading, centered && styles.centered]}>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name={icon} size="lg" color="text" />
        </View>
      ) : null}
      <Text variant="largeTitle" accessibilityRole="header" align={centered ? 'center' : undefined}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" color="textSecondary" align={centered ? 'center' : undefined} style={centered ? styles.narrow : undefined}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function PasswordField(props: Omit<TextFieldProps, 'secureTextEntry' | 'trailing' | 'leadingIcon'>) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      leadingIcon="lock"
      secureTextEntry={!shown}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <Pressable
          onPress={() => setShown((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          hitSlop={6}
          style={({ pressed }) => [styles.eye, pressed && { backgroundColor: colors.secondaryPressed }]}
        >
          <Icon name={shown ? 'eyeClose' : 'eye'} size="sm" color="textSecondary" />
        </Pressable>
      }
    />
  );
}

const PROVIDER: Record<SocialProvider, { label: string; icon: IconName }> = {
  apple: { label: 'Apple', icon: 'apple' },
  google: { label: 'Google', icon: 'google' },
};

/** Apple and Google buttons. `stack`: full-width "Continue with …"; `row`: two compact buttons side by side. */
export function SocialButtons({ onPress, layout: mode = 'stack', busy }: { onPress: (p: SocialProvider) => void; layout?: 'stack' | 'row'; busy?: SocialProvider | null }) {
  const { colors } = useTheme();
  return (
    <View style={mode === 'row' ? styles.socialRow : styles.socialStack}>
      {(['apple', 'google'] as const).map((p) => (
        <Pressable
          key={p}
          onPress={() => onPress(p)}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={`Continue with ${PROVIDER[p].label}`}
          accessibilityState={{ busy: busy === p, disabled: !!busy }}
          testID={`social-${p}`}
          style={({ pressed }) => [
            styles.social,
            mode === 'row' && styles.socialHalf,
            { backgroundColor: pressed ? colors.secondaryPressed : colors.surface, borderColor: colors.border, opacity: busy && busy !== p ? 0.5 : 1 },
          ]}
        >
          <Icon name={PROVIDER[p].icon} variant="filled" size="sm" color="text" />
          <Text variant={mode === 'row' ? 'callout' : 'headline'} weight="semibold">
            {busy === p ? 'Connecting…' : mode === 'row' ? PROVIDER[p].label : `Continue with ${PROVIDER[p].label}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function OrDivider({ tight }: { tight?: boolean } = {}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.or, tight && styles.orTight]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      <Text variant="footnote" color="textSecondary">
        or
      </Text>
      <View style={[styles.line, { backgroundColor: colors.border }]} />
    </View>
  );
}

/** Inline link-style action ("Forgot password?", "Create account"). */
export function TextLink({ title, onPress, accent, testID }: { title: string; onPress: () => void; accent?: boolean; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8} testID={testID} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
      <Text variant="callout" weight="semibold" color={accent ? 'accentText' : 'text'}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  back: { position: 'absolute', left: 0, top: 0, width: 48, height: 48, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.xxl },
  centered: { alignItems: 'center', marginTop: spacing.huge },
  narrow: { maxWidth: 320 },
  tile: { width: 72, height: 72, borderRadius: layout.cardRadius + 4, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  eye: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.xs },
  socialStack: { gap: spacing.md },
  socialRow: { flexDirection: 'row', gap: spacing.md },
  social: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 56, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  socialHalf: { flex: 1, minHeight: 52 },
  or: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xl },
  orTight: { marginVertical: 0 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  link: { minHeight: 44, justifyContent: 'center' },
});
