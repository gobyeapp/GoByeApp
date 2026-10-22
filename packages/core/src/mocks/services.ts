import { haversineMeters, pointAlong } from '../geo';
import { kobo } from '../money';
import { MOCK_SERVICE_CONFIG, enabledCategories, walletSummary } from '../config';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import { createQuote } from '../pricing/fare';
import { realScheduler, type GoByeServices, type Scheduler, type Unsubscribe } from '../services/types';
import type { Booking, DriverResponse, Kobo, LatLng, Passenger, Place, PricingConfig, RouteEstimate, ServiceConfig, WalletTransaction } from '../types';
import { validateNigerianPhone, validateOtp } from '../validation';
import { MOCK_PAYMENT_METHODS, MOCK_PLACES, makeMockDriver, mockReferrals, mockWalletTransactions, seededRandom } from './data';

/**
 * MOCK SERVICES. Simulated latency, failures and Lagos geography. Every result that could be
 * mistaken for live data carries `isSimulated: true`. Not for production use.
 */

export interface MockFlags {
  /** Multiplies simulated durations; 1 = default demo pacing. */
  timeScale: number;
  /** Probability that Quick Match finds no drivers. */
  noDriversRate: number;
  /** Probability that a selected negotiating driver has become unavailable. */
  driverUnavailableRate: number;
  /** Probability that a bank transfer is not yet received when the passenger confirms it. */
  transferNotReceivedRate: number;
  /** Probability that the live driver feed pauses for a while during a trip (stale/reconnecting UI). */
  locationGapRate: number;
  /** Probability that a wallet deposit fails to confirm. */
  depositFailureRate: number;
  /** Network latency range in ms. */
  latency: [number, number];
}

export const DEFAULT_MOCK_FLAGS: MockFlags = {
  timeScale: 1,
  noDriversRate: 0.1,
  driverUnavailableRate: 0.15,
  transferNotReceivedRate: 0.15,
  locationGapRate: 0.35,
  depositFailureRate: 0.1,
  latency: [250, 900],
};

export interface MockOptions {
  scheduler?: Scheduler;
  random?: () => number;
  flags?: Partial<MockFlags>;
  config?: PricingConfig;
  serviceConfig?: ServiceConfig;
  /** Optional persistence for the simulated wallet ledger (the app passes AsyncStorage). */
  walletStore?: { load(): Promise<WalletTransaction[] | null>; save(list: WalletTransaction[]): void };
}

/** Road-distance factor and average Lagos traffic speed used for simulated routes. */
const ROAD_FACTOR = 1.35;
const AVG_SPEED_MPS = 22_000 / 3600;

export function simulateRoute(from: LatLng, to: LatLng): RouteEstimate {
  const straight = haversineMeters(from, to);
  // An L-shaped path with a slight bend reads as a road route on the map without pretending to be one.
  const corner: LatLng = { latitude: from.latitude, longitude: to.longitude };
  const mid1 = pointAlong([from, corner], 0.5);
  const mid2 = pointAlong([corner, to], 0.5);
  const polyline = [from, mid1, { latitude: corner.latitude + (to.latitude - from.latitude) * 0.08, longitude: corner.longitude }, mid2, to];
  const distanceMeters = Math.max(300, Math.round(straight * ROAD_FACTOR));
  const durationSeconds = Math.max(120, Math.round(distanceMeters / AVG_SPEED_MPS));
  return { distanceMeters, durationSeconds, polyline, isSimulated: true };
}

