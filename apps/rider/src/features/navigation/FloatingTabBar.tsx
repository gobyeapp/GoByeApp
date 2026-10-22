import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text, shadows, spacing, useTheme, type IconName } from '@gobye/ui';
import { useHaptics } from '@/state/haptics';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, IconName> = { index: 'home', activity: 'activity', wallet: 'wallet', account: 'account' };

/**
 * Floating navigation (wallet reference): a compact rounded tray that sits above the home indicator on
 * the page background. Selected item = brand colour (aubergine in light, tangerine in dark) + filled icon
 * + semibold label, so the selection never relies on colour alone. Labels stay visible (Home · Activities ·
 * Wallet · Account). The bar is in normal layout flow, so it never covers screen content.
 */
export function FloatingTabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const { colors, scheme } = useTheme();
  const haptic = useHaptics();
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
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              haptic('selection');
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
                <Icon name={ICONS[route.name] ?? 'home'} variant={focused ? 'filled' : 'regular'} color={tint} />
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

