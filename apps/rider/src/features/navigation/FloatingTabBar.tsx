import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { FloatingTabBar as SharedTabBar, type FloatingTabBarProps, type IconName } from '@gobye/ui';
import { useHaptics } from '@/state/haptics';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, IconName> = { index: 'home', activity: 'activity', wallet: 'wallet', account: 'account' };

/** Rider tabs: Home · Activities · Wallet · Account, on the shared floating tray from @gobye/ui. */
export function FloatingTabBar(props: TabBarProps) {
  const haptic = useHaptics();
  return <SharedTabBar {...(props as unknown as FloatingTabBarProps)} icons={ICONS} onSelect={() => haptic('selection')} />;
}
