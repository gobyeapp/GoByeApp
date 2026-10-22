import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  DRIVER_ACCESS_PACKAGES,
  LAGOS_DEFAULT_LOCATION,
  ABUJA_DEFAULT_LOCATION,
  canReceiveRequests,
  cancelTrip,
  completeTrip,
  confirmPinAndStart,
  draftStatus,
  driverLocationReducer,
  emptyApplication,
  hasActiveAccess,
  initialDriverLocationState,
  makeMockRequest,
  markArrived,
  mockPickupPin,
  mockTripHistory,
  pinAttemptsLeft,
  pointAlong,
  startTripFromRequest,
  submitApplication,
  subscribe,
  trackingIssues,
  tripErrorMessage,
  updateProfileFor,
  validateCounter,
  type DriverAccessPackage,
  type DriverApplication,
  type DriverLocationError,
  type DriverPayoutAccount,
  type DriverLocationEvent,
  type DriverLocationPermission,
  type DriverLocationState,
  type DriverSubscription,
  type DriverTrip,
  type IncomingRequest,
  type Kobo,
  type LatLng,
  type LocationFix,
  type Result,
  type TrackingIssue,
  type VerificationStatus,
} from '@gobye/core';
import { KEYS, readJson, writeJson } from './storage';
import { WEB_QA, readPermission, requestPermission, useLocationStream } from './location';
import { useSettings } from './settings';

/** Preview pacing (simulated review, request arrival, rider replies). Not product rules. */
const SIM = {
  reviewMs: 6000,
  firstRequestMs: [4000, 8000] as const,
  nextRequestMs: [7000, 14000] as const,
  riderReplyMs: [2500, 4500] as const,
  riderAcceptsCounter: 0.65,
  walletConfirmMs: 3000,
  packagePaymentMs: 1200,
};

interface Stored {
  application: DriverApplication;
  subscription: DriverSubscription | null;
  history: DriverTrip[];
  activeTrip: DriverTrip | null;
  primerSeen: boolean;
  /** History was seeded with simulated trips (labelled in the UI). */
  seeded: boolean;
  /** Where riders' bank transfers go (0% commission: straight to the driver). */
  payout: DriverPayoutAccount | null;
}

const INITIAL: Stored = { application: emptyApplication, subscription: null, history: [], activeTrip: null, primerSeen: false, seeded: false, payout: null };

export type CounterState = { amount: Kobo; status: 'waiting' | 'declined' } | null;

interface DriverValue {
  ready: boolean;
  /* Registration */
  application: DriverApplication;
  verification: VerificationStatus;
  updateApplication(patch: Partial<DriverApplication>): void;
  submitApplication(): Result<true>;
  /* Access */
  subscription: DriverSubscription | null;
  hasAccess: boolean;
  buyPackage(pkg: DriverAccessPackage): Promise<Result<DriverSubscription>>;
  /* Online / location */
  location: DriverLocationState;
  issues: TrackingIssue[];
  canReceive: boolean;
  position: LatLng;
  primerSeen: boolean;
  markPrimerSeen(): void;
  requestLocation(): Promise<DriverLocationPermission>;
  goOnline(): Promise<Result<true, DriverLocationError>>;
  goOffline(): Result<true, DriverLocationError>;
  /* Requests */
  request: IncomingRequest | null;
  counter: CounterState;
  acceptRequest(): Result<DriverTrip>;
  sendCounter(amount: Kobo): Result<true>;
  declineRequest(): void;
  /* Trip */
  activeTrip: DriverTrip | null;
  arrive(): Result<true>;
  confirmPin(pin: string): Result<true>;
  complete(): Result<true>;
  cancel(reason: 'rider_no_show' | 'driver_cancelled'): Result<true>;
  confirmPayment(): void;
  finishTrip(): void;
  /* History */
  history: DriverTrip[];
  historySeeded: boolean;
  payout: DriverPayoutAccount | null;
  setPayout(account: DriverPayoutAccount): void;
  /** Preview only: start again from an empty application. */
  resetPreview(): void;
}

const DriverContext = createContext<DriverValue | null>(null);

const between = ([a, b]: readonly [number, number]) => a + Math.random() * (b - a);

function locReducer(state: DriverLocationState, event: DriverLocationEvent | { type: 'RESTORE'; state: DriverLocationState }): DriverLocationState {
  if (event.type === 'RESTORE') return event.state;
  return driverLocationReducer(state, event).state;
}

/**
 * Everything the driver app knows about this driver: registration, access package, online state,
 * the simulated request feed, the active trip and trip history. Business rules come from @gobye/core;
 * this provider only sequences them and persists the result per account (`accountKey`).
 */
