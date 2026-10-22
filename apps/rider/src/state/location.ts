import * as Location from 'expo-location';
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { LAGOS_DEFAULT_LOCATION, type LatLng } from '@gobye/core';

export type PermissionState = 'unknown' | 'undetermined' | 'granted' | 'denied' | 'restricted';

export interface CurrentLocation {
  permission: PermissionState;
  /** True when the user granted only approximate location (iOS reduced accuracy / Android coarse). */
  approximate: boolean;
  coordinate: LatLng | null;
  accuracyMeters: number | null;
  loading: boolean;
  error: string | null;
  request(): Promise<PermissionState>;
  /** Gets a fresh fix; resolves with it, or null when the position couldn't be read. */
  refresh(): Promise<LatLng | null>;
  openSettings(): void;
}

/**
 * Rider location — foreground ("When In Use") only (decision D-012). Never requested at launch:
 * `request()` is called from the pre-permission screen when the user engages pickup.
 */
function useLocationState(): CurrentLocation {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [approximate, setApproximate] = useState(false);
  const [coordinate, setCoordinate] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapStatus = (p: Location.LocationPermissionResponse): PermissionState => {
    if (p.granted) return 'granted';
    if (p.status === Location.PermissionStatus.UNDETERMINED) return 'undetermined';
    return p.canAskAgain ? 'denied' : 'restricted';
  };

  const refresh = useCallback(async (): Promise<LatLng | null> => {
    setLoading(true);
    setError(null);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoordinate(c);
      setAccuracy(pos.coords.accuracy ?? null);
      return c;
    } catch {
      setError('We couldn’t get your location. Check that location services are on, or set your pickup manually.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((p) => {
        const s = mapStatus(p);
        setPermission(s);
        // Android exposes coarse vs fine; iOS reduced accuracy is not surfaced by expo-location's permission response.
        setApproximate(p.android?.accuracy === 'coarse');
        if (s === 'granted') void refresh();
      })
      .catch(() => setPermission('undetermined'));
  }, [refresh]);

  const request = useCallback(async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    const s = mapStatus(p);
    setPermission(s);
    setApproximate(p.android?.accuracy === 'coarse');
    if (s === 'granted') await refresh();
    return s;
  }, [refresh]);

  return {
    permission,
    approximate,
    coordinate,
    accuracyMeters: accuracy,
    loading,
    error,
    request,
    refresh,
    openSettings: () => void Linking.openSettings(),
  };
}

/** Map centre to use when the device location is unavailable (simulated city centre). */
export const FALLBACK_CENTER = LAGOS_DEFAULT_LOCATION;

const LocationContext = createContext<CurrentLocation | null>(null);

/** Shares one permission/position state across screens. */
export function LocationProvider({ children }: { children: ReactNode }) {
  const value = useLocationState();
  return createElement(LocationContext.Provider, { value }, children);
}

export function useCurrentLocation(): CurrentLocation {
  const v = useContext(LocationContext);
  if (!v) throw new Error('useCurrentLocation must be used inside <LocationProvider>');
  return v;
}
