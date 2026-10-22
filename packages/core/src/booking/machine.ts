import { checkSelection, isOfferOpen, upsertResponse, type SelectionError } from '../negotiation';
import type {
  Booking,
  BookingMode,
  BookingStatus,
  Cancellation,
  DriverResponse,
  DriverSummary,
  FareQuote,
  LatLng,
  PassengerOffer,
  PaymentMethod,
  PaymentStatus,
  RouteEstimate,
} from '../types';

/**
 * Booking state machine (docs/UI_STATES.md). Pure: (state, event) -> state.
 * Illegal transitions leave the booking unchanged and set `error`.
 */

export type BookingEvent =
  | { type: 'START'; booking: Booking }
  | { type: 'HYDRATE'; booking: Booking | null }
  | { type: 'SET_MODE'; mode: BookingMode; now: number }
  | { type: 'SET_PAYMENT'; method: PaymentMethod; now: number }
  | { type: 'REQUOTE'; quote: FareQuote; route?: RouteEstimate; now: number }
  | { type: 'SUBMIT'; now: number }
  | { type: 'SEARCH_STARTED'; now: number }
  | { type: 'SUBMIT_FAILED'; now: number }
  | { type: 'OFFER_SENT'; offer: PassengerOffer; now: number }
  | { type: 'RESPONSE_RECEIVED'; response: DriverResponse; now: number }
  | { type: 'RESPONSE_SELECTED'; responseId: string; now: number; isDriverAvailable: (driverId: string) => boolean; pickupPin?: string }
  | { type: 'DRIVER_MATCHED'; driver: DriverSummary; now: number; pickupPin?: string }
  | { type: 'NO_DRIVERS'; now: number }
  | { type: 'RETRY'; now: number }
  | { type: 'SWITCH_TO_QUICK_MATCH'; now: number }
  | { type: 'DRIVER_EN_ROUTE'; now: number }
  | { type: 'DRIVER_LOCATION'; coordinate: LatLng; now: number; etaSeconds?: number }
  | { type: 'DRIVER_ARRIVED'; now: number }
  | { type: 'TRIP_STARTED'; now: number }
  | { type: 'TRIP_COMPLETED'; now: number }
  | { type: 'PAYMENT_STARTED'; now: number }
  /** 'pending' = verification found nothing yet (e.g. transfer not received): back to awaiting the passenger, not a failure. */
  | { type: 'PAYMENT_RESULT'; status: Extract<PaymentStatus, 'paid' | 'failed' | 'reversed' | 'pending'>; notice?: 'transfer_not_received' | 'not_confirmed'; now: number }
  | { type: 'CANCEL'; cancellation: Cancellation }
  | { type: 'CLEAR' };

export type BookingErrorCode =
  | 'invalid_transition'
  | 'quote_expired'
  | 'offer_closed'
  | SelectionError
  | 'not_cancellable';

export interface BookingState {
  booking: Booking | null;
  error?: BookingErrorCode;
}

export const initialBookingState: BookingState = { booking: null };

