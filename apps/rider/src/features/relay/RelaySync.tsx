import { useEffect, useRef } from 'react';
import { logRelayEvent, personRow, poll, type Booking, type RelayPerson, type RelayRide } from '@gobye/core';
import { useToast } from '@gobye/ui';
import { useBooking } from '@/state/booking';
import { getRelayRider, relay, setRelayRider } from '@/state/relay';
import { useSession } from '@/state/session';
import { applyRidePatches, remoteCancellation, ridePatches } from './sync';

const WATCHED: Booking['status'][] = ['searching', 'negotiating', 'matched', 'driver_en_route', 'driver_arrived', 'in_progress'];

/**
 * Keeps the demo relay (D-049) in step with this phone: the rider's account (so staff see them in the
 * admin), the rider-owned fields of the active ride, and rides ended by the driver or by staff.
 * Renders nothing; does nothing when no relay is configured.
 */
export function RelaySync() {
  const { user, homeCity } = useSession();
  const booking = useBooking();
  const toast = useToast();
  const b = booking.booking;

  // Who is booking (read by the relay matching service when a ride is published).
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  useEffect(() => {
    setRelayRider(user && name ? { id: user.phone, name, phone: user.phone, rating: user.rating ?? 5 } : null);
  }, [user, name]);

  // The rider's account row, refreshed every minute while the app is open (last seen).
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!relay || !user || !name) return;
    const r = relay;
    const write = () =>
      r.upsert<RelayPerson>('demo_people', personRow({ role: 'rider', phone: user.phone, name, email: user.email ?? null, city: homeCity }, Date.now(), user.createdAt)).then(() => {
        if (announced.current === user.phone) return;
        announced.current = user.phone;
        logRelayEvent(r, { actor: 'rider', type: 'rider.active', summary: `${name} is using the rider app`, person_id: user.phone });
      });
    return poll(write, 60_000);
  }, [user, name, homeCity]);

  // Rider-owned ride fields: PIN, chosen driver (negotiate), payment state.
  const prev = useRef<Booking | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = b;
    if (!relay || !b) return;
    const patches = ridePatches(before, b, Date.now());
    if (patches.length) void applyRidePatches(relay, patches, getRelayRider(), b.id).catch(() => undefined);
  }, [b]);

  // A ride ended by the driver or by staff: tell the rider and close it instead of leaving them waiting.
  const watching = !!b && WATCHED.includes(b.status);
  const rideId = b?.id;
  const endRef = useRef(booking.endRemotely);
  endRef.current = booking.endRemotely;
  useEffect(() => {
    if (!relay || !watching || !rideId) return;
    const r = relay;
    let done = false;
    const stop = poll(async () => {
      if (done) return;
      const [row] = await r.select<RelayRide>('demo_rides', { where: { id: rideId } });
      const ended = remoteCancellation(row);
      if (!ended) return;
      done = true;
      stop();
      toast(ended.message, 'error');
      endRef.current(ended.by === 'admin' ? 'Cancelled by GoBye support' : row.cancel_reason ?? 'Driver cancelled');
    }, 3_000);
    return () => {
      done = true;
      stop();
    };
  }, [watching, rideId, toast]);

  return null;
}
