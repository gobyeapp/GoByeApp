import type {
  DriverResponse,
  FareQuote,
  Kobo,
  PassengerOffer,
  PricingConfig,
  Result,
} from './types';
import { formatNaira } from './money';

export type OfferError =
  | { code: 'not_integer' }
  | { code: 'below_min'; min: Kobo }
  | { code: 'above_max'; max: Kobo }
  | { code: 'not_on_step'; step: Kobo }
  | { code: 'not_raised'; current: Kobo }
  | { code: 'max_rounds'; maxRounds: number }
  | { code: 'quote_expired' };

export function offerErrorMessage(error: OfferError): string {
  switch (error.code) {
    case 'not_integer':
      return 'Enter a whole naira amount.';
    case 'below_min':
      return `Offer at least ${formatNaira(error.min)}.`;
    case 'above_max':
      return `Offers can't be more than ${formatNaira(error.max)}.`;
    case 'not_on_step':
      return `Use steps of ${formatNaira(error.step)}.`;
    case 'not_raised':
      return `A new offer must be higher than ${formatNaira(error.current)}.`;
    case 'max_rounds':
      return `You've reached the limit of ${error.maxRounds} offers for this trip.`;
    case 'quote_expired':
      return 'This price estimate has expired. Refresh to get a new one.';
  }
}

/**
 * Validate a passenger offer (BR-040, BR-041, BR-048, BR-049, BR-022).
 * `previous` is the currently open/most recent offer, if any.
 */
export function validateOffer(
  amount: number,
  quote: FareQuote,
  config: PricingConfig,
  now: number,
  previous?: PassengerOffer,
): Result<Kobo, OfferError> {
  if (!Number.isInteger(amount)) return { ok: false, error: { code: 'not_integer' } };
  if (quote.expiresAt <= now && !previous) return { ok: false, error: { code: 'quote_expired' } };
  const { min, max } = quote.negotiationRange;
  if (amount < min) return { ok: false, error: { code: 'below_min', min } };
  if (amount > max) return { ok: false, error: { code: 'above_max', max } };
  const step = config.negotiation.stepKobo;
  if (amount % step !== 0) return { ok: false, error: { code: 'not_on_step', step } };
  if (previous) {
    if (previous.round >= config.negotiation.maxRounds) {
      return { ok: false, error: { code: 'max_rounds', maxRounds: config.negotiation.maxRounds } };
    }
    if (amount <= previous.amount) {
      return { ok: false, error: { code: 'not_raised', current: previous.amount } };
    }
  }
  return { ok: true, value: amount as Kobo };
}

export function createOffer(params: {
  id: string;
  amount: Kobo;
  config: PricingConfig;
  now: number;
  previous?: PassengerOffer;
}): PassengerOffer {
  return {
    id: params.id,
    amount: params.amount,
    round: (params.previous?.round ?? 0) + 1,
    createdAt: params.now,
    expiresAt: params.now + params.config.negotiation.offerTtlSeconds * 1000,
  };
}

export function isOfferOpen(offer: PassengerOffer | undefined, now: number): boolean {
  return !!offer && offer.expiresAt > now;
}

export function isResponseLive(response: DriverResponse, now: number): boolean {
  return response.expiresAt > now;
}

/** Validate a driver response against the offer and range (BR-043). */
export function validateDriverResponse(
  response: Pick<DriverResponse, 'kind' | 'amount' | 'offerId'>,
  offer: PassengerOffer,
  quote: FareQuote,
): Result<true, string> {
  if (response.offerId !== offer.id) return { ok: false, error: 'Response is for a different offer' };
  if (response.kind === 'accept' && response.amount !== offer.amount) {
    return { ok: false, error: 'Accept must match the offer amount' };
  }
  if (response.kind === 'counter') {
    if (response.amount < offer.amount) return { ok: false, error: 'Counteroffer below passenger offer' };
    if (response.amount > quote.negotiationRange.max) return { ok: false, error: 'Counteroffer above range' };
  }
  return { ok: true, value: true };
}

/**
 * Merge an incoming driver response into the list (BR-045: one live response per driver;
 * a newer response replaces the older one). Invalid responses are ignored.
 */
export function upsertResponse(
  responses: DriverResponse[],
  incoming: DriverResponse,
  offer: PassengerOffer,
  quote: FareQuote,
): DriverResponse[] {
  if (!validateDriverResponse(incoming, offer, quote).ok) return responses;
  const others = responses.filter((r) => r.driver.id !== incoming.driver.id);
  return [...others, incoming];
}

/** Responses the passenger can still choose, cheapest first then fastest (driver comparison). */
export function selectableResponses(responses: DriverResponse[], offer: PassengerOffer | undefined, now: number) {
  if (!offer) return [];
  return responses
    .filter((r) => r.offerId === offer.id && isResponseLive(r, now))
    .sort((a, b) => a.amount - b.amount || a.etaSeconds - b.etaSeconds);
}

export type SelectionError = 'not_found' | 'expired' | 'driver_unavailable' | 'already_locked';

/**
 * Validate the passenger's selection of a response (BR-044, BR-046, BR-047).
 * `isDriverAvailable` must be backed by the authority (backend) in production.
 */
export function checkSelection(params: {
  responses: DriverResponse[];
  responseId: string;
  now: number;
  alreadyLocked: boolean;
  isDriverAvailable: (driverId: string) => boolean;
}): Result<DriverResponse, SelectionError> {
  if (params.alreadyLocked) return { ok: false, error: 'already_locked' };
  const response = params.responses.find((r) => r.id === params.responseId);
  if (!response) return { ok: false, error: 'not_found' };
  if (!isResponseLive(response, params.now)) return { ok: false, error: 'expired' };
  if (!params.isDriverAvailable(response.driver.id)) return { ok: false, error: 'driver_unavailable' };
  return { ok: true, value: response };
}

export function selectionErrorMessage(error: SelectionError): string {
  switch (error) {
    case 'not_found':
      return 'That offer is no longer available.';
    case 'expired':
      return 'That driver’s offer has expired. Choose another or wait for new responses.';
    case 'driver_unavailable':
      return 'This driver is no longer available.';
    case 'already_locked':
      return 'You’ve already agreed a fare for this trip.';
  }
}

/** Clamp and snap a stepper value into the allowed range. */
export function stepOffer(current: Kobo, direction: 1 | -1, quote: FareQuote, config: PricingConfig): Kobo {
  const next = current + direction * config.negotiation.stepKobo;
  const { min, max } = quote.negotiationRange;
  return Math.min(max, Math.max(min, next)) as Kobo;
}
