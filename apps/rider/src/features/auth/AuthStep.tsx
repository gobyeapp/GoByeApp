import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Icon, Text, layout, spacing, useTheme } from '@gobye/ui';

/**
 * Login steps (progressive disclosure): one question per screen with a step indicator, a bold title,
 * a short explanation, then the field. Errors appear in a fixed slot under the field so the layout and
 * the typed value stay put.
 */
export function AuthStepHeader({ step, total = 3, title, subtitle }: { step: number; total?: number; title: string; subtitle?: ReactNode }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeIn.duration(200)} style={styles.header}>
      <View style={styles.stepRow} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${total}`}>
        <View style={styles.bars}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.bar, { backgroundColor: i < step ? colors.primary : colors.border }]} />
          ))}
        </View>
        <Text variant="caption" color="textSecondary">
          Step {step} of {total}
        </Text>
      </View>
      <Text variant="title1" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="callout" color="textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/** Six code boxes driven by one hidden input (paste and SMS autofill still work). */
export function CodeBoxes({ value, onChange, error, verified, disabled, testID }: { value: string; onChange: (v: string) => void; error?: boolean; verified?: boolean; disabled?: boolean; testID?: string }) {
  const { colors, scheme } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);
  const active = Math.min(value.length, 5);
  return (
    <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.boxes}>
      {Array.from({ length: 6 }, (_, i) => {
        const filled = i < value.length;
        const isActive = focused && i === active && !verified;
        const border = error ? colors.danger : verified ? colors.success : isActive ? colors.primary : colors.border;
        return (
          <View key={i} style={[styles.box, { backgroundColor: colors.surfaceMuted, borderColor: border, borderWidth: isActive || error || verified ? 2 : 1 }]}>
            <Text variant="title2" tabular>
              {filled ? value[i] : ''}
            </Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        editable={!disabled}
        keyboardAppearance={scheme}
        caretHidden
        accessibilityLabel="6 digit code"
        testID={testID}
        style={styles.hiddenInput}
      />
      {verified ? (
        <View style={styles.verified} pointerEvents="none">
          <Icon name="checkCircle" variant="filled" size="sm" color="success" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Fixed-height message slot so validation never shifts the layout. */
export function FieldMessage({ error, info }: { error?: string; info?: string }) {
  return (
    <View style={styles.message} accessibilityLiveRegion="polite">
      {error ? (
        <View style={styles.messageRow}>
          <Icon name="warning" size="xs" color="danger" />
          <Text variant="footnote" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : info ? (
        <Text variant="footnote" color="textSecondary">
          {info}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { width: 28, height: 4, borderRadius: 2 },
  boxes: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  box: { flex: 1, maxWidth: 56, aspectRatio: 0.86, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.011, color: 'transparent' },
  verified: { position: 'absolute', right: -6, top: -10 },
  message: { minHeight: 36, justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