export function DriverProvider({ children, accountKey }: { children: ReactNode; accountKey: string }) {
  const { settings } = useSettings();
  const storeKey = `${KEYS.driver}.${accountKey}`;
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored>(INITIAL);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const [location, dispatchLoc] = useReducer(locReducer, initialDriverLocationState);
  const locRef = useRef(location);
  locRef.current = location;
  const [request, setRequest] = useState<IncomingRequest | null>(null);
  const [counter, setCounter] = useState<CounterState>(null);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Load (per account).
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, permission] = await Promise.all([readJson<Stored>(storeKey), readPermission()]);
      if (!alive) return;
      const next = { ...INITIAL, ...(s ?? {}) };
      setStored(next);
      // A trip survives an app restart: restore the matching tracking state (the driver is still working).
      const base = { ...initialDriverLocationState, permission, backgroundCapable: false };
      dispatchLoc({
        type: 'RESTORE',
        state: next.activeTrip && next.activeTrip.stage !== 'completed' && next.activeTrip.stage !== 'cancelled'
          ? { ...base, activity: next.activeTrip.stage === 'in_progress' ? 'on_trip' : 'to_pickup', hasActiveTrip: true, sessionActive: true, sessionStartedAt: Date.now() }
          : base,
      });
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [storeKey]);

  const persist = useCallback(
    (update: (prev: Stored) => Stored) => {
      setStored((prev) => {
        const next = update(prev);
        void writeJson(storeKey, next);
        return next;
      });
    },
    [storeKey],
  );

  // Clock for expiry checks (requests, stale fixes).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------- Registration ---------- */

  const application = stored.application;
  const verification = draftStatus(application);

  // Simulated review: approve a few seconds after submission and seed simulated history.
  useEffect(() => {
    if (application.status !== 'pending_review') return;
    const wait = Math.max(500, (application.submittedAt ?? Date.now()) + SIM.reviewMs - Date.now());
    const t = setTimeout(() => {
      persist((prev) => ({
        ...prev,
        application: { ...prev.application, status: 'approved' },
        history: prev.seeded ? prev.history : mockTripHistory(Date.now(), prev.application.vehicle?.category ?? 'go'),
        seeded: true,
      }));
    }, wait);
    return () => clearTimeout(t);
  }, [application.status, application.submittedAt, persist]);

  /* ---------- Position ---------- */

  const home = application.personal?.city === 'Abuja' ? ABUJA_DEFAULT_LOCATION : LAGOS_DEFAULT_LOCATION;
  const simulatedFix = useCallback((): LocationFix => {
    const t = storedRef.current.activeTrip;
    const at = Date.now();
    let p: LatLng = locRef.current.lastFix ?? home;
    if (t && t.stage === 'to_pickup') {
      const start = t.route.polyline[0] ? { latitude: t.pickup.coordinate.latitude + 0.012, longitude: t.pickup.coordinate.longitude - 0.01 } : home;
      const k = Math.min(0.96, (at - t.acceptedAt) / 60_000);
      p = pointAlong([start, t.pickup.coordinate], k);
    } else if (t && t.stage === 'arrived') {
      p = t.pickup.coordinate;
    } else if (t && t.stage === 'in_progress') {
      p = pointAlong(t.route.polyline, Math.min(0.98, (at - (t.startedAt ?? at)) / 90_000));
    }
    return { latitude: p.latitude, longitude: p.longitude, accuracyMeters: 12, at };
  }, [home]);

  useLocationStream({
    profile: updateProfileFor(location.activity),
    onFix: (fix) => dispatchLoc({ type: 'FIX', fix }),
    onInterrupted: () => dispatchLoc({ type: 'SESSION_INTERRUPTED' }),
    onResumed: () => dispatchLoc({ type: 'SESSION_RESUMED', now: Date.now() }),
    onPermission: (permission) => dispatchLoc({ type: 'PERMISSION_CHANGED', permission, backgroundCapable: false }),
    simulate: simulatedFix,
  });

  const position: LatLng = location.lastFix ?? (WEB_QA ? simulatedFix() : home);

  /* ---------- Access ---------- */

  const hasAccess = hasActiveAccess(stored.subscription, now);
  const buyPackage = useCallback(
    async (pkg: DriverAccessPackage): Promise<Result<DriverSubscription>> => {
      // Simulated payment: no money moves in the preview.
      await new Promise((r) => setTimeout(r, SIM.packagePaymentMs));
      const sub = subscribe(pkg, Date.now(), storedRef.current.subscription);
      persist((prev) => ({ ...prev, subscription: sub }));
      return { ok: true, value: sub };
    },
    [persist],
  );

  /* ---------- Online ---------- */

  const issues = trackingIssues(location, now);
  const receive = canReceiveRequests(location, now);
  const canReceive = receive.ok && hasAccess && !stored.activeTrip;

  const requestLocation = useCallback(async () => {
    const p = await requestPermission();
    dispatchLoc({ type: 'PERMISSION_CHANGED', permission: p, backgroundCapable: false });
    return p;
  }, []);

  const goOnline = useCallback(async (): Promise<Result<true, DriverLocationError>> => {
    let state = locRef.current;
    if (state.permission === 'undetermined') {
      const p = await requestPermission();
      state = driverLocationReducer(state, { type: 'PERMISSION_CHANGED', permission: p, backgroundCapable: false }).state;
      dispatchLoc({ type: 'PERMISSION_CHANGED', permission: p, backgroundCapable: false });
    }
    const r = driverLocationReducer(state, { type: 'GO_ONLINE', now: Date.now(), hasAccess: hasActiveAccess(storedRef.current.subscription, Date.now()) });
    if (r.error) return { ok: false, error: r.error };
    dispatchLoc({ type: 'GO_ONLINE', now: Date.now(), hasAccess: true });
    return { ok: true, value: true };
  }, []);

  const goOffline = useCallback((): Result<true, DriverLocationError> => {
    const r = driverLocationReducer(locRef.current, { type: 'GO_OFFLINE' });
    if (r.error) return { ok: false, error: r.error };
    dispatchLoc({ type: 'GO_OFFLINE' });
    setRequest(null);
    setCounter(null);
    return { ok: true, value: true };
  }, []);

  /* ---------- Simulated request feed ---------- */

  const firstRequest = useRef(true);
  useEffect(() => {
    if (!canReceive || request) return;
    const wait = between(firstRequest.current ? SIM.firstRequestMs : SIM.nextRequestMs);
    const t = setTimeout(() => {
      firstRequest.current = false;
      const seed = Math.floor(Math.random() * 1e6);
      const category = storedRef.current.application.vehicle?.category ?? 'go';
      const kind = settings.negotiationRequests ? undefined : 'quick_match';
      setRequest(makeMockRequest(seed, locRef.current.lastFix ?? home, Date.now(), category, kind));
      setCounter(null);
    }, wait);
    return () => clearTimeout(t);
  }, [canReceive, request, home, settings.negotiationRequests]);

  // Expire unanswered requests (a counter waiting for the rider keeps the request until they reply).
  useEffect(() => {
    if (!request || counter) return;
    const ms = request.expiresAt - Date.now();
    const t = setTimeout(() => setRequest((r) => (r?.id === request.id ? null : r)), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [request, counter]);

  const beginTrip = useCallback(
    (req: IncomingRequest, fare: Kobo): DriverTrip => {
      const seed = Number(req.id.replace(/\D/g, '')) || 1;
      const trip = startTripFromRequest(req, fare, Date.now(), mockPickupPin(seed));
      persist((prev) => ({ ...prev, activeTrip: trip }));
      dispatchLoc({ type: 'TRIP_ASSIGNED' });
      setRequest(null);
      setCounter(null);
      return trip;
    },
    [persist],
  );

  const acceptRequest = useCallback((): Result<DriverTrip> => {
    if (!request || request.expiresAt <= Date.now()) return { ok: false, error: 'This request has expired.' };
    return { ok: true, value: beginTrip(request, request.amount) };
  }, [request, beginTrip]);

  const sendCounter = useCallback(
    (amount: Kobo): Result<true> => {
      if (!request || request.expiresAt <= Date.now()) return { ok: false, error: 'This request has expired.' };
      const v = validateCounter(amount, request);
      if (!v.ok) return v;
      setCounter({ amount, status: 'waiting' });
      const req = request;
      later(() => {
        if (Math.random() < SIM.riderAcceptsCounter) beginTrip(req, amount);
        else setCounter({ amount, status: 'declined' });
      }, between(SIM.riderReplyMs));
      return { ok: true, value: true };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request, beginTrip],
  );

  const declineRequest = useCallback(() => {
    setRequest(null);
    setCounter(null);
  }, []);

  /* ---------- Trip ---------- */

  const activeTrip = stored.activeTrip;
  const setTrip = useCallback((trip: DriverTrip) => persist((prev) => ({ ...prev, activeTrip: trip })), [persist]);

  const arrive = useCallback((): Result<true> => {
    const t = storedRef.current.activeTrip;
    if (!t) return { ok: false, error: 'No active trip.' };
    const r = markArrived(t, Date.now());
    if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
    setTrip(r.value);
    return { ok: true, value: true };
  }, [setTrip]);

  const confirmPin = useCallback(
    (pin: string): Result<true> => {
      const t = storedRef.current.activeTrip;
      if (!t) return { ok: false, error: 'No active trip.' };
      const r = confirmPinAndStart(t, pin, Date.now());
      if (!r.ok) {
        setTrip(r.error.trip);
        return { ok: false, error: tripErrorMessage(r.error.error, pinAttemptsLeft(r.error.trip)) };
      }
      setTrip(r.value);
      dispatchLoc({ type: 'PASSENGER_PICKED_UP' });
      return { ok: true, value: true };
    },
    [setTrip],
  );

  const complete = useCallback((): Result<true> => {
    const t = storedRef.current.activeTrip;
    if (!t) return { ok: false, error: 'No active trip.' };
    const r = completeTrip(t, Date.now());
    if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
    setTrip(r.value);
    // Wallet payments are confirmed by the platform (simulated here); transfers wait for the driver to check.
    if (r.value.paymentMethod === 'wallet') {
      const id = r.value.id;
      later(() => persist((prev) => (prev.activeTrip?.id === id ? { ...prev, activeTrip: { ...prev.activeTrip, paymentStatus: 'confirmed' } } : prev)), SIM.walletConfirmMs);
    }
    return { ok: true, value: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTrip, persist]);

  const cancel = useCallback(
    (reason: 'rider_no_show' | 'driver_cancelled'): Result<true> => {
      const t = storedRef.current.activeTrip;
      if (!t) return { ok: false, error: 'No active trip.' };
      const r = cancelTrip(t, reason, Date.now());
      if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
      persist((prev) => ({ ...prev, activeTrip: null, history: [r.value, ...prev.history] }));
      dispatchLoc({ type: 'TRIP_ENDED' });
      return { ok: true, value: true };
    },
    [persist],
  );

  const confirmPayment = useCallback(() => {
    persist((prev) => (prev.activeTrip ? { ...prev, activeTrip: { ...prev.activeTrip, paymentStatus: 'confirmed' } } : prev));
  }, [persist]);

  const finishTrip = useCallback(() => {
    const t = storedRef.current.activeTrip;
    if (!t || t.stage !== 'completed') return;
    persist((prev) => ({ ...prev, activeTrip: null, history: [t, ...prev.history] }));
    dispatchLoc({ type: 'TRIP_ENDED' });
  }, [persist]);

  /* ---------- Value ---------- */

  const value = useMemo<DriverValue>(
    () => ({
      ready,
      application,
      verification,
      updateApplication: (patch) =>
        persist((prev) => {
          const next = { ...prev.application, ...patch };
          return { ...prev, application: { ...next, status: draftStatus(next) } };
        }),
      submitApplication: () => {
        const r = submitApplication(storedRef.current.application, Date.now());
        if (!r.ok) return r;
        persist((prev) => ({ ...prev, application: r.value }));
        return { ok: true, value: true };
      },
      subscription: stored.subscription,
      hasAccess,
      buyPackage,
      location,
      issues,
      canReceive,
      position,
      primerSeen: stored.primerSeen,
      markPrimerSeen: () => persist((prev) => ({ ...prev, primerSeen: true })),
      requestLocation,
      goOnline,
      goOffline,
      request,
      counter,
      acceptRequest,
      sendCounter,
      declineRequest,
      activeTrip,
      arrive,
      confirmPin,
      complete,
      cancel,
      confirmPayment,
      finishTrip,
      history: stored.history,
      historySeeded: stored.seeded,
      payout: stored.payout,
      setPayout: (payout) => persist((prev) => ({ ...prev, payout })),
      resetPreview: () => {
        dispatchLoc({ type: 'RESTORE', state: { ...initialDriverLocationState, permission: locRef.current.permission } });
        setRequest(null);
        setCounter(null);
        persist(() => INITIAL);
      },
    }),
    [ready, application, verification, persist, stored, hasAccess, buyPackage, location, issues, canReceive, position, requestLocation, goOnline, goOffline, request, counter, acceptRequest, sendCounter, declineRequest, activeTrip, arrive, confirmPin, complete, cancel, confirmPayment, finishTrip],
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

export function useDriver(): DriverValue {
  const v = useContext(DriverContext);
  if (!v) throw new Error('useDriver must be used inside <DriverProvider>');
  return v;
}

export { DRIVER_ACCESS_PACKAGES };
