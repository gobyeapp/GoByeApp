import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { layout, radii, shadows, spacing, type ColorTokens } from '../theme/tokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

/* ---------- Sheet: short contextual choices (brief §14: sheets for short tasks, pages for long) ---------- */

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
  /**
   * Optional hero (icon tile or illustration) for explanatory sheets (bank reference): when set, the
   * hero, title and subtitle are centred above grouped content.
   */
  hero?: ReactNode;
  /**
   * `leading` (action sheets): left-aligned title with a small, quiet close button on the same line, so
   * the header doesn't compete with the content. Default `center` keeps the centred title.
   */
  headerAlign?: 'center' | 'leading';
}

export function Sheet({ visible, onClose, title, subtitle, children, footer, testID, hero: heroProp, headerAlign = 'center' }: SheetProps) {
  const { colors, scheme } = useTheme();
  // On short screens the hero is dropped so the grouped content and the action stay in view.
  const { height } = useWindowDimensions();
  const hero = height >= 700 ? heroProp : undefined;
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {visible ? (
          <Animated.View entering={FadeIn.duration(reduce ? 0 : 180)} exiting={FadeOut.duration(reduce ? 0 : 150)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
        ) : null}
        {visible ? (
          <Animated.View
            testID={testID}
            entering={reduce ? FadeIn.duration(0) : SlideInDown.duration(260)}
            exiting={reduce ? FadeOut.duration(0) : SlideOutDown.duration(200)}
            accessibilityViewIsModal
            style={[styles.sheet, shadows.sheet, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0, paddingBottom: insets.bottom + spacing.lg }]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            {headerAlign === 'leading' ? (
              <View style={styles.leadHeader}>
                <View style={styles.leadTitle}>
                  <Text variant="title3" accessibilityRole="header">
                    {title}
                  </Text>
                  {subtitle ? (
                    <Text variant="footnote" color="textSecondary">
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                  testID={testID ? `${testID}-close` : undefined}
                  style={({ pressed }) => [styles.leadClose, { backgroundColor: pressed ? colors.secondaryPressed : colors.surfaceMuted }]}
                >
                  <Icon name="close" size={16} color="textSecondary" />
                </Pressable>
              </View>
            ) : (
              <>
            {/* Centred title with the close action on the right (bottom-sheet reference); the spacer keeps the title optically centred. */}
            <View style={styles.sheetHeader}>
              <View style={styles.headerSide} />
              <View style={styles.headerTitle}>
                {hero ? <View style={styles.hero}>{hero}</View> : null}
                <Text variant={hero ? 'title2' : 'headline'} align="center" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant={hero ? 'callout' : 'footnote'} color="textSecondary" align="center">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <View style={styles.headerSide}>
                <IconButton icon="close" variant="filled" accessibilityLabel="Close" onPress={onClose} />
              </View>
            </View>
              </>
            )}
            <ScrollView style={styles.flexShrink} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              {children}
            </ScrollView>
            {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- Avatar: photo when available, otherwise initials ---------- */

export function Avatar({ uri, name, size = 44, ring, accessibilityLabel }: { uri?: string | null; name?: string; size?: number; ring?: boolean; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const initials = (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const style = { width: size, height: size, borderRadius: size / 2 };
  // Falls back to initials if the image can't load (e.g. a cleared cache file).
  const [failed, setFailed] = useState(false);
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[style, styles.avatar, { backgroundColor: colors.identity }, ring && { borderWidth: 2, borderColor: colors.surface }]}
    >
      {uri && !failed ? (
        <Image source={{ uri }} style={style} accessibilityIgnoresInvertColors onError={() => setFailed(true)} />
      ) : initials ? (
        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: size * 0.38, color: colors.onIdentity }}>{initials}</Text>
      ) : (
        <Icon name="account" variant="filled" size={size * 0.5} color="onIdentity" />
      )}
    </View>
  );
}

/* ---------- ListGroup: grouped rows in a container (profile reference) ---------- */

export function ListGroup({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, style]}>
      {title ? (
        <Text variant="footnote" weight="semibold" color="textSecondary" accessibilityRole="header" style={styles.groupTitle}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.groupBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={[styles.groupDivider, { backgroundColor: colors.border, marginLeft: layout.container + layout.iconBox + layout.iconGap }]} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------- StatusBadge: payment / transaction / referral states (never colour alone) ---------- */

export type StatusKind = 'pending' | 'processing' | 'successful' | 'failed' | 'reversed' | 'info' | 'neutral';

const STATUS_ICON: Record<StatusKind, IconName> = {
  pending: 'clock',
  processing: 'refresh',
  successful: 'checkCircle',
  failed: 'closeCircle',
  reversed: 'refresh',
  info: 'info',
  neutral: 'info',
};

export function StatusBadge({ kind, label }: { kind: StatusKind; label: string }) {
  const { colors } = useTheme();
  const map: Record<StatusKind, { bg: string; fg: keyof ColorTokens }> = {
    pending: { bg: colors.warningSurface, fg: 'warning' },
    processing: { bg: colors.warningSurface, fg: 'warning' },
    successful: { bg: colors.successSurface, fg: 'success' },
    failed: { bg: colors.dangerSurface, fg: 'danger' },
    reversed: { bg: colors.neutralSurface, fg: 'textSecondary' },
    info: { bg: colors.neutralSurface, fg: 'text' },
    neutral: { bg: colors.neutralSurface, fg: 'textSecondary' },
  };
  const t = map[kind];
  return (
    <View style={[styles.status, { backgroundColor: t.bg }]} accessible accessibilityLabel={`Status: ${label}`}>
      <Icon name={STATUS_ICON[kind]} size="xs" color={t.fg} />
      <Text variant="caption" color={t.fg} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

/* ---------- ProgressBar: driven by real data (ETA), not a decorative countdown ---------- */

export function ProgressBar({ value, accessibilityLabel, knobIcon }: { value: number; accessibilityLabel: string; knobIcon?: IconName }) {
  const { colors } = useTheme();
  const v = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
    >
      <View style={[styles.fill, { width: `${v * 100}%`, backgroundColor: colors.primary }]} />
      {knobIcon ? (
        <View style={[styles.knob, { left: `${v * 100}%`, backgroundColor: colors.primary, borderColor: colors.surface }]}>
          <Icon name={knobIcon} variant="filled" size={14} color="onPrimary" />
        </View>
      ) : null}
    </View>
  );
}

/* ---------- KeyValue rows ---------- */

export function KeyValue({ label, value, bold, spoken }: { label: string; value: string; bold?: boolean; spoken?: string }) {
  return (
    <View style={styles.kv} accessible accessibilityLabel={`${label}, ${spoken ?? value}`}>
      <Text variant={bold ? 'headline' : 'callout'} color={bold ? 'text' : 'textSecondary'} style={styles.flex}>
        {label}
      </Text>
      <Text variant={bold ? 'headline' : 'callout'} tabular style={styles.kvValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: layout.sheetRadius, borderTopRightRadius: layout.sheetRadius, paddingTop: spacing.sm, maxHeight: '88%' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  headerSide: { width: 48, alignItems: 'flex-end' },
  headerTitle: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  leadHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: layout.page, paddingTop: spacing.xs, paddingBottom: spacing.lg },
  leadTitle: { flex: 1, gap: 2 },
  leadClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  hero: { marginBottom: spacing.sm },
  flexShrink: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { paddingHorizontal: layout.page, gap: spacing.md },
  sheetFooter: { paddingHorizontal: layout.page, paddingTop: spacing.lg, gap: spacing.sm },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  group: { gap: spacing.sm },
  groupTitle: { paddingHorizontal: spacing.xs },
  groupBox: { borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: layout.container - spacing.xs, overflow: 'hidden' },
  groupDivider: { height: StyleSheet.hairlineWidth },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill, alignSelf: 'flex-start' },
  track: { height: 10, borderRadius: 5, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  knob: { position: 'absolute', width: 26, height: 26, borderRadius: 13, marginLeft: -13, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  kvValue: { textAlign: 'right', flexShrink: 1 },
});
