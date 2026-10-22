import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyAppearance, type AppearancePreference } from '@gobye/ui';
import { KEYS, readJson, writeJson } from './storage';

export interface DriverSettings {
  haptics: boolean;
  appearance: AppearancePreference;
  /** Show negotiation requests as well as Quick Match (drivers can opt out of haggling). */
  negotiationRequests: boolean;
  /** Spoken/sounded alert for new requests (preview: haptic only). */
  requestAlerts: boolean;
}

const DEFAULTS: DriverSettings = { haptics: true, appearance: 'system', negotiationRequests: true, requestAlerts: true };

interface SettingsValue {
  ready: boolean;
  settings: DriverSettings;
  updateSettings(patch: Partial<DriverSettings>): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** Device preferences (non-sensitive, AsyncStorage). Appearance is applied before the splash hides. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<DriverSettings>(DEFAULTS);

  useEffect(() => {
    readJson<Partial<DriverSettings>>(KEYS.settings).then((s) => {
      const merged = { ...DEFAULTS, ...(s ?? {}) };
      setSettings(merged);
      applyAppearance(merged.appearance);
      setReady(true);
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<DriverSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void writeJson(KEYS.settings, next);
      if (patch.appearance) applyAppearance(patch.appearance);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ready, settings, updateSettings }), [ready, settings, updateSettings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('useSettings must be used inside <SettingsProvider>');
  return v;
}

type Feedback = 'selection' | 'success' | 'warning' | 'error' | 'impact';

/** Standard haptic meanings (Apple HIG); respects the driver's Settings toggle. */
export function useHaptics() {
  const { settings } = useSettings();
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
            return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      };
      run()?.catch(() => undefined);
    },
    [settings.haptics],
  );
}
