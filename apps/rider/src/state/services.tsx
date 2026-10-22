import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createMockServices, createRelayMatching, createRelayTrips, type GoByeServices, type MockAccount, type WalletTransaction } from '@gobye/core';
import { getRelayRider, relay } from './relay';
import { KEYS, readJson, writeJson } from './storage';

const WALLET_KEY = KEYS.mockWallet;
/** Persists the simulated wallet ledger so balances survive restarts in the preview. */
const walletStore = {
  load: () => readJson<WalletTransaction[]>(WALLET_KEY),
  save: (list: WalletTransaction[]) => void writeJson(WALLET_KEY, list),
};

/** Preview only: simulated accounts persist on the device so email/phone + password sign-in works after a restart. */
const authStore = {
  load: () => readJson<MockAccount[]>(KEYS.mockAccounts),
  save: (list: MockAccount[]) => void writeJson(KEYS.mockAccounts, list),
};

/**
 * Service container. The app only sees the GoByeServices interfaces.
 * Today: mock implementations (simulated latency, drivers, payments).
 * Later: an HTTP/WebSocket implementation that satisfies the same interfaces (docs/API_CONTRACTS.md).
 */
const ServicesContext = createContext<GoByeServices | null>(null);

export function ServicesProvider({ children, services }: { children: ReactNode; services?: GoByeServices }) {
  const value = useMemo(() => {
    if (services) return services;
    const mock = createMockServices({ walletStore, authStore });
    // Demo relay connected (D-049): real drivers in the driver app take the ride; nobody online → "no drivers".
    return relay ? { ...mock, matching: createRelayMatching(relay, { rider: getRelayRider }), trips: createRelayTrips(relay) } : mock;
  }, [services]);
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): GoByeServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}
