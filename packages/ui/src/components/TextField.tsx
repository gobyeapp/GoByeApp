import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { fontFamily, minTouch, radii, spacing, typography } from '../theme/tokens';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Hide the visible label (still announced) — e.g. search fields with a placeholder. */
  hideLabel?: boolean;
  prefix?: string;
  leadingIcon?: IconName;
  helper?: string;
  error?: string;
  disabled?: boolean;
  /** Control at the end of the field (e.g. show/hide password). Give it its own accessibility label. */
  trailing?: ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hideLabel, prefix, leadingIcon, helper, error, disabled, trailing, onFocus, onBlur, ...input },
  ref,
) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={styles.wrapper}>
      {!hideLabel ? (
        <Text variant="subhead" color="text" nativeID={`${label}-label`}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          { backgroundColor: colors.surfaceMuted, borderColor, opacity: disabled ? 0.5 : 1 },
        ]}
      >
        {leadingIcon ? <Icon name={leadingIcon} size="sm" color="textSecondary" /> : null}
        {prefix ? (
          <Text variant="body" color="textSecondary" weight="medium">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          {...input}
          editable={!disabled}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          aria-invalid={!!error}
          placeholderTextColor={colors.textSecondary}
          keyboardAppearance={scheme}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { color: colors.text, fontFamily: fontFamily.regular, fontSize: typography.body.fontSize },
            // Web QA build only: the field draws its own focus border, so hide the browser outline.
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <Icon name="warning" size="xs" color="danger" />
          <Text variant="footnote" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="footnote" color="textSecondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  field: {
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: { flex: 1, minWidth: 0, minHeight: minTouch, paddingVertical: spacing.sm },
  message: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  flex: { flex: 1 },
});
