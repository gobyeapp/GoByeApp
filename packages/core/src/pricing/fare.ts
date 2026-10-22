import { kobo, roundDownTo, roundUpTo } from '../money';
import type {
  FareBreakdown,
  FareQuote,
  Kobo,
  PricingConfig,
  RouteEstimate,
  VehicleCategoryId,
} from '../types';

/**
 * Suggested fare (BR-020 – BR-023):
 * max(minimumFare, base + perKm × km + perMin × min) × multiplier, rounded up to the rounding step.
 */
export function calculateFare(
  route: Pick<RouteEstimate, 'distanceMeters' | 'durationSeconds'>,
  category: VehicleCategoryId,
  config: PricingConfig,
  multiplier = 1,
): FareBreakdown {
  if (multiplier < 1) throw new Error('Demand multiplier cannot be below 1');
  const rate = config.rates[category];
  const base = rate.base;
  const distance = kobo(Math.round((route.distanceMeters / 1000) * rate.perKm));
  const time = kobo(Math.round((route.durationSeconds / 60) * rate.perMinute));
  const computed = base + distance + time;
  const minimumApplied = computed < rate.minimumFare;
  const preMultiplier = minimumApplied ? rate.minimumFare : computed;
  const multiplied = kobo(Math.round(preMultiplier * multiplier));
  const total = roundUpTo(multiplied, config.roundingStep);
  // Parts shown to the user: base, distance, time (or the minimum fare) — rounding makes up the rest.
  const shownParts = minimumApplied ? rate.minimumFare : computed;
  const rounding = kobo(total - Math.round(shownParts * multiplier));
  return { base, distance, time, multiplier, minimumApplied, rounding, total };
}

/** Allowed passenger offer range for Negotiate (BR-040). */
export function negotiationRange(
  suggested: Kobo,
  category: VehicleCategoryId,
  config: PricingConfig,
): { min: Kobo; max: Kobo } {
  const { minPercent, maxPercent, stepKobo } = config.negotiation;
  const floor = Math.max(config.rates[category].minimumFare, suggested * minPercent);
  const min = roundUpTo(kobo(Math.ceil(floor)), stepKobo);
  const max = roundDownTo(kobo(Math.floor(suggested * maxPercent)), stepKobo);
  return { min, max: max < min ? min : max };
}

export function createQuote(params: {
  id: string;
  route: RouteEstimate;
  category: VehicleCategoryId;
  config: PricingConfig;
  now: number;
  multiplier?: number;
}): FareQuote {
  const breakdown = calculateFare(params.route, params.category, params.config, params.multiplier);
  return {
    id: params.id,
    category: params.category,
    breakdown,
    suggested: breakdown.total,
    negotiationRange: negotiationRange(breakdown.total, params.category, params.config),
    createdAt: params.now,
    expiresAt: params.now + params.config.quoteTtlSeconds * 1000,
    isSimulated: params.route.isSimulated,
  };
}

export function isQuoteExpired(quote: FareQuote, now: number): boolean {
  return quote.expiresAt <= now;
}

/** Driver earnings preview (BR-060). Commission is 0% (Q-002); processing fees are separate. */
export function driverEarnings(fare: Kobo, config: PricingConfig): { commission: Kobo; earnings: Kobo } {
  const commission = kobo(Math.round(fare * config.commissionRate));
  return { commission, earnings: kobo(fare - commission) };
}

/** Cancellation fee for a passenger cancellation (BR-080, BR-081). */
export function passengerCancellationFee(
  params: { matchedAt?: number; arrivedAt?: number; now: number },
  config: PricingConfig,
): Kobo {
  const { matchedAt, arrivedAt, now } = params;
  if (matchedAt === undefined) return kobo(0);
  if (arrivedAt !== undefined && now - arrivedAt >= config.cancellation.waitSeconds * 1000) return config.cancellation.fee;
  if (now - matchedAt <= config.cancellation.freeWindowSeconds * 1000) return kobo(0);
  return config.cancellation.fee;
}
