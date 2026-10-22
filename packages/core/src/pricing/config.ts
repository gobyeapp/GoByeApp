import { naira } from '../money';
import type { PricingConfig, VehicleCategory, VehicleCategoryId } from '../types';

/**
 * MOCK PRICING CONFIGURATION — PLACEHOLDER VALUES ONLY.
 * None of these numbers are confirmed business policy (docs/BUSINESS_RULES.md,
 * docs/OPEN_QUESTIONS.md Q-002, Q-019–Q-022). The backend will be the pricing authority.
 */
export const MOCK_PRICING_CONFIG: PricingConfig = {
  currency: 'NGN',
  roundingStep: naira(50),
  rates: {
    keke: { base: naira(300), perKm: naira(120), perMinute: naira(15), minimumFare: naira(600) },
    go: { base: naira(500), perKm: naira(180), perMinute: naira(25), minimumFare: naira(1200) },
    comfort: { base: naira(800), perKm: naira(250), perMinute: naira(35), minimumFare: naira(2000) },
    xl: { base: naira(1000), perKm: naira(320), perMinute: naira(40), minimumFare: naira(2800) },
  },
  negotiation: {
    minPercent: 0.75,
    maxPercent: 1.5,
    offerTtlSeconds: 90,
    responseTtlSeconds: 30,
    stepKobo: naira(50),
    maxRounds: 3,
  },
  quoteTtlSeconds: 5 * 60,
  // Q-002 decided: 0% per-trip commission; drivers pay for access packages (payments.ts).
  commissionRate: 0,
  cancellation: { freeWindowSeconds: 120, waitSeconds: 300, fee: naira(500) },
};

export const VEHICLE_CATEGORIES: readonly VehicleCategory[] = [
  { id: 'keke', name: 'GoBye Keke', seats: 3, description: 'Tricycle for short hops' },
  { id: 'go', name: 'GoBye Car', seats: 4, description: 'Comfortable everyday car rides' },
  { id: 'comfort', name: 'GoBye Comfort', seats: 4, description: 'Newer cars, top rated drivers' },
  { id: 'xl', name: 'GoBye XL', seats: 6, description: 'Room for groups and luggage' },
] as const;

export function getCategory(id: VehicleCategoryId): VehicleCategory {
  const found = VEHICLE_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown vehicle category ${id}`);
  return found;
}
