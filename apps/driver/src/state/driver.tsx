import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  DRIVER_ACCESS_PACKAGES,
  LAGOS_DEFAULT_LOCATION,
  ABUJA_DEFAULT_LOCATION,
  applicationRow,
  claimRide,
  haversineMeters,
  logRelayEvent,
  mergeReview,
  openRidesForDriver,
  personRow,
  poll,
  queuedChecks,
  resolveIssuesForStep,
  resubmitApplication,
  responseRow,
  rideToRequest,
  simulatedReview,
  canReceiveRequests,
  cancelTrip,
  completeTrip,
  confirmPinAndStart,
  draftStatus,
  driverLocationReducer,
  emptyApplication,
  emptySubscriptionState,
  initialDriverLocationState,
  makeMockRequest,
  markArrived,
  mockPickupPin,
  mockTripHistory,
  pinAttemptsLeft,
  pointAlong,
  startTripFromRequest,
  submitApplication,
  recordPassPayment,
  subscriptionStateFromLegacy,
  subscriptionTimelineResponse,
  trackingIssues,
  tripErrorMessage,
  updateProfileFor,
  validateCounter,
  type DriverAccessPackage,
  type DriverApplication,
  type DriverSummary,
  type OnboardingStepId,
  type RelayApplication,
  type RelayRide,
  type Unsubscribe,
  type DriverLocationError,
  type DriverPayoutAccount,
  type DriverLocationEvent,
  type DriverLocationPermission,
  type DriverLocationState,
  type DriverSubscription,
  type SubscriptionPassView,
  type SubscriptionState,
  type SubscriptionTimelineResponse,
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
import { useRelay } from './relay';
import { useSession } from './session';
import { useSettings } from './settings';

/** Preview pacing (simulated review, request arrival, rider replies). Not product rules. */
const SIM = {
  firstRequestMs: [4000, 8000] as const,
  nextRequestMs: [7000, 14000] as const,
  riderReplyMs: [2500, 4500] as const,
  riderAcceptsCounter: 0.65,
  walletConfirmMs: 3000,
  packagePaymentMs: 1200,
};

interface Stored {
  application: DriverApplication;
  /** The driver's pass timeline (D-058). In production this is read from `GET /v1/drivers/{id}/subscription`. */
  passes: SubscriptionState;
  /** @deprecated Pre-D-058 single pass; migrated into `passes` on load. */
  subscription?: DriverSubscription | null;
  history: DriverTrip[];
  activeTrip: DriverTrip | null;
  primerSeen: boolean;
  /** History was seeded with simulated trips (labelled in the UI). */
  seeded: boolean;
  /** Where riders' bank transfers go (0% commission: straight to the driver). */
  payout: DriverPayoutAccount | null;
  /** The demo-relay ride behind the active trip (D-049); null for a simulated trip. */
  activeRide: string | null;
}

const SELF = 'self';
const INITIAL: Stored = { application: emptyApplication, passes: emptySubscriptionState(SELF), history: [], activeTrip: null, primerSeen: false, seeded: false, payout: null, activeRide: null };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type CounterState = { amount: Kobo; status: 'waiting' | 'declined' } | null;

