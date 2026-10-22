import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MOCK_PRICING_CONFIG,
  bookingFare,
  bookingReducer,
  generatePickupPin,
  createOffer,
  initialBookingState,
  isActive,
  isQuoteExpired,
  paymentCharge,
  isOfferOpen,
  isTerminal,
  passengerCancellationFee,
  validateOffer,
  type Booking,
  type BookingEvent,
  type BookingMode,
  type BookingState,
  type FareQuote,
  type Kobo,
  type OfferError,
  type PaymentMethod,
  type Place,
  type Result,
  type RouteEstimate,
  type SelectionError,
  type TripReceipt,
} from '@gobye/core';
import { useAccount } from './account';
import { useServiceConfig } from './config';
import { useServices } from './services';
import { KEYS, readJson, writeJson } from './storage';

/**
 * Owns the active booking. All transitions go through the pure `bookingReducer` from @gobye/core
 * (so every rule is unit-tested); this provider wires mock service events to reducer events,
 * persists active bookings for state recovery and records completed trips.
 */

interface BookingValue {
  booking: Booking | null;
  hydrated: boolean;
  pickup: Place | null;
  destination: Place | null;
  setPickup(p: Place | null): void;
  setDestination(p: Place | null): void;
  /** Passenger selector (brief §3): null = booking for me; otherwise the person being picked up. */
  rider: { name: string; phone: string } | null;
  setRider(r: { name: string; phone: string } | null): void;
  /** Landmark or gate instructions for the pickup (brief 2026-10-21 §7). */
  pickupNote: string;
  setPickupNote(note: string): void;
  start(params: { route: RouteEstimate; quote: FareQuote; mode: BookingMode; paymentMethod: PaymentMethod; rider?: { name: string; phone: string } }): void;
  setMode(mode: BookingMode): void;
  setPayment(method: PaymentMethod): void;
  requote(quote: FareQuote): void;
  submitQuickMatch(): Result<true, string>;
  /** Retry after no drivers / switch mode; refreshes an expired quote first (BR-022). */
  rebook(mode: BookingMode): Promise<Result<true, string>>;
  sendOffer(amount: number): Result<true, OfferError>;
  selectResponse(responseId: string): Result<true, SelectionError | 'invalid_transition'>;
  switchToQuickMatch(): void;
  retry(): void;
  cancelFee(): Kobo;
  cancel(reason?: string): Result<true, string>;
  /** Payment stage (after the trip): choose/switch method. */
  choosePaymentMethod(method: PaymentMethod): void;
  /**
   * Start payment: wallet → debit request; bank transfer → passenger says they sent it, which only
   * starts verification (never treated as received). Blocked while a request is processing.
   */
  confirmPayment(): Result<true, string>;
  finish(): TripReceipt | null;
  discardDraft(): void;
}

/** How long a payment request may run before it is shown as "pending, not confirmed" with Check again. */
export const PAYMENT_TIMEOUT_MS = 25_000;

const BookingContext = createContext<BookingValue | null>(null);

