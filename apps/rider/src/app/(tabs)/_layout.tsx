import { Tabs } from 'expo-router';
import { useTheme } from '@gobye/ui';
import { FloatingTabBar } from '@/features/navigation/FloatingTabBar';

/**
 * Bottom navigation, exactly: Home · Activities · Wallet · Account (brief §13).
 * Expo Router JS tabs (D-003) with GoBye's floating tray (wallet reference): MingCute Regular inactive,
 * Filled selected; the selected item uses the brand colour (D-035). No tab badges: unread notifications
 * show once, on the bell.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activities' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
