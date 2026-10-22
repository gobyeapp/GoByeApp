import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../../icons/Icon';
import { shadows, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Text } from '../Text';

/**
 * Structural subset of React Navigation's bottom-tab bar props, so the design system does not depend on
 * expo-router. Pass the props expo-router's `<Tabs tabBar>` gives you straight through.
 */
export interface FloatingTabBarProps {
  state: { index: number; routes: { key: string; name: string; params?: object }[] };
  descriptors: Record<string, { options: { title?: string; tabBarBadge?: string | number } }>;
  navigation: {
    emit(e: { type: 'tabPress' | 'tabLongPress'; target: string; canPreventDefault?: boolean }): { defaultPrevented?: boolean } | unknown;
    navigate(name: string, params?: object): void;
  };
  insets: { bottom: number };
  /** Route name → MingCute icon. */
  icons: Record<string, IconName>;
  /** Called when a different tab is chosen (apps play their selection haptic here). */
  onSelect?: () => void;
}

/**
 * Floating navigation shared by the rider and driver apps (wallet reference): a compact rounded tray
 * above the home indicator. Selected item = brand colour + filled icon + semibold label, so the selection
 * never relies on colour alone. The bar is in normal layout flow, so it never covers screen content.
 */
export function FloatingTabBar({ state, descriptors, navigation, insets, icons, onSelect }: FloatingTabBarProps) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.tray,
          { backgroundColor: colors.navSurface, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 },
          scheme === 'light' && shadows.card,
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key].options;
          const label = String(options.title ?? route.name);
          const badge = options.tabBarBadge;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }) as { defaultPrevented?: boolean };
            if (!focused && !event?.defaultPrevented) {
              onSelect?.();
              navigation.navigate(route.name, route.params);
            }
          };
          const tint = focused ? colors.navActive : colors.textSecondary;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge ? `${label}, ${badge} new` : label}
              testID={`tab-${route.name}`}
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
            >
              <View>
                <Icon name={icons[route.name] ?? 'home'} variant={focused ? 'filled' : 'regular'} color={tint} />
                {badge ? (
                  <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.navSurface }]}>
                    <Text variant="caption" style={[styles.badgeText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.2}>
                      {String(badge)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="caption" weight={focused ? 'semibold' : 'medium'} style={{ color: tint }} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  tray: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 420, borderRadius: 28, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52, paddingVertical: spacing.xs },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { fontSize: 10, lineHeight: 12 },
});