interface DriverValue {
  ready: boolean;
  /* Registration */
  application: DriverApplication;
  verification: VerificationStatus;
  /** Save registration details; `step` marks that step's flagged issues as fixed. Returns the new application. */
  updateApplication(patch: Partial<DriverApplication>, step?: OnboardingStepId): DriverApplication;
  submitApplication(): Result<true>;
  /** Send an application back after fixing what staff flagged. */
  resubmitApplication(): Result<true>;
  /** Connected to the demo relay: staff review in the admin, requests come from real riders. */
  relayConnected: boolean;
  /* Access */
  /** The same timeline response the admin shows (D-058). */
  timeline: SubscriptionTimelineResponse;
  /** Current continuous access: plan of the pass in force, ending when the last queued pass ends. Null without access. */
  subscription: DriverSubscription | null;
  hasAccess: boolean;
  buyPackage(pkg: DriverAccessPackage): Promise<Result<SubscriptionPassView>>;
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
  /** Quick Match: the trip (or an error, e.g. another driver claimed it). Negotiate via the relay: null while the rider decides. */
  acceptRequest(): Promise<Result<DriverTrip | null>>;
  sendCounter(amount: Kobo): Result<true>;
  declineRequest(): void;
  /* Trip */
  activeTrip: DriverTrip | null;
  /** The active trip is a real rider's ride through the demo relay. */
  relayTrip: boolean;
  /** Why a trip ended without the driver (e.g. the rider cancelled). */
  tripNotice: string | null;
  clearTripNotice(): void;
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
      const loaded = { ...INITIAL, ...(s ?? {}) };
      // Migrate the old single stored pass into the timeline once (D-058).
      const { subscription: legacy, ...rest } = loaded;
      const next: Stored = s && !s.passes ? { ...rest, passes: subscriptionStateFromLegacy(SELF, legacy) } : rest;
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

