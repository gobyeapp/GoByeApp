import { randomInt } from 'node:crypto';
import type { LatLng, ObjectStore } from '@gobye/core';
import type { Querier } from '../database/database';
import { Errors } from '../common/errors';

/**
 * Rides on the server (D-100). Shared by the rider, driver and staff controllers: reading a ride,
 * sending it to nearby drivers, ending a search that ran out of time, and the views each side sees.
 * Fares and negotiation rules come from @gobye/core; the database enforces "one active ride per driver"
 * and "one open ride per rider" (0004), so two people racing can never both win.
 */

export const DISPATCH = {
  /** How far from the pickup a driver may be to get the request. */
  radiusMeters: 6000,
  /** How many drivers see one request at a time. */
  maxDrivers: 8,
  /** How long a Quick Match search runs before "no drivers". */
  searchSeconds: 120,
  /** A driver's position older than this doesn't count as nearby. */
  locationFreshSeconds: 120,
  /** Straight-line distance is stretched by this for roads, then driven at this speed. Estimates only. */
  roadFactor: 1.3,
  speedMps: 7,
  pinAttempts: 5,
} as const;

export const OPEN = ['searching', 'negotiating'] as const;
export const WITH_DRIVER = ['matched', 'driver_en_route', 'driver_arrived', 'in_progress'] as const;

export interface RideRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  mode: 'quick_match' | 'negotiate';
  category: string;
  status: string;
  city: string;
  pickup_lat: string;
  pickup_lng: string;
  pickup_label: string;
  destination_lat: string;
  destination_lng: string;
  destination_label: string;
  quote_id: string | null;
  quoted_fare_kobo: string | null;
  agreed_fare_kobo: string | null;
  fare_locked_at: Date | null;
  version: number;
  created_at: Date;
  matched_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  channel: string;
  route_distance_m: number | null;
  route_duration_s: number | null;
  route_estimated: boolean;
  offer_id: string | null;
  offer_kobo: string | null;
  offer_round: number;
  offer_expires_at: Date | null;
  min_offer_kobo: string | null;
  max_offer_kobo: string | null;
  search_expires_at: Date | null;
  arrived_at: Date | null;
  pickup_pin: string | null;
  pin_attempts: number;
  cancel_reason: string | null;
  cancel_fee_kobo: string;
  payment_method: string | null;
  payment_claimed_at: Date | null;
  paid_at: Date | null;
  driver_stars: number | null;
  rider_stars: number | null;
}