export function createMockServices(options: MockOptions = {}): GoByeServices {
  const scheduler = options.scheduler ?? realScheduler;
  const random = options.random ?? Math.random;
  const flags: MockFlags = { ...DEFAULT_MOCK_FLAGS, ...options.flags };
  const config = options.config ?? MOCK_PRICING_CONFIG;
  const serviceConfig = options.serviceConfig ?? MOCK_SERVICE_CONFIG;
  const enabledIds = () => new Set(enabledCategories(serviceConfig).map((c) => c.id));

  // Simulated wallet ledger, shared by the wallet and payments mocks.
  let ledger: WalletTransaction[] | null = null;
  const getLedger = async () => {
    if (!ledger) ledger = (await options.walletStore?.load()) ?? mockWalletTransactions(scheduler.now());
    return ledger;
  };
  const saveLedger = (next: WalletTransaction[]) => {
    ledger = next;
    options.walletStore?.save(next);
  };
  const idRand = seededRandom(Math.floor(random() * 1e9));
  const newId = (prefix: string) => `${prefix}-${scheduler.now().toString(36)}-${Math.floor(idRand() * 1e8).toString(36)}`;

  const delay = <T,>(value: T, ms?: number) =>
    new Promise<T>((resolve) => {
      const [lo, hi] = flags.latency;
      scheduler.setTimeout(() => resolve(value), ms ?? lo + random() * (hi - lo));
    });

  /** Drivers currently assigned to a trip — prevents duplicate assignment (BR-047). */
  const busyDrivers = new Set<string>();
  const knownUsers = new Map<string, Passenger>();

  const schedule = (timers: unknown[], fn: () => void, ms: number) => {
    timers.push(scheduler.setTimeout(fn, ms * flags.timeScale));
  };
  const clearAll = (timers: unknown[]) => timers.forEach((t) => scheduler.clearTimeout(t));

  return {
    config: {
      async getServiceConfig() {
        return delay(serviceConfig, 300);
      },
    },

    wallet: {
      async listTransactions() {
        const list = await getLedger();
        return delay(list.slice().sort((a, b) => b.createdAt - a.createdAt));
      },
      async requestDeposit(amount) {
        const list = await getLedger();
        const tx: WalletTransaction = { id: newId('dep'), type: 'top_up', status: 'pending', amount, createdAt: scheduler.now(), description: 'Deposit by bank transfer' };
        saveLedger([tx, ...list]);
        return delay({
          transactionId: tx.id,
          bankName: 'GoBye Demo Bank (simulated)',
          accountNumber: `99${String(10_000_000 + Math.floor(random() * 89_999_999))}`,
          accountName: 'GoBye Wallet (Preview)',
          amount,
          reference: tx.id.toUpperCase(),
          expiresAt: scheduler.now() + 30 * 60 * 1000,
          isSimulated: true,
        });
      },
      async checkDeposit(transactionId) {
        const list = await getLedger();
        const tx = list.find((t) => t.id === transactionId);
        if (!tx) return delay('failed' as const);
        if (tx.status === 'pending' && scheduler.now() - tx.createdAt > 4000 * flags.timeScale) {
          const status = random() < flags.depositFailureRate ? ('failed' as const) : ('successful' as const);
          saveLedger(list.map((t) => (t.id === transactionId ? { ...t, status } : t)));
          return delay(status);
        }
        return delay(tx.status);
      },
    },

    referrals: {
      async listReferrals() {
        return delay(mockReferrals(scheduler.now(), serviceConfig.referral.referrerReward));
      },
    },

    auth: {
      async requestOtp(phone) {
        const v = validateNigerianPhone(phone);
        if (!v.ok) return delay(v);
        return delay({ ok: true as const, value: { phone: v.value, resendAfterSeconds: 30, isSimulated: true } });
      },
      async verifyOtp(phone, code) {
        const v = validateOtp(code);
        if (!v.ok) return delay(v);
        if (code === '000000') return delay({ ok: false as const, error: 'Wrong code. Check the SMS and try again.' });
        const existing = knownUsers.get(phone);
        const user: Passenger = existing ?? {
          id: newId('usr'),
          role: 'passenger',
          firstName: '',
          lastName: '',
          phone,
          rating: 5,
          createdAt: scheduler.now(),
        };
        knownUsers.set(phone, user);
        return delay({ ok: true as const, value: { token: newId('tok'), user, isNewUser: !existing || !user.firstName } });
      },
      async updateProfile(_token, profile, current?: Passenger) {
        // The in-memory map is empty after an app restart; fall back to the signed-in user the app holds.
        const user = [...knownUsers.values()].pop() ?? current;
        if (!user) return delay({ ok: false as const, error: 'Session expired. Sign in again.' });
        const updated: Passenger = { ...user, ...profile };
        knownUsers.set(user.phone, updated);
        return delay({ ok: true as const, value: updated });
      },
      async requestAccountDeletion() {
        return delay({ ok: true as const, value: { requestId: newId('del'), isSimulated: true } });
      },
      async signOut() {
        await delay(undefined, 150);
      },
    },

    maps: {
      async searchPlaces(query, near) {
        const q = query.trim().toLowerCase();
        const results = q
          ? MOCK_PLACES.filter((p) => `${p.title} ${p.subtitle}`.toLowerCase().includes(q))
          : MOCK_PLACES.slice();
        if (near) results.sort((a, b) => haversineMeters(near, a.coordinate) - haversineMeters(near, b.coordinate));
        return delay(results.slice(0, 8), 200 + random() * 300);
      },
      async reverseGeocode(coordinate) {
        const nearest = MOCK_PLACES.slice().sort(
          (a, b) => haversineMeters(coordinate, a.coordinate) - haversineMeters(coordinate, b.coordinate),
        )[0];
        const place: Place = {
          id: newId('geo'),
          title: haversineMeters(coordinate, nearest.coordinate) < 400 ? nearest.title : `Near ${nearest.title}`,
          subtitle: nearest.subtitle,
          coordinate,
        };
        return delay(place, 300);
      },
      async getRoute(from, to) {
        return delay(simulateRoute(from, to));
      },
    },

    pricing: {
      async quoteAll(route) {
        const now = scheduler.now();
        // Only admin-enabled categories are quoted (launch: one car category).
        return delay(enabledCategories(serviceConfig).map((c) => createQuote({ id: newId('q'), route, category: c.id, config, now })));
      },
      async quote(route, category) {
        return delay(createQuote({ id: newId('q'), route, category, config, now: scheduler.now() }));
      },
      async availability() {
        return delay(
          enabledCategories(serviceConfig).map((c) => ({
            category: c.id,
            available: enabledIds().has(c.id),
            pickupEtaSeconds: Math.round(180 + random() * 360),
          })),
        );
      },
    },

    matching: {
      startQuickMatch(booking, listener): Unsubscribe {
        const timers: unknown[] = [];
        schedule(
          timers,
          () => {
            if (random() < flags.noDriversRate) return listener({ type: 'no_drivers' });
            let driver = makeMockDriver(Math.floor(random() * 12), booking.quote.category, booking.pickup.coordinate, random);
            while (busyDrivers.has(driver.id)) driver = makeMockDriver(Math.floor(random() * 12), booking.quote.category, booking.pickup.coordinate, random);
            busyDrivers.add(driver.id);
            listener({ type: 'matched', driver });
          },
          3500 + random() * 3500,
        );
        return () => clearAll(timers);
      },

      openNegotiation(booking, offer, listener): Unsubscribe {
        const timers: unknown[] = [];
        const { suggested, negotiationRange } = booking.quote;
        const step = config.negotiation.stepKobo;
        const ratio = offer.amount / suggested;
        // Lower offers attract fewer, slower and more counter-heavy responses.
        const count = ratio >= 1 ? 4 : ratio >= 0.9 ? 3 : ratio >= 0.8 ? 2 : 1 + (random() < 0.5 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          schedule(
            timers,
            () => {
              const now = scheduler.now();
              const driver = makeMockDriver(i + offer.round * 4, booking.quote.category, booking.pickup.coordinate, random);
              const counter = random() < Math.min(0.85, Math.max(0.15, 1.2 - ratio));
              const bump = (1 + Math.floor(random() * 4)) * step;
              const amount = counter ? kobo(Math.min(negotiationRange.max, offer.amount + bump)) : offer.amount;
              const response: DriverResponse = {
                id: newId('resp'),
                offerId: offer.id,
                driver,
                kind: amount === offer.amount ? 'accept' : 'counter',
                amount,
                etaSeconds: Math.round(120 + haversineMeters(driver.coordinate, booking.pickup.coordinate) / 7),
                createdAt: now,
                expiresAt: now + config.negotiation.responseTtlSeconds * 1000,
              };
              listener({ type: 'response', response });
            },
            1800 + i * (2200 + random() * 2500),
          );
        }
        return () => clearAll(timers);
      },

      isDriverAvailable(driverId) {
        if (busyDrivers.has(driverId)) return false;
        if (random() < flags.driverUnavailableRate) return false;
        busyDrivers.add(driverId);
        return true;
      },

      releaseDriver(driverId) {
        busyDrivers.delete(driverId);
      },
    },

    trips: {
      follow(booking: Booking, listener): Unsubscribe {
        const timers: unknown[] = [];
        if (!booking.driver) return () => undefined;
        const pickup = booking.pickup.coordinate;
        const approach = [booking.driver.coordinate, pickup];
        const approachMs = 24000;
        const tripMs = 22000;
        const ticks = 16;
        const status = booking.status;

        // ETA comes from the remaining distance (road factor 1.35, ~22 km/h), not a decorative countdown.
        const approachEta = Math.max(60, Math.round((haversineMeters(booking.driver.coordinate, pickup) * ROAD_FACTOR) / AVG_SPEED_MPS));
        // Optionally drop a run of fixes to exercise the stale / reconnecting state.
        const gap = random() < flags.locationGapRate ? { from: 6, to: 14 } : null;
        if (status === 'matched' || status === 'driver_en_route') {
          for (let i = 1; i <= ticks; i++) {
            const t = i / ticks;
            if (gap && i === gap.from) schedule(timers, () => listener({ type: 'feed_paused' }), (approachMs * i) / ticks);
            if (gap && i >= gap.from && i < gap.to) continue;
            schedule(
              timers,
              () => listener({ type: 'driver_location', coordinate: pointAlong(approach, t), etaSeconds: Math.round((1 - t) * approachEta) }),
              (approachMs * i) / ticks,
            );
          }
          schedule(timers, () => listener({ type: 'driver_arrived' }), approachMs + 400);
        }
        const startOffset = status === 'driver_arrived' ? 0 : approachMs + 400;
        if (status !== 'in_progress') {
          // The (simulated) driver confirms the passenger and starts the trip.
          schedule(timers, () => listener({ type: 'trip_started' }), startOffset + 7000);
        }
        const tripOffset = status === 'in_progress' ? 0 : startOffset + 7000;
        for (let i = 1; i <= ticks; i++) {
          const t = i / ticks;
          schedule(
            timers,
            () =>
              listener({
                type: 'driver_location',
                coordinate: pointAlong(booking.route.polyline, t),
                etaSeconds: Math.round((1 - t) * booking.route.durationSeconds),
              }),
            tripOffset + (tripMs * i) / ticks,
          );
        }
        schedule(timers, () => listener({ type: 'trip_completed' }), tripOffset + tripMs + 500);
        return () => clearAll(timers);
      },
    },

    payments: {
      async listMethods() {
        return delay(MOCK_PAYMENT_METHODS.slice(), 200);
      },
      async charge({ bookingId, method, amount, idempotencyKey }) {
        const reference = `sim_${idempotencyKey}`;
        if (method.type === 'wallet') {
          const list = await getLedger();
          // Idempotent per booking: a retried request (e.g. after an app restart mid-payment) never debits twice.
          if (list.some((t) => t.bookingId === bookingId && t.type === 'ride_payment' && t.status === 'successful')) {
            return delay({ status: 'paid' as const, reference, isSimulated: true }, 600);
          }
          if (walletSummary(list).available < amount) {
            return delay({ status: 'failed' as const, reference, failureReason: 'Not enough in your wallet. Add money or pay by transfer.', isSimulated: true }, 900);
          }
          const tx: WalletTransaction = { id: newId('wt'), type: 'ride_payment', status: 'successful', amount: -amount as Kobo, createdAt: scheduler.now(), description: 'Trip payment', bookingId };
          saveLedger([tx, ...list]);
          return delay({ status: 'paid' as const, reference, isSimulated: true }, 1200 + random() * 600);
        }
        // Bank transfer: "I've sent it" only starts verification; paid only when receipt is confirmed.
        const notSeen = method.type === 'bank_transfer' && random() < flags.transferNotReceivedRate;
        return delay(
          {
            status: notSeen ? ('not_received' as const) : ('paid' as const),
            reference,
            failureReason: notSeen ? 'We haven’t seen your transfer yet (simulated). Transfers can take a few minutes.' : undefined,
            isSimulated: true,
          },
          2500 + random() * 1500,
        );
      },
    },
  };
}
