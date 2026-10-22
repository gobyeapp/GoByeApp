import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MOCK_PAYMENT_METHODS,
  enabledMethods,
  MOCK_SAVED_PLACES,
  mockNotifications,
  naira,
  type AppNotification,
  type Kobo,
  type PaymentMethod,
  type Place,
  type Rating,
  type SavedPlace,
  type SavedPlaceLabel,
  type TripReceipt,
} from '@gobye/core';
import { applyAppearance, type AppearancePreference, type BrandDirection } from '@gobye/ui';
import { KEYS, readJson, writeJson } from './storage';

/** Only settings that actually work in the build are kept (brief §13). */
export interface AccountSettings {
  haptics: boolean;
  /** Light / Dark / System, remembered (brief §1). */
  appearance: AppearancePreference;
  /** Preview-only palette comparison while the final palette is undecided (Q-008). */
  brandDirection: BrandDirection;
}

interface AccountData {
  history: TripReceipt[];
  ratings: Rating[];
  savedPlaces: SavedPlace[];
  recentPlaces: Place[];
  paymentMethods: PaymentMethod[];
  defaultPaymentId: string;
  notifications: AppNotification[];
  settings: AccountSettings;
  trustedContact: { name: string; phone: string } | null;
  supportRequests: { id: string; topic: string; message: string; createdAt: number }[];
}

function seed(): AccountData {
  const now = Date.now();
  return {
    history: [],
    ratings: [],
    savedPlaces: MOCK_SAVED_PLACES,
    recentPlaces: [],
    // Only launch-enabled methods (Q-001): wallet + bank transfer; cash hidden while undecided.
    paymentMethods: enabledMethods(MOCK_PAYMENT_METHODS),
    defaultPaymentId: 'pm-wallet',
    notifications: mockNotifications(now),
    settings: { haptics: true, appearance: 'system', brandDirection: 'jade' },
    trustedContact: null,
    supportRequests: [],
  };
}

interface AccountValue extends AccountData {
  ready: boolean;
  defaultPayment: PaymentMethod;
  unreadCount: number;
  addReceipt(r: TripReceipt): void;
  addRating(r: Rating): void;
  addRecentPlace(p: Place): void;
  savePlace(label: SavedPlaceLabel, place: Place, name?: string): void;
  removePlace(id: string): void;
  setDefaultPayment(id: string): void;
  markNotificationsRead(): void;
  updateSettings(patch: Partial<AccountSettings>): void;
  setTrustedContact(c: { name: string; phone: string } | null): void;
  addSupportRequest(topic: string, message: string): string;
  reset(): void;
}

const AccountContext = createContext<AccountValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AccountData>(seed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    readJson<AccountData>(KEYS.account).then((stored) => {
      // Payment methods always come from the current launch config, not from old stored data.
      if (stored) {
        const settings = { ...seed().settings, ...stored.settings };
        applyAppearance(settings.appearance);
        setData({ ...seed(), ...stored, settings, paymentMethods: seed().paymentMethods });
      }
      setReady(true);
    });
  }, []);

  const update = useCallback((fn: (d: AccountData) => AccountData) => {
    setData((prev) => {
      const next = fn(prev);
      void writeJson(KEYS.account, next);
      return next;
    });
  }, []);

  const value = useMemo<AccountValue>(() => {
    const defaultPayment = data.paymentMethods.find((m) => m.id === data.defaultPaymentId) ?? data.paymentMethods[0];
    return {
      ...data,
      ready,
      defaultPayment,
      unreadCount: data.notifications.filter((n) => !n.read).length,
      addReceipt: (r) =>
        update((d) => ({
          ...d,
          history: [r, ...d.history.filter((h) => h.bookingId !== r.bookingId)],
          notifications: [
            { id: `n-${r.bookingId}`, kind: 'trip', title: 'Trip complete', body: `Your trip to ${r.destination.title} is complete.`, createdAt: r.completedAt, read: false },
            ...d.notifications,
          ],
        })),
      addRating: (r) => update((d) => ({ ...d, ratings: [r, ...d.ratings.filter((x) => x.bookingId !== r.bookingId)] })),
      addRecentPlace: (p) => update((d) => ({ ...d, recentPlaces: [p, ...d.recentPlaces.filter((x) => x.title !== p.title)].slice(0, 5) })),
      savePlace: (label, place, name) =>
        update((d) => {
          const id = label === 'other' ? `sp-${Date.now()}` : `sp-${label}`;
          const entry: SavedPlace = { ...place, id, label, name: name ?? (label === 'home' ? 'Home' : label === 'work' ? 'Work' : place.title) };
          return { ...d, savedPlaces: [...d.savedPlaces.filter((p) => p.id !== id), entry] };
        }),
      removePlace: (id) => update((d) => ({ ...d, savedPlaces: d.savedPlaces.filter((p) => p.id !== id) })),
      setDefaultPayment: (id) => update((d) => ({ ...d, defaultPaymentId: id })),
      markNotificationsRead: () => update((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) })),
      updateSettings: (patch) => {
        if (patch.appearance) applyAppearance(patch.appearance);
        update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      },
      setTrustedContact: (c) => update((d) => ({ ...d, trustedContact: c })),
      addSupportRequest: (topic, message) => {
        const id = `SR-${Date.now().toString(36).toUpperCase()}`;
        update((d) => ({ ...d, supportRequests: [{ id, topic, message, createdAt: Date.now() }, ...d.supportRequests] }));
        return id;
      },
      reset: () => {
        const fresh = seed();
        setData(fresh);
        applyAppearance(fresh.settings.appearance);
        void writeJson(KEYS.account, null);
      },
    };
  }, [data, ready, update]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const a = useContext(AccountContext);
  if (!a) throw new Error('useAccount must be used inside <AccountProvider>');
  return a;
}

export const WALLET_TOP_UP_OPTIONS: Kobo[] = [naira(2000), naira(5000), naira(10000)];
