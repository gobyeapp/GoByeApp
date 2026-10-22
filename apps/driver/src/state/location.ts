import * as Location from 'expo-location';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import type { DriverLocationPermission, LocationFix, UpdateProfile } from '@gobye/core';

/**
 * Device location for the driver app (D-026): When In Use + precise only. "Always" is never requested;
 * background updates need a development build with a foreground service, so `backgroundCapable` is false
 * in this preview and the app asks drivers to keep it open while online.
 *
 * The web build exists only for responsive QA: there, permission and fixes are simulated so the flows can
 * be exercised in a browser. Native builds always use the real GPS.
 */
export const WEB_QA = Platform.OS === 'web';

type IosAccuracy = { ios?: { accuracy?: string } };

function mapPermission(p: Location.LocationPermissionResponse): DriverLocationPermission {
  if (!p.granted) {
    if (p.status === Location.PermissionStatus.UNDETERMINED) return 'undetermined';
    return p.canAskAgain ? 'denied' : 'restricted';
  }
  const approximate = p.android?.accuracy === 'coarse' || (p as IosAccuracy).ios?.accuracy === 'reduced';
  return approximate ? 'when_in_use_approximate' : 'when_in_use_precise';
}

export async function readPermission(): Promise<DriverLocationPermission> {
  if (WEB_QA) return 'when_in_use_precise';
  try {
    return mapPermission(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

export async function requestPermission(): Promise<DriverLocationPermission> {
  if (WEB_QA) return 'when_in_use_precise';
  try {
    return mapPermission(await Location.requestForegroundPermissionsAsync());
  } catch {
    return 'denied';
  }
}

export const openLocationSettings = () => void Linking.openSettings();

/**
 * Streams fixes while `profile` is set (online or on a trip) and the app is in the foreground. When the
 * app goes to the background the session is reported interrupted (no background tracking in the preview).
 * `simulate` supplies positions on web QA.
 */
export function useLocationStream(params: {
  profile: UpdateProfile | null;
  onFix(fix: LocationFix): void;
  onInterrupted(): void;
  onResumed(): void;
  onPermission(p: DriverLocationPermission): void;
  simulate: () => LocationFix;
}) {
  const ref = useRef(params);
  ref.current = params;
  const active = !!params.profile;
  const interval = params.profile?.intervalMs ?? 0;
  const distance = params.profile?.distanceMeters ?? 0;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      if (WEB_QA) {
        ref.current.onFix(ref.current.simulate());
        timer = setInterval(() => ref.current.onFix(ref.current.simulate()), Math.min(interval, 3000));
        return;
      }
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: interval, distanceInterval: distance },
          (pos) => ref.current.onFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMeters: pos.coords.accuracy ?? 999, at: pos.timestamp }),
        );
        if (cancelled) sub.remove();
      } catch {
        ref.current.onInterrupted();
      }
    };
    void start();

    const appSub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        ref.current.onPermission(await readPermission());
        ref.current.onResumed();
      } else if (s === 'background' && !WEB_QA) {
        ref.current.onInterrupted();
      }
    });

    return () => {
      cancelled = true;
      sub?.remove();
      if (timer) clearInterval(timer);
      appSub.remove();
    };
  }, [active, interval, distance]);
}

/** Re-check permission whenever the app returns to the foreground (the driver may have changed it in Settings). */
export function usePermissionWatcher(onPermission: (p: DriverLocationPermission) => void) {
  const cb = useCallback(onPermission, [onPermission]);
  useEffect(() => {
    void readPermission().then(cb);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void readPermission().then(cb);
    });
    return () => sub.remove();
  }, [cb]);
}
