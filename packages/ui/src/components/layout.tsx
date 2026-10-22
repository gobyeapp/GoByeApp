import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { spacing } from '../theme/tokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface ScreenHeaderProps {
  title?: string;
  onBack?: () => void;
  /** 'close' for modally presented screens. */
  backIcon?: 'back' | 'close';
  trailing?: ReactNode;
  large?: boolean;
}

export function ScreenHeader({ title, onBack, backIcon = 'back', trailing, large }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <IconButton icon={backIcon} accessibilityLabel={backIcon === 'close' ? 'Close' : 'Back'} onPress={onBack} testID="header-back" />
        ) : (
          <View style={styles.spacer} />
        )}
        {!large && title ? (
          <Text variant="headline" style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          <View style={styles.title} />
        )}
        {trailing ?? <View style={styles.spacer} />}
      </View>
      {large && title ? (
        <Text variant="title1" accessibilityRole="header" style={styles.largeTitle}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

export interface ScreenProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  /** Apply the 20pt screen margin to content (default true). */
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Skip the top inset when presented as a modal sheet on iOS. */
  edges?: { top?: boolean; bottom?: boolean };
}

/** Safe-area-aware screen container with optional scroll and a sticky footer (keyboard aware). */
export function Screen({ children, header, footer, scroll = true, padded = true, contentStyle, edges = { top: true, bottom: true } }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const body = [padded && { paddingHorizontal: spacing.screen }, contentStyle];
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background, paddingTop: edges.top ? insets.top : 0 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      {scroll ? (
        <ScrollView style={styles.flex} contentContainerStyle={[styles.scrollContent, ...body]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, ...body]}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: (edges.bottom ? insets.bottom : 0) + spacing.lg, backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {footer}
        </View>
      ) : (
        <View style={{ height: edges.bottom ? insets.bottom : 0 }} />
      )}
    </KeyboardAvoidingView>
  );
}

export function Section({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text variant="footnote" weight="semibold" color="textSecondary" accessibilityRole="header" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  title: { flex: 1, textAlign: 'center' },
  largeTitle: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  spacer: { width: 48 },
  scrollContent: { paddingBottom: spacing.xxxl, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  section: { gap: spacing.xs },
  sectionTitle: { letterSpacing: 0.5, marginTop: spacing.sm },
});
