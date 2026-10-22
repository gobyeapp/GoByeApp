import type { Booking } from '../types';

/**
 * Live-trip helpers for the passenger UI (brief §7–8). Progress and ETA are derived from the trip
 * feed (driver fixes + ETA), never from a decorative countdown.
 */

/** A driver position older than this is shown as stale / reconnecting (placeholder, tune on device). */
export const RIDER_LOCATION_STALE_MS = 10_000;

export function isDriverLocationStale(b: Pick<Booking, 'driverLocationAt' | 'matchedAt' | 'startedAt'>, now: number): boolean {
  const last = b.driverLocationAt ?? b.startedAt ?? b.matchedAt;
  return last !== undefined && now - last > RIDER_LOCATION_STALE_MS;
}

/** 0..1 progress towards the current target (pickup, then destination); null until the feed reports an ETA. */
export function arrivalProgress(b: Pick<Booking, 'driverEtaSeconds' | 'driverEtaInitialSeconds'>): number | null {
  if (b.driverEtaSeconds === undefined || !b.driverEtaInitialSeconds) return null;
  return Math.max(0, Math.min(1, 1 - b.driverEtaSeconds / b.driverEtaInitialSeconds));
}
