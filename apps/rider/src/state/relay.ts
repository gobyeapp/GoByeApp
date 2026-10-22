import { useSyncExternalStore } from 'react';
import { createRelay, withRelayStatus, type Relay, type RelayRider, type RelayStatus } from '@gobye/core';

/**
 * Demo relay connection (D-049). Only when EXPO_PUBLIC_DEMO_RELAY_URL is set (written by
 * `npm run demo:relay` into apps/rider/.env.local) does the app share rides and its account with the
 * driver app and the admin. Without it everything stays on this phone, simulated, as before.
 */
const URL = process.env.EXPO_PUBLIC_DEMO_RELAY_URL?.trim();
const KEY = process.env.EXPO_PUBLIC_DEMO_RELAY_KEY?.trim();

const built = withRelayStatus(URL ? createRelay({ url: URL, key: KEY || undefined }) : null);

/** The shared relay, or null when the app runs on its own. */
export const relay: Relay | null = built.relay;
export const relayStatus: RelayStatus = built.status;

/** Re-renders when the connection changes (online / offline / connecting / off). */
export function useRelayStatus() {
  return useSyncExternalStore(relayStatus.subscribe, relayStatus.get, relayStatus.get);
}

/** Who is booking, for ride rows (set by the session; null when signed out). */
let currentRider: RelayRider | null = null;
export const getRelayRider = () => currentRider;
export function setRelayRider(r: RelayRider | null) {
  currentRider = r;
}
