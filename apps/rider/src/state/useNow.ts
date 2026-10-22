import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * A ticking clock for countdowns and expiry checks. Expiry is always derived from timestamps
 * (`expiresAt <= now`), so after the app returns from the background the next tick shows the
 * correct state immediately.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs, enabled]);
  return now;
}