export function BookingProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const account = useAccount();
  const [state, setState] = useState<BookingState>(initialBookingState);
  const stateRef = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [rider, setRider] = useState<{ name: string; phone: string } | null>(null);
  const [pickupNote, setPickupNote] = useState('');
  const serviceConfig = useServiceConfig();
  const pinDigits = serviceConfig.pickupPin.enabled ? serviceConfig.pickupPin.digits : 0;
  const newPin = useCallback(() => (pinDigits ? generatePickupPin(pinDigits) : undefined), [pinDigits]);

  /** Synchronous dispatch that returns the next state, so callers can read errors immediately. */
  const dispatch = useCallback((event: BookingEvent): BookingState => {
    const next = bookingReducer(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  // --- State recovery: restore an active booking after the app was closed (FR state recovery). ---
  useEffect(() => {
    readJson<Booking>(KEYS.activeBooking).then((b) => {
      // A paid-but-unfinished trip is restored too, so its receipt is still recorded (finish()).
      if (b && (isActive(b.status) || b.status === 'completed')) {
        dispatch({ type: 'HYDRATE', booking: b });
        setPickup(b.pickup);
        setDestination(b.destination);
      }
      setHydrated(true);
    });
  }, [dispatch]);

  const booking = state.booking;
  useEffect(() => {
    if (!hydrated) return;
    void writeJson(KEYS.activeBooking, booking && (isActive(booking.status) || booking.status === 'completed') ? booking : null);
  }, [booking, hydrated]);

  // --- Quick Match search subscription ---
  const status = booking?.status;
  const bookingId = booking?.id;
  useEffect(() => {
    const b = stateRef.current.booking;
    if (status !== 'searching' || !b) return;
    return services.matching.startQuickMatch(b, (e) => {
      if (e.type === 'matched') dispatch({ type: 'DRIVER_MATCHED', driver: e.driver, now: Date.now(), pickupPin: newPin() });
      else dispatch({ type: 'NO_DRIVERS', now: Date.now() });
    });
  }, [status, bookingId, services, dispatch, newPin]);

  // --- Negotiation subscription (per offer) ---
  const offerId = booking?.offer?.id;
  useEffect(() => {
    const b = stateRef.current.booking;
    if (status !== 'negotiating' || !b?.offer || !isOfferOpen(b.offer, Date.now())) return;
    return services.matching.openNegotiation(b, b.offer, (e) => {
      if (e.type === 'response') dispatch({ type: 'RESPONSE_RECEIVED', response: e.response, now: Date.now() });
    });
  }, [status, offerId, services, dispatch]);

  // --- Trip progress subscription: one per matched trip, survives phase changes ---
  const inTrip = status === 'matched' || status === 'driver_en_route' || status === 'driver_arrived' || status === 'in_progress';
  useEffect(() => {
    const b = stateRef.current.booking;
    if (!inTrip || !b) return;
    if (b.status === 'matched') dispatch({ type: 'DRIVER_EN_ROUTE', now: Date.now() });
    return services.trips.follow(stateRef.current.booking ?? b, (e) => {
      const now = Date.now();
      if (e.type === 'driver_location') dispatch({ type: 'DRIVER_LOCATION', coordinate: e.coordinate, etaSeconds: e.etaSeconds, now });
      else if (e.type === 'driver_arrived') dispatch({ type: 'DRIVER_ARRIVED', now });
      else if (e.type === 'trip_started') dispatch({ type: 'TRIP_STARTED', now });
      else if (e.type === 'trip_completed') dispatch({ type: 'TRIP_COMPLETED', now });
    });
  }, [inTrip, bookingId, services, dispatch]);

  // --- Payment: one request per attempt while `processing` (attempt number persisted → stable idempotency key) ---
  const paymentStatus = booking?.paymentStatus;
  const paymentAttempts = booking?.paymentAttempts ?? 0;
  const inFlight = useRef<string | null>(null);
  useEffect(() => {
    const b = stateRef.current.booking;
    if (status !== 'payment_pending' || paymentStatus !== 'processing' || !b) return;
    const key = `${b.id}-${b.paymentAttempts ?? 1}`;
    if (inFlight.current === key) return;
    inFlight.current = key;
    // A request that never answers must not leave the passenger stuck on "Paying". After the timeout
    // the payment is "pending, not confirmed" (never "failed": money may have moved) and "Check again"
    // retries; the wallet charge is idempotent per booking, so a retry can't debit twice.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      dispatch({ type: 'PAYMENT_RESULT', status: 'pending', notice: 'not_confirmed', now: Date.now() });
      if (inFlight.current === key) inFlight.current = null;
    }, PAYMENT_TIMEOUT_MS);
    services.payments
      .charge({ bookingId: b.id, method: b.paymentMethod, amount: paymentCharge(bookingFare(b), b.paymentMethod.type).total, idempotencyKey: key })
      .then((r) =>
        timedOut ? undefined :
        dispatch(
          r.status === 'not_received'
            ? { type: 'PAYMENT_RESULT', status: 'pending', notice: 'transfer_not_received', now: Date.now() }
            : { type: 'PAYMENT_RESULT', status: r.status, now: Date.now() },
        ),
      )
      .catch(() => {
        if (!timedOut) dispatch({ type: 'PAYMENT_RESULT', status: 'failed', now: Date.now() });
      })
      .finally(() => {
        clearTimeout(timer);
        if (inFlight.current === key) inFlight.current = null;
      });
  }, [status, paymentStatus, paymentAttempts, services, dispatch]);

  const value = useMemo<BookingValue>(
    () => ({
      booking,
      hydrated,
      pickup,
      destination,
      setPickup,
      setDestination,
      rider,
      setRider,
      pickupNote,
      setPickupNote,
      start({ route, quote, mode, paymentMethod, rider }) {
        if (!pickup || !destination) return;
        const now = Date.now();
        dispatch({
          type: 'START',
          booking: {
            id: `bk-${now.toString(36)}`,
            mode,
            status: 'quoted',
            pickup,
            destination,
            route,
            quote,
            paymentMethod,
            rider,
            pickupNote: pickupNote.trim() || undefined,
            responses: [],
            createdAt: now,
            updatedAt: now,
          },
        });
      },
      setMode: (mode) => void dispatch({ type: 'SET_MODE', mode, now: Date.now() }),
      setPayment: (method) => void dispatch({ type: 'SET_PAYMENT', method, now: Date.now() }),
      requote: (quote) => void dispatch({ type: 'REQUOTE', quote, now: Date.now() }),
      submitQuickMatch() {
        const now = Date.now();
        const s = dispatch({ type: 'SUBMIT', now });
        if (s.error === 'quote_expired') return { ok: false, error: 'Price updated. Check it and book again.' };
        if (s.error) return { ok: false, error: 'This ride is already being booked.' };
        dispatch({ type: 'SEARCH_STARTED', now });
        return { ok: true, value: true };
      },
      sendOffer(amount) {
        const b = stateRef.current.booking;
        if (!b) return { ok: false, error: { code: 'quote_expired' } };
        const now = Date.now();
        const v = validateOffer(amount, b.quote, MOCK_PRICING_CONFIG, now, b.offer);
        if (!v.ok) return v;
        const offer = createOffer({ id: `of-${now.toString(36)}`, amount: v.value, config: MOCK_PRICING_CONFIG, now, previous: b.offer });
        const s = dispatch({ type: 'OFFER_SENT', offer, now });
        if (s.error) return { ok: false, error: { code: 'quote_expired' } };
        return { ok: true, value: true };
      },
      selectResponse(responseId) {
        const s = dispatch({ type: 'RESPONSE_SELECTED', responseId, now: Date.now(), isDriverAvailable: services.matching.isDriverAvailable, pickupPin: newPin() });
        if (s.error) return { ok: false, error: s.error as SelectionError | 'invalid_transition' };
        return { ok: true, value: true };
      },
      async rebook(mode) {
        let b = stateRef.current.booking;
        if (!b) return { ok: false, error: 'No ride to retry.' };
        if (b.status === 'no_drivers') b = dispatch({ type: 'RETRY', now: Date.now() }).booking ?? b;
        if (b.status === 'negotiating' || (mode === 'quick_match' && b.mode !== 'quick_match')) {
          b = dispatch({ type: 'SWITCH_TO_QUICK_MATCH', now: Date.now() }).booking ?? b;
        }
        if (mode === 'negotiate' && b.mode !== 'negotiate') b = dispatch({ type: 'SET_MODE', mode, now: Date.now() }).booking ?? b;
        if (isQuoteExpired(b.quote, Date.now())) {
          try {
            const fresh = await services.pricing.quote(b.route, b.quote.category);
            dispatch({ type: 'REQUOTE', quote: fresh, now: Date.now() });
          } catch {
            return { ok: false, error: 'Couldn’t update the price. Check your connection, then retry.' };
          }
        }
        if (mode === 'quick_match') {
          const now = Date.now();
          const r = dispatch({ type: 'SUBMIT', now });
          if (r.error) return { ok: false, error: 'Booking failed. Try again.' };
          dispatch({ type: 'SEARCH_STARTED', now });
        }
        return { ok: true, value: true };
      },
      switchToQuickMatch: () => void dispatch({ type: 'SWITCH_TO_QUICK_MATCH', now: Date.now() }),
      retry: () => void dispatch({ type: 'RETRY', now: Date.now() }),
      cancelFee() {
        const b = stateRef.current.booking;
        if (!b) return 0 as Kobo;
        return passengerCancellationFee({ matchedAt: b.matchedAt, arrivedAt: b.arrivedAt, now: Date.now() }, MOCK_PRICING_CONFIG);
      },
      cancel(reason) {
        const b = stateRef.current.booking;
        if (!b) return { ok: false, error: 'No active ride.' };
        const now = Date.now();
        const fee = passengerCancellationFee({ matchedAt: b.matchedAt, arrivedAt: b.arrivedAt, now }, MOCK_PRICING_CONFIG);
        const s = dispatch({ type: 'CANCEL', cancellation: { by: 'passenger', reason, fee, at: now } });
        if (s.error) return { ok: false, error: 'This ride can’t be cancelled now. Contact Support for help.' };
        if (b.driver) services.matching.releaseDriver(b.driver.id);
        dispatch({ type: 'CLEAR' });
        return { ok: true, value: true };
      },
      choosePaymentMethod(method) {
        const b = stateRef.current.booking;
        if (!b || b.paymentStatus === 'processing') return;
        dispatch({ type: 'SET_PAYMENT', method, now: Date.now() });
      },
      confirmPayment() {
        const s = dispatch({ type: 'PAYMENT_STARTED', now: Date.now() });
        if (s.error) return { ok: false, error: 'A payment is already in progress for this trip.' };
        return { ok: true, value: true };
      },
      finish() {
        const b = stateRef.current.booking;
        // An unpaid trip is never cleared: the payment stays outstanding until it is confirmed.
        if (b?.status === 'payment_pending') return null;
        setRider(null);
        setPickupNote("");
        if (!b || !isTerminal(b.status) || b.status !== 'completed') {
          dispatch({ type: 'CLEAR' });
          return null;
        }
        const charge = paymentCharge(bookingFare(b), b.paymentMethod.type);
        const receipt: TripReceipt = {
          bookingId: b.id,
          fare: charge.fare,
          processingFee: charge.processingFee,
          totalPaid: charge.total,
          breakdown: b.quote.breakdown,
          paymentMethod: b.paymentMethod,
          paymentStatus: b.paymentStatus ?? 'paid',
          pickup: b.pickup,
          destination: b.destination,
          driver: b.driver,
          startedAt: b.startedAt ?? b.createdAt,
          completedAt: b.completedAt ?? Date.now(),
          distanceMeters: b.route.distanceMeters,
          durationSeconds: b.route.durationSeconds,
          isSimulated: true,
        };
        account.addReceipt(receipt);
        if (b.driver) services.matching.releaseDriver(b.driver.id);
        dispatch({ type: 'CLEAR' });
        setDestination(null);
        return receipt;
      },
      discardDraft() {
        const b = stateRef.current.booking;
        if (b && b.status === 'quoted') dispatch({ type: 'CLEAR' });
      },
    }),
    [booking, hydrated, pickup, destination, rider, pickupNote, dispatch, services, account, newPin],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingValue {
  const b = useContext(BookingContext);
  if (!b) throw new Error('useBooking must be used inside <BookingProvider>');
  return b;
}