const n = (v: string | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const at = (ms: number) => new Date(ms);

export function metersBetween(a: LatLng, b: LatLng): number {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
export const etaSeconds = (meters: number) => Math.round((meters * DISPATCH.roadFactor) / DISPATCH.speedMps);

/** Which launch city a point is in, or null when GoBye isn't there yet. Boxes are deliberately generous. */
export function cityAt(p: LatLng): 'lagos' | 'abuja' | null {
  if (p.latitude >= 6.2 && p.latitude <= 6.95 && p.longitude >= 2.6 && p.longitude <= 4.4) return 'lagos';
  if (p.latitude >= 8.6 && p.latitude <= 9.4 && p.longitude >= 6.8 && p.longitude <= 7.8) return 'abuja';
  return null;
}

export const newPin = () => String(randomInt(0, 10_000)).padStart(4, '0');

export async function loadRide(q: Querier, id: string, lock = false): Promise<RideRow | null> {
  const r = await q.query<RideRow>(`select * from app.rides where id = $1${lock ? ' for update' : ''}`, [id]);
  return r.rows[0] ?? null;
}

export async function rideEvent(q: Querier, rideId: string, type: string, actorKind: 'rider' | 'driver' | 'staff' | 'system', actorId: string | null, data: object = {}) {
  await q.query(`insert into app.ride_events (ride_id, type, actor_kind, actor_id, data) values ($1, $2, $3, $4, $5::jsonb)`, [rideId, type, actorKind, actorId, JSON.stringify(data)]);
}

export async function audit(q: Querier, a: { actorKind: 'rider' | 'driver' | 'staff' | 'system'; actorId: string | null; actorName: string; action: string; rideId: string; summary: string; data?: object; requestId?: string }) {
  await q.query(
    `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data, request_id)
     values ($1, $2, $3, $4, 'ride', $5, $6, $7::jsonb, $8)`,
    [a.actorKind, a.actorId, a.actorName, a.action, a.rideId, a.summary, JSON.stringify(a.data ?? {}), a.requestId ?? null],
  );
}

/** Bump the version and return the fresh row. Every change to a ride goes through here. */
export async function updateRide(q: Querier, id: string, set: string, params: unknown[]): Promise<RideRow> {
  const r = await q.query<RideRow>(`update app.rides set ${set}, version = version + 1 where id = $1 returning *`, [id, ...params]);
  return r.rows[0]!;
}

/**
 * Sends an open ride to the nearest drivers who are online, approved, in the right vehicle type, seen
 * recently and not on a ride. Drivers who already have this request are skipped, so calling it again
 * (every time the rider's app asks for news) widens the search to drivers who just came online.
 */
export async function dispatch(q: Querier, ride: RideRow, now: number): Promise<number> {
  const lat = Number(ride.pickup_lat);
  const lng = Number(ride.pickup_lng);
  const degLat = DISPATCH.radiusMeters / 111_000;
  const degLng = degLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const near = await q.query<{ driver_id: string; lat: string; lng: string }>(
    `select p.driver_id, p.lat, p.lng
       from app.driver_presence p
       join app.drivers d on d.user_id = p.driver_id and d.verification_status = 'approved' and d.city = $1
       join app.users u on u.id = p.driver_id and u.status = 'active'
      where p.online and p.category = $2 and p.located_at > $3
        and p.lat between $4 and $5 and p.lng between $6 and $7
        and p.driver_id <> $8
        and not exists (select 1 from app.rides a where a.driver_id = p.driver_id and a.status = any($9))
        and not exists (select 1 from app.ride_offers o where o.ride_id = $10 and o.driver_id = p.driver_id)`,
    [ride.city, ride.category, at(now - DISPATCH.locationFreshSeconds * 1000), lat - degLat, lat + degLat, lng - degLng, lng + degLng, ride.rider_id, [...WITH_DRIVER], ride.id],
  );
  const have = (await q.query<{ c: string }>(`select count(*) as c from app.ride_offers where ride_id = $1 and status in ('open', 'responded')`, [ride.id])).rows[0]!;
  const room = DISPATCH.maxDrivers - Number(have.c);
  if (room <= 0) return 0;
  const ranked = near.rows
    .map((d) => ({ id: d.driver_id, m: metersBetween({ latitude: lat, longitude: lng }, { latitude: Number(d.lat), longitude: Number(d.lng) }) }))
    .filter((d) => d.m <= DISPATCH.radiusMeters)
    .sort((a, b) => a.m - b.m)
    .slice(0, room);
  for (const d of ranked) {
    await q.query(`insert into app.ride_offers (ride_id, driver_id, distance_m, eta_seconds) values ($1, $2, $3, $4) on conflict (ride_id, driver_id) do nothing`, [ride.id, d.id, Math.round(d.m), etaSeconds(d.m)]);
  }
  return ranked.length;
}

/**
 * Ends a search that ran out of time ("no drivers"). Called whenever a ride is read or changed, so it
 * works without the background worker; the worker's sweep covers rides nobody is looking at.
 */
export async function expireIfDue(q: Querier, ride: RideRow, now: number): Promise<RideRow> {
  if (!(OPEN as readonly string[]).includes(ride.status) || !ride.search_expires_at || ride.search_expires_at.getTime() > now) return ride;
  const next = await updateRide(q, ride.id, `status = 'no_drivers'`, []);
  await q.query(`update app.ride_offers set status = 'expired' where ride_id = $1 and status in ('open', 'responded')`, [ride.id]);
  await rideEvent(q, ride.id, 'ride.no_drivers', 'system', null, {});
  return next;
}

/** All open rides past their time. Returns how many were ended. */
export async function sweepExpired(q: Querier, now: number): Promise<number> {
  const due = await q.query<RideRow>(`select * from app.rides where status = any($1) and search_expires_at <= $2 order by search_expires_at limit 200 for update skip locked`, [[...OPEN], at(now)]);
  for (const r of due.rows) await expireIfDue(q, r, now);
  return due.rows.length;
}

/* ---------- Views ---------- */

const place = (lat: string, lng: string, label: string) => ({ latitude: Number(lat), longitude: Number(lng), label });

function base(r: RideRow) {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    mode: r.mode,
    category: r.category,
    city: r.city,
    channel: r.channel,
    pickup: place(r.pickup_lat, r.pickup_lng, r.pickup_label),
    destination: place(r.destination_lat, r.destination_lng, r.destination_label),
    route: r.route_distance_m ? { distanceMeters: r.route_distance_m, durationSeconds: r.route_duration_s, estimated: r.route_estimated } : null,
    quotedFareKobo: n(r.quoted_fare_kobo),
    agreedFareKobo: n(r.agreed_fare_kobo),
    createdAt: iso(r.created_at),
    matchedAt: iso(r.matched_at),
    arrivedAt: iso(r.arrived_at),
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    cancelledAt: iso(r.cancelled_at),
    cancelledBy: r.cancelled_by,
    cancelFeeKobo: Number(r.cancel_fee_kobo),
    payment: { method: r.payment_method, claimedAt: iso(r.payment_claimed_at), paidAt: iso(r.paid_at) },
  };
}

interface DriverCard {
  id: string;
  firstName: string;
  rating: number | null;
  completedTrips: number;
  photoUrl: string | null;
  vehicle: { category: string; make: string; model: string; colour: string; plate: string } | null;
}

/** A short-lived link to the driver's approved profile photo, or null (never an unscanned file). */
async function photoUrl(q: Querier, storage: ObjectStore | null, driverId: string): Promise<string | null> {
  if (!storage) return null;
  try {
    const f = await q.query<{ bucket: string; object_key: string }>(
      `select f.bucket, f.object_key from app.driver_applications a join ops.files f on f.id::text = a.data -> 'personal' ->> 'photoUri'
        where a.driver_id = $1 and f.owner_id = $1 and f.file_class = 'profile_photo' and f.status = 'approved' and f.scan_status = 'clean'`,
      [driverId],
    );
    if (!f.rows[0]) return null;
    return (await storage.presignGet({ bucket: f.rows[0].bucket, key: f.rows[0].object_key, expiresIn: 600 })).url;
  } catch {
    return null;
  }
}

export async function driverCards(q: Querier, storage: ObjectStore | null, ids: string[]): Promise<Map<string, DriverCard>> {
  const out = new Map<string, DriverCard>();
  if (!ids.length) return out;
  const r = await q.query<{ id: string; full_name: string; rating: string | null; completed_trips: number; category: string | null; make: string | null; model: string | null; colour: string | null; plate: string | null }>(
    `select u.id, u.full_name, d.rating, d.completed_trips, v.category, v.make, v.model, v.colour, v.plate
       from app.users u join app.drivers d on d.user_id = u.id
       left join app.vehicles v on v.driver_id = u.id and v.status = 'active'
      where u.id = any($1)`,
    [ids],
  );
  for (const d of r.rows) {
    out.set(d.id, {
      id: d.id,
      firstName: d.full_name.trim().split(/\s+/)[0] ?? '',
      rating: d.rating === null ? null : Number(d.rating),
      completedTrips: d.completed_trips,
      photoUrl: await photoUrl(q, storage, d.id),
      vehicle: d.category ? { category: d.category, make: d.make!, model: d.model!, colour: d.colour!, plate: d.plate! } : null,
    });
  }
  return out;
}

/** What the rider sees. Includes the pickup PIN (theirs to read out) and, when owed, where to pay. */
export async function riderView(q: Querier, storage: ObjectStore | null, r: RideRow, now: number) {
  const v = base(r);
  const negotiating = r.status === 'negotiating';
  let responses: object[] = [];
  if (negotiating && r.offer_id) {
    const rows = await q.query<{ id: string; driver_id: string; response_kind: string; amount_kobo: string; eta_seconds: number; response_expires_at: Date; updated_at: Date }>(
      `select id, driver_id, response_kind, amount_kobo, eta_seconds, response_expires_at, updated_at from app.ride_offers
        where ride_id = $1 and status = 'responded' and for_offer_id = $2 and response_expires_at > $3 order by amount_kobo, eta_seconds`,
      [r.id, r.offer_id, at(now)],
    );
    const cards = await driverCards(q, storage, rows.rows.map((x) => x.driver_id));
    responses = rows.rows.map((x) => ({ id: x.id, offerId: r.offer_id, kind: x.response_kind, amountKobo: Number(x.amount_kobo), etaSeconds: x.eta_seconds, createdAt: iso(x.updated_at), expiresAt: iso(x.response_expires_at), driver: cards.get(x.driver_id) ?? null }));
  }
  let driver: object | null = null;
  if (r.driver_id) {
    const card = (await driverCards(q, storage, [r.driver_id])).get(r.driver_id) ?? null;
    const live = (WITH_DRIVER as readonly string[]).includes(r.status);
    const p = live ? (await q.query<{ lat: string | null; lng: string | null; heading: number | null; located_at: Date | null }>(`select lat, lng, heading, located_at from app.driver_presence where driver_id = $1`, [r.driver_id])).rows[0] : undefined;
    const loc = p?.lat && p.lng && p.located_at ? { latitude: Number(p.lat), longitude: Number(p.lng), heading: p.heading, at: iso(p.located_at), stale: now - p.located_at.getTime() > 30_000 } : null;
    const target = r.status === 'in_progress' ? { latitude: Number(r.destination_lat), longitude: Number(r.destination_lng) } : { latitude: Number(r.pickup_lat), longitude: Number(r.pickup_lng) };
    driver = { ...card, location: loc, etaSeconds: loc && r.status !== 'driver_arrived' ? etaSeconds(metersBetween(loc, target)) : null };
  }
  let payTo: object | null = null;
  if (r.status === 'payment_pending' && r.driver_id) {
    const a = (await q.query<{ bank_name: string; account_number: string; account_name: string }>(`select bank_name, account_number, account_name from app.driver_payout_accounts where driver_id = $1`, [r.driver_id])).rows[0];
    payTo = a ? { bankName: a.bank_name, accountNumber: a.account_number, accountName: a.account_name } : null;
  }
  return {
    ...v,
    offer: r.offer_id ? { id: r.offer_id, amountKobo: n(r.offer_kobo), round: r.offer_round, expiresAt: iso(r.offer_expires_at), minKobo: n(r.min_offer_kobo), maxKobo: n(r.max_offer_kobo) } : null,
    responses,
    searchExpiresAt: iso(r.search_expires_at),
    driver,
    pickupPin: ['driver_en_route', 'driver_arrived', 'matched'].includes(r.status) ? r.pickup_pin : null,
    payTo,
    rating: { driverStars: r.driver_stars },
  };
}

/** What the assigned driver sees. Never the rider's phone, email or surname, and never the PIN. */
export async function driverView(q: Querier, r: RideRow) {
  const rider = (await q.query<{ full_name: string; rating: string | null }>(`select u.full_name, r.rating from app.users u join app.riders r on r.user_id = u.id where u.id = $1`, [r.rider_id])).rows[0];
  return {
    ...base(r),
    rider: { firstName: rider?.full_name.trim().split(/\s+/)[0] ?? 'Rider', rating: rider?.rating ? Number(rider.rating) : null },
    pinRequired: r.pickup_pin !== null,
    rating: { riderStars: r.rider_stars },
  };
}

/** Running average kept on the person's row: no need to read every past rating. */
export async function addRating(q: Querier, table: 'riders' | 'drivers', userId: string, stars: number) {
  await q.query(
    `update app.${table} set rating = round(((coalesce(rating, 0) * rating_count) + $2) / (rating_count + 1), 2), rating_count = rating_count + 1 where user_id = $1`,
    [userId, stars],
  );
}

export const notYours = () => Errors.notFound('Ride not found.');
