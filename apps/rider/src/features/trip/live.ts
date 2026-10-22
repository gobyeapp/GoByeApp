import { haversineMeters, type Booking } from '@gobye/core';

/** Seconds since the last driver position (falls back to match / start time). */
export function locationAgeSeconds(b: Pick<Booking, 'driverLocationAt' | 'matchedAt' | 'startedAt'>, now: number): number | null {
  const at = b.driverLocationAt ?? b.startedAt ?? b.matchedAt;
  return at ? Math.max(0, Math.round((now - at) / 1000)) : null;
}

/** "Updated just now" / "Updated 12 s ago" / "Updated 3 min ago" — never implies a fresh position. */
export function freshnessLabel(ageSeconds: number | null): string {
  if (ageSeconds === null) return 'Waiting for the driver’s location';
  if (ageSeconds < 5) return 'Updated just now';
  if (ageSeconds < 60) return `Updated ${ageSeconds} s ago`;
  return `Updated ${Math.floor(ageSeconds / 60)} min ago`;
}

/**
 * Delayed: the driver hasn't arrived and either the latest ETA is at least 2 minutes longer than the
 * first estimate, or more than 3 minutes have passed beyond the first estimate since the match.
 */
export function isDriverDelayed(b: Pick<Booking, 'status' | 'driverEtaSeconds' | 'driverEtaInitialSeconds' | 'matchedAt'>, now: number): boolean {
  if (b.status !== 'matched' && b.status !== 'driver_en_route') return false;
  const initial = b.driverEtaInitialSeconds;
  if (initial === undefined) return false;
  if (b.driverEtaSeconds !== undefined && b.driverEtaSeconds - initial >= 120) return true;
  return !!b.matchedAt && now - b.matchedAt > (initial + 180) * 1000;
}

/** Straight-line distance from the driver to the pickup point (approximate, not road distance). */
export function distanceToPickup(b: Pick<Booking, 'driver' | 'pickup'>): number | null {
  return b.driver ? haversineMeters(b.driver.coordinate, b.pickup.coordinate) : null;
}

/** Local clock time `seconds` from now, e.g. "18:42". */
export function clockIn(now: number, seconds: number): string {
  return new Date(now + seconds * 1000).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Short trip reference shown to passengers and on receipts, e.g. "#K3F9A2". */
export function tripReference(id: string): string {
  return `#${id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`;
}

/** Bank transfer reference for a trip payment, e.g. "GBK3F9A2" (no "#", so it pastes cleanly into bank apps). */
export function paymentReference(id: string): string {
  return `GB${tripReference(id).slice(1)}`;
}
