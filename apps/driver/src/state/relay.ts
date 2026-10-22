import { createContext, useContext, useSyncExternalStore } from 'react';
import { createRelay, withRelayStatus, type Relay, type RelayStatus } from '@gobye/core';

/**
 * Demo relay connection (D-049). Set EXPO_PUBLIC_DEMO_RELAY_URL (and EXPO_PUBLIC_DEMO_RELAY_KEY for
 * Supabase) — `npm run demo:relay` writes it to apps/driver/.env.local — and the driver app shares its
 * application, requests and trips with the rider app and the admin. Without it the app runs on its own,
 * fully simulated, as before.
 */
const url = process.env.EXPO_PUBLIC_DEMO_RELAY_URL?.trim();
const key = process.env.EXPO_PUBLIC_DEMO_RELAY_KEY?.trim();

const configured = withRelayStatus(url ? createRelay({ url, key: key || undefined }) : null);

export interface RelayHandle {
  relay: Relay | null;
  status: RelayStatus;
}

export const defaultRelay: RelayHandle = configured;

/** Tests (and a future in-app switch) can provide another relay. */
export const RelayContext = createContext<RelayHandle>(defaultRelay);

export const useRelay = (): Relay | null => useContext(RelayContext).relay;

export function useRelayStatus() {
  const { status } = useContext(RelayContext);
  return useSyncExternalStore(status.subscribe, status.get, status.get);
}
