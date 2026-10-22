import { bookingFare, logRelayEvent, type Booking, type Relay, type RelayPaymentStatus, type RelayRide, type RelayRider, type RelayWhere } from '@gobye/core';

/**
 * Rider-owned fields of a shared ride (D-049): the pickup PIN, the rider's choice of driver for a
 * negotiated ride, the payment state and a rider cancellation. The driver app writes its own fields
 * (position, stages), so each side only ever patches its own columns.
 */
export interface RidePatch {
  where: RelayWhere;
  patch: Partial<RelayRide>;
  /** Activity line for the admin feed. */
  event?: { type: string; summary: string };
}

const PAYMENT: Partial<Record<NonNullable<Booking['paymentStatus']>, RelayPaymentStatus>> = {
  pending: 'pending',
  processing: 'processing',
  paid: 'paid',
  failed: 'failed',
};

/** What changed between two snapshots of the active booking that the relay should know about. */
export function ridePatches(prev: Booking | null, b: Booking | null, now: number): RidePatch[] {
  if (!b) return [];
  const same = prev && prev.id === b.id ? prev : null;
  const out: RidePatch[] = [];
  // Negotiated ride: the rider picked a driver's answer → the ride is theirs (once, while still open).
  if (b.mode === 'negotiate' && b.driver && !same?.driver) {
    out.push({
      where: { id: b.id, status: 'negotiating' },
      patch: { status: 'accepted', driver_id: b.driver.id, driver: b.driver, agreed_fare: bookingFare(b), matched_at: b.matchedAt ?? now, updated_at: now },
      event: { type: 'ride.matched', summary: `Rider chose ${b.driver.firstName} at ${(bookingFare(b) / 100).toLocaleString('en-NG')} naira` },
    });
  }
  if (b.pickupPin && b.driver && same?.pickupPin !== b.pickupPin) out.push({ where: { id: b.id }, patch: { pickup_pin: b.pickupPin, updated_at: now } });
  const pay = b.paymentStatus ? PAYMENT[b.paymentStatus] : undefined;
  if (pay && pay !== (same?.paymentStatus ? PAYMENT[same.paymentStatus] : undefined)) {
    out.push({
      where: { id: b.id },
      patch: { payment_status: pay, updated_at: now },
      event: pay === 'paid' ? { type: 'ride.paid', summary: `Rider paid ${(bookingFare(b) / 100).toLocaleString('en-NG')} naira by ${b.paymentMethod.label}` } : undefined,
    });
  }
  return out;
}

export async function applyRidePatches(relay: Relay, patches: RidePatch[], rider: RelayRider | null, rideId: string) {
  for (const p of patches) {
    await relay.update<RelayRide>('demo_rides', p.where, p.patch);
    if (p.event) logRelayEvent(relay, { actor: 'rider', type: p.event.type, summary: p.event.summary, ride_id: rideId, person_id: rider?.id ?? null });
  }
}

/** The rider cancelled a matched ride (a search is withdrawn by the matching service itself). */
export function cancelRideOnRelay(relay: Relay | null, b: Booking, reason: string | undefined, rider: RelayRider | null) {
  if (!relay || !b.driver) return;
  const now = Date.now();
  void relay
    .update<RelayRide>('demo_rides', { id: b.id, status: { in: ['accepted', 'arrived', 'negotiating'] } }, { status: 'cancelled', cancelled_by: 'rider', cancel_reason: reason ?? null, updated_at: now })
    .then(() => logRelayEvent(relay, { actor: 'rider', type: 'ride.cancelled', summary: `${rider?.name ?? 'Rider'} cancelled the ride${reason ? `: ${reason}` : ''}`, ride_id: b.id, person_id: rider?.id ?? null }))
    .catch(() => undefined);
}

/** A ride ended by someone else (the driver or GoBye staff) while the rider still has it open. */
export function remoteCancellation(row: Pick<RelayRide, 'status' | 'cancelled_by' | 'cancel_reason'> | undefined): { by: 'driver' | 'admin'; message: string } | null {
  if (!row || row.status !== 'cancelled' || !row.cancelled_by || row.cancelled_by === 'rider') return null;
  if (row.cancelled_by === 'admin') return { by: 'admin', message: `GoBye support cancelled this ride${row.cancel_reason ? `: ${row.cancel_reason}` : '.'} You won’t be charged.` };
  return { by: 'driver', message: `Your driver cancelled${row.cancel_reason ? `: ${row.cancel_reason}` : ''}. You won’t be charged. Book again when you’re ready.` };
}