  // Updates go through the ref first so several changes in one tick never overwrite each other.
  const persist = useCallback(
    (update: (prev: Stored) => Stored) => {
      const next = update(storedRef.current);
      storedRef.current = next;
      setStored(next);
      void writeJson(storeKey, next);
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

  /* ---------- Demo relay (D-049): people, application, review ---------- */

  const relay = useRelay();
  const session = useSession();
  const phone = session.phone;
  const profile = session.profile;
  const personal = application.personal;
  const firstName = personal?.firstName ?? profile?.firstName ?? 'Driver';
  const lastName = personal?.lastName ?? profile?.lastName ?? '';
  const fullName = `${firstName} ${lastName}`.trim();
  const nameRef = useRef(fullName);
  nameRef.current = fullName;
  const lastPush = useRef(0);

  /** Share the application with staff. Staff fields (decision time / who) are left as they are. */
  const pushApplication = useCallback(
    (app: DriverApplication) => {
      if (!relay || !phone) return;
      const now = Date.now();
      lastPush.current = now;
      const { decided_at: _at, decided_by: _by, ...row } = applicationRow(app, { phone, name: nameRef.current }, now);
      void relay.upsert('demo_driver_applications', row).catch(() => undefined);
    },
    [relay, phone],
  );

  // Who this driver is, for the admin's people list (refreshed while the app is open).
  const email = personal?.email ?? profile?.email ?? null;
  const city = personal?.city ?? profile?.city ?? null;
  useEffect(() => {
    if (!relay || !phone || !ready) return;
    const send = () => void relay.upsert('demo_people', personRow({ role: 'driver', phone, name: fullName, email, city }, Date.now(), session.createdAt ?? undefined)).catch(() => undefined);
    send();
    const id = setInterval(send, 120_000);
    return () => clearInterval(id);
  }, [relay, phone, ready, fullName, email, city, session.createdAt]);

  // Staff decisions: pull the shared application and merge review changes (never older than our last push).
  useEffect(() => {
    if (!relay || !phone || !ready) return;
    return poll(async () => {
      const [row] = await relay.select<RelayApplication>('demo_driver_applications', { where: { id: phone } });
      const local = storedRef.current.application;
      if (!row) {
        if (local.status !== 'not_started' || local.personal) pushApplication(local);
        return;
      }
      if (row.updated_at < lastPush.current) return;
      const changed = row.status !== local.status || !same(row.checks, local.checks ?? []) || !same(row.issues, local.issues ?? []) || (row.review_note ?? undefined) !== local.reviewNote;
      if (changed) persist((prev) => ({ ...prev, application: mergeReview(prev.application, row) }));
    }, 3_000);
  }, [relay, phone, ready, pushApplication, persist]);

  // Without the relay, a simulated reviewer runs the checks (one waits on the FRSC), then approves.
  useEffect(() => {
    if (relay || application.status !== 'pending_review') return;
    const tick = () => {
      const a = storedRef.current.application;
      if (a.status !== 'pending_review') return;
      const r = simulatedReview(a.submittedAt ?? Date.now(), Date.now());
      if (r.approved) {
        persist((prev) => ({
          ...prev,
          application: { ...prev.application, status: 'approved', checks: r.checks },
          history: prev.seeded ? prev.history : mockTripHistory(Date.now(), prev.application.vehicle?.category ?? 'go'),
          seeded: true,
        }));
      } else if (!same(r.checks, a.checks)) {
        persist((prev) => ({ ...prev, application: { ...prev.application, checks: r.checks } }));
      }
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [relay, application.status, persist]);

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

  // One authoritative timeline (D-058): passes queue after the last scheduled one; status comes from the clock,
  // so a queued pass takes over by itself when the one before it ends.
  const timeline = useMemo(() => subscriptionTimelineResponse(stored.passes, now), [stored.passes, now]);
  const hasAccess = timeline.access.canAcceptRides;
  const subscription = useMemo<DriverSubscription | null>(() => {
    const cur = timeline.passes.find((p) => p.id === timeline.access.currentPassId);
    return cur && timeline.access.activeUntil ? { packageId: cur.plan, startsAt: cur.startsAt, expiresAt: timeline.access.activeUntil } : null;
  }, [timeline]);
  const buyPackage = useCallback(
    async (pkg: DriverAccessPackage): Promise<Result<SubscriptionPassView>> => {
      // Simulated payment: no money moves in the preview. In production the client only starts the payment;
      // the backend's verification job records the pass when the provider confirms it.
      await new Promise((r) => setTimeout(r, SIM.packagePaymentMs));
      const confirmedAt = Date.now();
      const paymentRef = `sim-${confirmedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const r = recordPassPayment(storedRef.current.passes, { paymentRef, driverId: SELF, plan: pkg.id, amount: pkg.price, confirmedAt }, { expectedVersion: storedRef.current.passes.version });
      if (!r.ok) return { ok: false, error: r.message };
      persist((prev) => ({ ...prev, passes: r.state }));
      const view = subscriptionTimelineResponse(r.state, confirmedAt).passes.find((p) => p.paymentRef === paymentRef)!;
      return { ok: true, value: view };
    },
    [persist],
  );

  /* ---------- Online ---------- */

  const issues = trackingIssues(location, now);
  const receive = canReceiveRequests(location, now);
  const canReceive = receive.ok && hasAccess && !stored.activeTrip && application.status === 'approved';

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
    const r = driverLocationReducer(state, { type: 'GO_ONLINE', now: Date.now(), hasAccess: subscriptionTimelineResponse(storedRef.current.passes, Date.now()).access.canAcceptRides });
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
    if (relay || !canReceive || request) return;
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
  }, [relay, canReceive, request, home, settings.negotiationRequests]);

  /* ---------- Real requests from riders (demo relay) ---------- */

  const seenRides = useRef(new Set<string>());
  const relayRides = useRef(new Map<string, RelayRide>());
  const rideKey = (r: RelayRide) => (r.kind === 'negotiate' ? `${r.id}:${r.offer?.id}` : r.id);
  useEffect(() => {
    if (!relay || !phone || !canReceive || request) return;
    return poll(async () => {
      if (storedRef.current.activeTrip) return;
      const rides = await openRidesForDriver(relay, phone);
      const next = rides.find((r) => !seenRides.current.has(rideKey(r)));
      if (!next) return;
      seenRides.current.add(rideKey(next));
      relayRides.current.set(next.id, next);
      setRequest(rideToRequest(next, locRef.current.lastFix ?? home, Date.now()));
      setCounter(null);
    }, 2_500);
  }, [relay, phone, canReceive, request, home]);

  /** This driver as riders see them. */
  const summary = useCallback((): DriverSummary => {
    const s = storedRef.current;
    const v = s.application.vehicle;
    const at = locRef.current.lastFix ?? home;
    return {
      id: phone ?? 'driver',
      firstName,
      lastName: lastName || undefined,
      rating: 4.9,
      completedTrips: s.history.filter((t) => t.stage === 'completed').length,
      vehicle: { make: v?.make ?? 'Car', model: v?.model ?? '', colour: v?.colour ?? '', plate: v?.plate ?? '', year: v?.year ?? 2015, category: v?.category ?? 'go' },
      coordinate: { latitude: at.latitude, longitude: at.longitude },
      payoutAccount: s.payout ?? undefined,
    };
  }, [phone, firstName, lastName, home]);

  // Expire unanswered requests (a counter waiting for the rider keeps the request until they reply).
  useEffect(() => {
    if (!request || counter) return;
    const ms = request.expiresAt - Date.now();
    const t = setTimeout(() => setRequest((r) => (r?.id === request.id ? null : r)), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [request, counter]);

  const stopSelection = useRef<Unsubscribe | null>(null);
  useEffect(() => () => stopSelection.current?.(), []);

  const beginTrip = useCallback(
    (req: IncomingRequest, fare: Kobo, rideId?: string): DriverTrip => {
      stopSelection.current?.();
      const seed = Number(req.id.replace(/\D/g, '')) || 1;
      // A real rider's PIN arrives from the relay just after matching (see the trip sync below).
      const trip = startTripFromRequest(req, fare, Date.now(), rideId ? '' : mockPickupPin(seed));
      persist((prev) => ({ ...prev, activeTrip: trip, activeRide: rideId ?? null }));
      dispatchLoc({ type: 'TRIP_ASSIGNED' });
      setRequest(null);
      setCounter(null);
      return trip;
    },
    [persist],
  );

  /** Negotiation through the relay: answer the rider's offer, then wait for them to choose. */
  const answerOffer = useCallback(
    async (req: IncomingRequest, kind: 'accept' | 'counter', amount: Kobo): Promise<Result<null>> => {
      const ride = relayRides.current.get(req.id);
      if (!relay || !ride?.offer) return { ok: false, error: 'This request has expired.' };
      const answer = responseRow(ride, summary(), kind, amount, req.pickupEtaSeconds, Date.now());
      setCounter({ amount, status: 'waiting' });
      try {
        await relay.insert('demo_ride_responses', answer);
      } catch {
        setCounter(null);
        return { ok: false, error: 'Couldn’t reach the demo relay. Try again.' };
      }
      logRelayEvent(relay, { actor: 'driver', type: kind === 'accept' ? 'offer.accepted' : 'offer.countered', summary: `${nameRef.current} ${kind === 'accept' ? 'accepted' : `countered with ${amount / 100} naira on`} ${ride.rider.name}’s offer`, ride_id: ride.id, person_id: phone });
      stopSelection.current?.();
      stopSelection.current = poll(async () => {
        const [row] = await relay.select<RelayRide>('demo_rides', { where: { id: ride.id } });
        if (!row) return;
        if (row.driver_id === phone && row.status !== 'cancelled' && row.status !== 'expired') {
          beginTrip(req, (row.agreed_fare ?? amount) as Kobo, ride.id);
        } else if (row.driver_id || row.status !== 'negotiating' || row.offer?.id !== ride.offer?.id || Date.now() > answer.expires_at + 5_000) {
          stopSelection.current?.();
          setCounter({ amount, status: 'declined' });
        }
      }, 2_000);
      return { ok: true, value: null };
    },
    [relay, phone, summary, beginTrip],
  );

  const acceptRequest = useCallback(async (): Promise<Result<DriverTrip | null>> => {
    if (!request || request.expiresAt <= Date.now()) return { ok: false, error: 'This request has expired.' };
    const ride = relayRides.current.get(request.id);
    if (relay && ride) {
      if (ride.kind === 'negotiate') return answerOffer(request, 'accept', request.amount);
      let won = false;
      try {
        won = await claimRide(relay, ride.id, summary(), Date.now());
      } catch {
        return { ok: false, error: 'Couldn’t reach the demo relay. Try again.' };
      }
      if (!won) return { ok: false, error: 'Another driver took this ride.' };
      logRelayEvent(relay, { actor: 'driver', type: 'ride.accepted', summary: `${nameRef.current} accepted ${ride.rider.name}’s ride`, ride_id: ride.id, person_id: phone });
      return { ok: true, value: beginTrip(request, request.amount, ride.id) };
    }
    return { ok: true, value: beginTrip(request, request.amount) };
  }, [request, beginTrip, relay, summary, answerOffer, phone]);

  const sendCounter = useCallback(
    (amount: Kobo): Result<true> => {
      if (!request || request.expiresAt <= Date.now()) return { ok: false, error: 'This request has expired.' };
      const v = validateCounter(amount, request);
      if (!v.ok) return v;
      if (relay && relayRides.current.has(request.id)) {
        void answerOffer(request, 'counter', amount);
        return { ok: true, value: true };
      }
      setCounter({ amount, status: 'waiting' });
      const req = request;
      later(() => {
        if (Math.random() < SIM.riderAcceptsCounter) beginTrip(req, amount);
        else setCounter({ amount, status: 'declined' });
      }, between(SIM.riderReplyMs));
      return { ok: true, value: true };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request, beginTrip, relay, answerOffer],
  );

  const declineRequest = useCallback(() => {
    stopSelection.current?.();
    setRequest(null);
    setCounter(null);
  }, []);

  /* ---------- Trip ---------- */

  const activeTrip = stored.activeTrip;
  const activeRide = stored.activeRide;
  const setTrip = useCallback((trip: DriverTrip) => persist((prev) => ({ ...prev, activeTrip: trip })), [persist]);
  const [tripNotice, setTripNotice] = useState<string | null>(null);

  /** Write a trip change to the shared ride (relay trips only). */
  const syncRide = useCallback(
    (patch: Partial<RelayRide>, event?: { type: string; summary: string }) => {
      const id = storedRef.current.activeRide;
      if (!relay || !id) return;
      void relay.update<RelayRide>('demo_rides', { id }, { ...patch, updated_at: Date.now() }).catch(() => undefined);
      if (event) logRelayEvent(relay, { actor: 'driver', ...event, ride_id: id, person_id: phone });
    },
    [relay, phone],
  );

  // The driver's position on a relay trip, for the rider's map (at most every 3 s).
  useEffect(() => {
    if (!relay || !activeRide) return;
    const id = setInterval(() => {
      const t = storedRef.current.activeTrip;
      if (!t || t.stage === 'completed' || t.stage === 'cancelled') return;
      const at = locRef.current.lastFix ?? simulatedFix();
      const target = t.stage === 'in_progress' ? t.destination.coordinate : t.pickup.coordinate;
      const eta = Math.max(0, Math.round((haversineMeters(at, target) * 1.3) / 8));
      syncRide({ driver_location: { coordinate: { latitude: at.latitude, longitude: at.longitude }, eta_seconds: eta, at: Date.now() } });
    }, 3_000);
    return () => clearInterval(id);
  }, [relay, activeRide, syncRide, simulatedFix]);

  // The rider's side of a relay trip: the pickup PIN, their payment, or a cancellation.
  useEffect(() => {
    if (!relay || !activeRide) return;
    return poll(async () => {
      const [row] = await relay.select<RelayRide>('demo_rides', { where: { id: activeRide } });
      const t = storedRef.current.activeTrip;
      if (!row || !t || storedRef.current.activeRide !== activeRide) return;
      if (row.pickup_pin && t.pickupPin !== row.pickup_pin) persist((prev) => (prev.activeTrip ? { ...prev, activeTrip: { ...prev.activeTrip, pickupPin: row.pickup_pin! } } : prev));
      if (row.payment_status === 'paid' && t.stage === 'completed' && t.paymentStatus !== 'confirmed') persist((prev) => (prev.activeTrip ? { ...prev, activeTrip: { ...prev.activeTrip, paymentStatus: 'confirmed' } } : prev));
      if (row.status === 'cancelled' && row.cancelled_by !== 'driver' && t.stage !== 'completed' && t.stage !== 'cancelled') {
        const ended: DriverTrip = { ...t, stage: 'cancelled', cancelledAt: Date.now(), cancelReason: row.cancelled_by === 'admin' ? 'admin_cancelled' : 'rider_cancelled', paymentStatus: 'not_due' };
        persist((prev) => ({ ...prev, activeTrip: null, activeRide: null, history: [ended, ...prev.history] }));
        dispatchLoc({ type: 'TRIP_ENDED' });
        setTripNotice(row.cancelled_by === 'admin' ? 'GoBye support cancelled this trip.' : `${t.rider.firstName} cancelled this trip.`);
      }
    }, 2_500);
  }, [relay, activeRide, persist]);

  const arrive = useCallback((): Result<true> => {
    const t = storedRef.current.activeTrip;
    if (!t) return { ok: false, error: 'No active trip.' };
    const r = markArrived(t, Date.now());
    if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
    setTrip(r.value);
    syncRide({ status: 'arrived', arrived_at: r.value.arrivedAt ?? Date.now() }, { type: 'ride.arrived', summary: `${nameRef.current} arrived at ${t.pickup.title}` });
    return { ok: true, value: true };
  }, [setTrip, syncRide]);

  const confirmPin = useCallback(
    (pin: string): Result<true> => {
      const t = storedRef.current.activeTrip;
      if (!t) return { ok: false, error: 'No active trip.' };
      if (storedRef.current.activeRide && !t.pickupPin) return { ok: false, error: 'The rider’s PIN hasn’t reached you yet. Check your connection and try again in a moment.' };
      const r = confirmPinAndStart(t, pin, Date.now());
      if (!r.ok) {
        setTrip(r.error.trip);
        return { ok: false, error: tripErrorMessage(r.error.error, pinAttemptsLeft(r.error.trip)) };
      }
      setTrip(r.value);
      dispatchLoc({ type: 'PASSENGER_PICKED_UP' });
      syncRide({ status: 'in_progress', started_at: r.value.startedAt ?? Date.now() }, { type: 'ride.started', summary: `${nameRef.current} started the trip with ${t.rider.firstName}` });
      return { ok: true, value: true };
    },
    [setTrip, syncRide],
  );

  const complete = useCallback((): Result<true> => {
    const t = storedRef.current.activeTrip;
    if (!t) return { ok: false, error: 'No active trip.' };
    const r = completeTrip(t, Date.now());
    if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
    setTrip(r.value);
    syncRide({ status: 'completed', completed_at: r.value.completedAt ?? Date.now(), payment_status: 'pending' }, { type: 'ride.completed', summary: `${nameRef.current} completed the trip to ${t.destination.title}` });
    // Wallet payments are confirmed by the platform (simulated here; with the relay, by the rider's payment); transfers wait for the driver to check.
    if (r.value.paymentMethod === 'wallet' && !storedRef.current.activeRide) {
      const id = r.value.id;
      later(() => persist((prev) => (prev.activeTrip?.id === id ? { ...prev, activeTrip: { ...prev.activeTrip, paymentStatus: 'confirmed' } } : prev)), SIM.walletConfirmMs);
    }
    return { ok: true, value: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTrip, persist, syncRide]);

  const cancel = useCallback(
    (reason: 'rider_no_show' | 'driver_cancelled'): Result<true> => {
      const t = storedRef.current.activeTrip;
      if (!t) return { ok: false, error: 'No active trip.' };
      const r = cancelTrip(t, reason, Date.now());
      if (!r.ok) return { ok: false, error: tripErrorMessage(r.error) };
      syncRide({ status: 'cancelled', cancelled_by: 'driver', cancel_reason: reason }, { type: 'ride.cancelled', summary: `${nameRef.current} cancelled (${reason === 'rider_no_show' ? 'rider didn’t come' : 'driver cancelled'})` });
      persist((prev) => ({ ...prev, activeTrip: null, activeRide: null, history: [r.value, ...prev.history] }));
      dispatchLoc({ type: 'TRIP_ENDED' });
      return { ok: true, value: true };
    },
    [persist, syncRide],
  );

  const confirmPayment = useCallback(() => {
    const t = storedRef.current.activeTrip;
    if (t && t.paymentStatus !== 'confirmed') syncRide({ payment_status: 'paid' }, { type: 'payment.confirmed', summary: `${nameRef.current} confirmed ${t.rider.firstName}’s payment` });
    persist((prev) => (prev.activeTrip ? { ...prev, activeTrip: { ...prev.activeTrip, paymentStatus: 'confirmed' } } : prev));
  }, [persist, syncRide]);

  const finishTrip = useCallback(() => {
    const t = storedRef.current.activeTrip;
    if (!t || t.stage !== 'completed') return;
    persist((prev) => ({ ...prev, activeTrip: null, activeRide: null, history: [t, ...prev.history] }));
    dispatchLoc({ type: 'TRIP_ENDED' });
  }, [persist]);

  /* ---------- Value ---------- */

  const value = useMemo<DriverValue>(
    () => ({
      ready,
      application,
      verification,
      updateApplication: (patch, step) => {
        let next: DriverApplication = { ...storedRef.current.application, ...patch };
        if (step) next = resolveIssuesForStep(next, step, Date.now());
        next = { ...next, status: draftStatus(next) };
        persist((prev) => ({ ...prev, application: next }));
        pushApplication(next);
        return next;
      },
      submitApplication: () => {
        const now = Date.now();
        const r = submitApplication(storedRef.current.application, now);
        if (!r.ok) return r;
        const next = { ...r.value, checks: queuedChecks(now) };
        persist((prev) => ({ ...prev, application: next }));
        pushApplication(next);
        logRelayEvent(relay, { actor: 'driver', type: 'application.submitted', summary: `${nameRef.current} submitted their driver application`, person_id: phone });
        return { ok: true, value: true };
      },
      resubmitApplication: () => {
        const r = resubmitApplication(storedRef.current.application, Date.now());
        if (!r.ok) return r;
        persist((prev) => ({ ...prev, application: r.value }));
        pushApplication(r.value);
        logRelayEvent(relay, { actor: 'driver', type: 'application.resubmitted', summary: `${nameRef.current} fixed the flagged items and resubmitted`, person_id: phone });
        return { ok: true, value: true };
      },
      relayConnected: !!relay,
      timeline,
      subscription,
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
      relayTrip: !!activeRide,
      tripNotice,
      clearTripNotice: () => setTripNotice(null),
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
    [ready, application, verification, persist, stored, timeline, subscription, hasAccess, buyPackage, location, issues, canReceive, position, requestLocation, goOnline, goOffline, request, counter, acceptRequest, sendCounter, declineRequest, activeTrip, activeRide, tripNotice, arrive, confirmPin, complete, cancel, confirmPayment, finishTrip, pushApplication, relay, phone],
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

export function useDriver(): DriverValue {
  const v = useContext(DriverContext);
  if (!v) throw new Error('useDriver must be used inside <DriverProvider>');
  return v;
}

export { DRIVER_ACCESS_PACKAGES };
