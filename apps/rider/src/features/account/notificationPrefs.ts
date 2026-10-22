import { useCallback, useEffect, useState } from 'react';
import { readJson, writeJson } from '@/state/storage';

/** Supported alert categories. Safety alerts are always on and not stored. */
export interface NotificationPrefs {
  trips: boolean;
  payments: boolean;
  offers: boolean;
  sounds: boolean;
}

export const NOTIFICATION_PREFS_KEY = 'gobye.notificationPrefs';
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { trips: true, payments: true, offers: true, sounds: true };

/** Notification preferences kept on this device (push delivery is not live in the preview). */
export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readJson<Partial<NotificationPrefs>>(NOTIFICATION_PREFS_KEY).then((saved) => {
      if (!active) return;
      if (saved) setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...saved });
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((patch: Partial<NotificationPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void writeJson(NOTIFICATION_PREFS_KEY, next);
      return next;
    });
  }, []);

  return { prefs, update, ready };
}
