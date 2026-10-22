import { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { fontFamily, inputElevation, spacing, typography } from '../theme/tokens';
import { Text } from './Text';

const E = inputElevation.primary;

export interface SearchFieldProps extends Omit<TextInputProps, 'style'> {
  /** Spoken name of the field. */
  label: string;
  placeholder: string;
  /**
   * Button mode: the field is a tappable entry point (e.g. Home → search screen). When set, no text is
   * typed here; the whole field and the action button call it.
   */
  onPress?: () => void;
  /** Trailing integrated action (default: an arrow that submits / opens). Hidden when `action` is null. */
  action?: { icon?: IconName; label: string; onPress: () => void } | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Primary search input (2026-10-21 refinement). A white (dark: raised grey) surface with a hairline border
 * and soft layered shadow so it reads as physically lifted; the circular action is inset inside the field
 * so it belongs to it. Press: the field settles slightly (scale 0.985, shallower shadow). Focus: a soft
 * outline ring. Reduce Motion: no scale animation. Use only for the main search on a screen; other fields
 * use the flat `TextField`.
 */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(
  { label, placeholder, onPress, action, style, testID, onFocus, onBlur, value, ...input },
  ref,
) {
  const { colors, scheme } = useTheme();
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const shadow = inputElevation[scheme];
  const state = focused ? shadow.focused : pressed ? shadow.pressed : shadow.rest;
  const surface = scheme === 'dark' ? colors.surface : colors.card;
  const border = focused ? colors.text : colors.border;

  const pressIn = () => {
    setPressed(true);
    if (!reduce) scale.value = withTiming(0.985, { duration: 90 });
  };
  const pressOut = () => {
    setPressed(false);
    if (!reduce) scale.value = withTiming(1, { duration: 140 });
  };

  const trailing =
    action === null ? null : (
      <Pressable
        onPress={action?.onPress ?? onPress}
        accessibilityRole="button"
        accessibilityLabel={action?.label ?? label}
        hitSlop={6}
        style={({ pressed: p }) => [styles.action, { backgroundColor: p ? colors.primaryPressed : colors.primary }]}
        testID={testID ? `${testID}-action` : undefined}
      >
        <Icon name={action?.icon ?? 'arrowRight'} size="sm" color="onPrimary" />
      </Pressable>
    );

  const body = (
    <>
      <Icon name="search" size={22} color={focused ? 'text' : 'textSecondary'} />
      {onPress ? (
        <Text variant="body" weight="medium" color="textSecondary" numberOfLines={1} style={styles.flex}>
          {value || placeholder}
        </Text>
      ) : (
        <TextInput
          ref={ref}
          {...input}
          value={value}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardAppearance={scheme}
          selectionColor={colors.text}
          cursorColor={colors.text}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text, fontFamily: fontFamily.medium, fontSize: typography.body.fontSize }]}
          testID={testID}
        />
      )}
      {trailing}
    </>
  );

  return (
    <Animated.View style={[styles.wrap, { backgroundColor: surface, borderColor: border }, state as ViewStyle, animated, style]}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          accessibilityRole="search"
          accessibilityLabel={label}
          style={styles.row}
          testID={testID}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: { minHeight: E.height, borderRadius: E.radius, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: E.height, paddingLeft: spacing.lg, paddingRight: E.inset },
  flex: { flex: 1, minWidth: 0 },
  // The field draws its own focus ring; suppress the browser outline in the web QA build.
  input: { flex: 1, minWidth: 0, paddingVertical: spacing.md, ...(Platform.OS === 'web' ? ({ outlineWidth: 0 } as object) : null) },
  action: { width: E.action, height: E.action, borderRadius: E.action / 2, alignItems: 'center', justifyContent: 'center' },
});