export const TERMINAL_STATUSES: readonly BookingStatus[] = ['completed', 'cancelled', 'failed'];
export const CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  'quoted',
  'submitting',
  'searching',
  'negotiating',
  'no_drivers',
  'matched',
  'driver_en_route',
  'driver_arrived',
];
/** Statuses in which a booking is "live" and should be restored after relaunch. */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  'searching',
  'negotiating',
  'matched',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
  'payment_pending',
];

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
export function isCancellable(status: BookingStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}
export function isActive(status: BookingStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function fail(state: BookingState, error: BookingErrorCode): BookingState {
  return { booking: state.booking, error };
}

function update(booking: Booking, patch: Partial<Booking>, now: number): BookingState {
  return { booking: { ...booking, ...patch, updatedAt: now } };
}

export function bookingReducer(state: BookingState, event: BookingEvent): BookingState {
  if (event.type === 'START') {
    if (state.booking && !isTerminal(state.booking.status) && state.booking.status !== 'quoted') {
      return fail(state, 'invalid_transition');
    }
    return { booking: event.booking };
  }
  if (event.type === 'HYDRATE') return { booking: event.booking };
  if (event.type === 'CLEAR') {
    if (state.booking && !isTerminal(state.booking.status) && state.booking.status !== 'quoted') {
      return fail(state, 'invalid_transition');
    }
    return { booking: null };
  }

  const b = state.booking;
  if (!b) return fail(state, 'invalid_transition');
  const is = (...statuses: BookingStatus[]) => statuses.includes(b.status);

  switch (event.type) {
    case 'SET_MODE':
      if (!is('quoted')) return fail(state, 'invalid_transition');
      return update(b, { mode: event.mode }, event.now);

    case 'SET_PAYMENT':
      if (!is('quoted', 'payment_pending')) return fail(state, 'invalid_transition');
      // Never change the method while a payment is being confirmed or after it succeeded.
      if (b.paymentStatus === 'processing' || b.paymentStatus === 'paid') return fail(state, 'invalid_transition');
      return update(b, { paymentMethod: event.method }, event.now);

    case 'REQUOTE':
      if (!is('quoted', 'no_drivers')) return fail(state, 'invalid_transition');
      return update(b, { quote: event.quote, route: event.route ?? b.route, status: 'quoted' }, event.now);

    case 'SUBMIT':
      if (!is('quoted') || b.mode !== 'quick_match') return fail(state, 'invalid_transition');
      if (b.quote.expiresAt <= event.now) return fail(state, 'quote_expired');
      return update(b, { status: 'submitting' }, event.now);

    case 'SEARCH_STARTED':
      if (!is('submitting')) return fail(state, 'invalid_transition');
      return update(b, { status: 'searching', agreedFare: b.quote.suggested, fareLockedAt: event.now }, event.now);

    case 'SUBMIT_FAILED':
      if (!is('submitting')) return fail(state, 'invalid_transition');
      return update(b, { status: 'quoted' }, event.now);

    case 'OFFER_SENT': {
      if (!is('quoted', 'negotiating')) return fail(state, 'invalid_transition');
      if (b.mode !== 'negotiate') return fail(state, 'invalid_transition');
      if (is('quoted') && b.quote.expiresAt <= event.now) return fail(state, 'quote_expired');
      // A raised offer withdraws responses made to the previous offer.
      return update(b, { status: 'negotiating', offer: event.offer, responses: [] }, event.now);
    }

    case 'RESPONSE_RECEIVED': {
      if (!is('negotiating') || !b.offer) return fail(state, 'invalid_transition');
      if (!isOfferOpen(b.offer, event.now)) return fail(state, 'offer_closed');
      return update(b, { responses: upsertResponse(b.responses, event.response, b.offer, b.quote) }, event.now);
    }

    case 'RESPONSE_SELECTED': {
      if (!is('negotiating')) return fail(state, 'invalid_transition');
      const result = checkSelection({
        responses: b.responses,
        responseId: event.responseId,
        now: event.now,
        alreadyLocked: b.fareLockedAt !== undefined,
        isDriverAvailable: event.isDriverAvailable,
      });
      if (!result.ok) {
        // Remove an unavailable driver's response so it can't be selected again (BR-047).
        if (result.error === 'driver_unavailable') {
          return {
            booking: { ...b, responses: b.responses.filter((r) => r.id !== event.responseId), updatedAt: event.now },
            error: result.error,
          };
        }
        return fail(state, result.error);
      }
      const r = result.value;
      return update(
        b,
        {
          status: 'matched',
          driver: r.driver,
          agreedFare: r.amount,
          fareLockedAt: event.now,
          matchedAt: event.now,
          pickupPin: event.pickupPin,
          responses: [r],
        },
        event.now,
      );
    }

    case 'DRIVER_MATCHED':
      if (!is('searching')) return fail(state, 'invalid_transition');
      return update(b, { status: 'matched', driver: event.driver, matchedAt: event.now, pickupPin: event.pickupPin }, event.now);

    case 'NO_DRIVERS':
      if (!is('searching', 'negotiating')) return fail(state, 'invalid_transition');
      return update(b, { status: 'no_drivers', agreedFare: undefined, fareLockedAt: undefined }, event.now);

    case 'RETRY':
      if (!is('no_drivers')) return fail(state, 'invalid_transition');
      return update(b, { status: 'quoted', offer: undefined, responses: [] }, event.now);

    case 'SWITCH_TO_QUICK_MATCH':
      if (!is('negotiating', 'no_drivers', 'quoted')) return fail(state, 'invalid_transition');
      return update(
        b,
        { status: 'quoted', mode: 'quick_match', offer: undefined, responses: [], agreedFare: undefined, fareLockedAt: undefined },
        event.now,
      );

    case 'DRIVER_EN_ROUTE':
      if (!is('matched')) return fail(state, 'invalid_transition');
      return update(b, { status: 'driver_en_route' }, event.now);

    case 'DRIVER_LOCATION':
      if (!is('matched', 'driver_en_route', 'driver_arrived', 'in_progress') || !b.driver) {
        return fail(state, 'invalid_transition');
      }
      return update(
        b,
        {
          driver: { ...b.driver, coordinate: event.coordinate },
          driverLocationAt: event.now,
          driverEtaSeconds: event.etaSeconds ?? b.driverEtaSeconds,
          // The first ETA after match (or after pickup) anchors arrival progress.
          driverEtaInitialSeconds:
            event.etaSeconds !== undefined && (b.driverEtaInitialSeconds === undefined || event.etaSeconds > b.driverEtaInitialSeconds)
              ? event.etaSeconds
              : b.driverEtaInitialSeconds,
        },
        event.now,
      );

    case 'DRIVER_ARRIVED':
      if (!is('driver_en_route', 'matched')) return fail(state, 'invalid_transition');
      return update(b, { status: 'driver_arrived', arrivedAt: event.now }, event.now);

    case 'TRIP_STARTED':
      if (!is('driver_arrived')) return fail(state, 'invalid_transition');
      return update(b, { status: 'in_progress', startedAt: event.now, driverEtaInitialSeconds: undefined, driverEtaSeconds: undefined }, event.now);

    case 'TRIP_COMPLETED':
      if (!is('in_progress')) return fail(state, 'invalid_transition');
      return update(
        b,
        {
          status: 'payment_pending',
          completedAt: event.now,
          paymentStatus: 'pending',
          // Payment happens at a separate, later stage: nothing is charged until the passenger confirms.
          awaitingPaymentAction: true,
        },
        event.now,
      );

    case 'PAYMENT_STARTED':
      // Duplicate-action guard: only one payment request at a time.
      if (!is('payment_pending') || b.paymentStatus === 'processing' || b.paymentStatus === 'paid') return fail(state, 'invalid_transition');
      return update(b, { paymentStatus: 'processing', awaitingPaymentAction: false, paymentAttempts: (b.paymentAttempts ?? 0) + 1 }, event.now);

    case 'PAYMENT_RESULT':
      if (!is('payment_pending') || b.paymentStatus !== 'processing') return fail(state, 'invalid_transition');
      return update(
        b,
        {
          status: event.status === 'paid' ? 'completed' : 'payment_pending',
          paymentStatus: event.status,
          awaitingPaymentAction: event.status !== 'paid',
          paymentNotice: event.status === 'pending' ? event.notice : undefined,
        },
        event.now,
      );

    case 'CANCEL':
      if (!isCancellable(b.status)) return fail(state, 'not_cancellable');
      return update(b, { status: 'cancelled', cancellation: event.cancellation }, event.cancellation.at);

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Fare that will be charged: agreed/locked fare, else the suggested fare. */
export function bookingFare(b: Booking) {
  return b.agreedFare ?? b.quote.suggested;
}
