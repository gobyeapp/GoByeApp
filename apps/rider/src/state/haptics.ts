import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useAccount } from './account';

type Feedback = 'selection' | 'success' | 'warning' | 'error' | 'impact';

/** Standard haptic meanings (Apple HIG "Playing haptics"); respects the user's Settings toggle. */
export function useHaptics() {
  const { settings } = useAccount();
  return useCallback(
    (kind: Feedback) => {
      if (!settings.haptics) return;
      const run = () => {
        switch (kind) {
          case 'selection':
            return Haptics.selectionAsync();
          case 'success':
            return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          case 'warning':
            return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          case 'error':
            return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          case 'impact':
            return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      };
      run()?.catch(() => undefined);
    },
    [settings.haptics],
  );
}
