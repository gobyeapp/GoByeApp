import { Tabs } from 'expo-router';
import { FloatingTabBar, useTheme, type FloatingTabBarProps, type IconName } from '@gobye/ui';
import { useHaptics } from '@/state/settings';

const ICONS: Record<string, IconName> = { index: 'steering', earnings: 'chart', trips: 'activity', account: 'account' };

/** Driver tabs: Drive · Earnings · Trips · Account, on the same floating tray as the rider app (@gobye/ui). */
export default function TabsLayout() {
  const { colors } = useTheme();
  const haptic = useHaptics();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} icons={ICONS} onSelect={() => haptic('selection')} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Drive' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="trips" options={{ title: 'Trips' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
