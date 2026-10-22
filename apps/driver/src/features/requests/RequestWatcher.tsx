import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useDriver } from '@/state/driver';
import { useHaptics, useSettings } from '@/state/settings';

/**
 * Opens an incoming request full screen wherever the driver is in the app (Quick Match → D11,
 * Negotiate → D12) and plays one strong haptic. Mounted once at the root.
 */
export function RequestWatcher() {
  const { request } = useDriver();
  const { settings } = useSettings();
  const haptic = useHaptics();
  const path = usePathname();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!request || shown.current === request.id) return;
    if (path.startsWith('/request') || path.startsWith('/negotiation')) return;
    shown.current = request.id;
    if (settings.requestAlerts) haptic('warning');
    router.push(request.kind === 'negotiate' ? `/negotiation/${request.id}` : `/request/${request.id}`);
  }, [request, path, haptic, settings.requestAlerts]);

  return null;
}
