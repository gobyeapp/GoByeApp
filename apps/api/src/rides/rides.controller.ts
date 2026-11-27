import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MOCK_PRICING_CONFIG, VEHICLE_CATEGORIES, createQuote, offerErrorMessage, passengerCancellationFee, validateOffer, type FareQuote, type Kobo, type PassengerOffer, type VehicleCategoryId } from '@gobye/core';
import { CLOCK, CONFIG, DATABASE, PROVIDERS } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import type { Providers } from '../providers/ports';
import { AppError, Errors } from '../common/errors';
import { validate } from '../common/validation';
import { DISPATCH, OPEN, WITH_DRIVER, addRating, at, audit, cityAt, notifyRide, dispatch, expireIfDue, loadRide, newPin, notYours, rideEvent, riderView, updateRide, type RideRow } from './rides.repository';
import { payByWallet } from '../money/ride-payment';

const Point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), label: z.string().trim().min(1, 'Add a name for this place.').max(200) }).strict();
const QuoteBody = z.object({ pickup: Point, destination: Point }).strict();
const BookBody = z.object({ quoteId: z.string().uuid(), mode: z.enum(['quick_match', 'negotiate']), offerKobo: z.number().int().positive().max(100_000_000).optional() }).strict();
const OfferBody = z.object({ amountKobo: z.number().int().positive().max(100_000_000) }).strict();
const SelectBody = z.object({ responseId: z.string().uuid() }).strict();
const CancelBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();
const PayBody = z.object({ method: z.enum(['transfer', 'cash', 'wallet']) }).strict();
const RateBody = z.object({ stars: z.number().int().min(1).max(5) }).strict();
const Id = z.object({ id: z.string().uuid('Must be a ride id.') }).strict();
const List = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }).strict();

interface QuoteRow {
  id: string;
  rider_id: string;
  category: VehicleCategoryId;
  city: string;
  pickup_lat: string;
  pickup_lng: string;
  pickup_label: string;
  destination_lat: string;
  destination_lng: string;
  destination_label: string;
  distance_m: number;
  duration_s: number;
  estimated: boolean;
  suggested_kobo: string;
  min_offer_kobo: string;
  max_offer_kobo: string;
  created_at: Date;
  expires_at: Date;
}

/** The parts of a quote the negotiation rules in @gobye/core read. */
const quoteFor = (min: number, max: number, expiresAt: number): FareQuote => ({ negotiationRange: { min: min as Kobo, max: max as Kobo }, expiresAt }) as FareQuote;

export const UNPAID = () => new AppError(409, 'UNPAID_RIDE', 'Pay for your last trip before booking another.');
export const OPEN_RIDE = () => new AppError(409, 'OPEN_RIDE', 'You already have a ride in progress.');

/**
 * Rides for riders (D-100): get prices, book (Quick Match or Negotiate), follow the ride, cancel, pay the
 * driver, rate. The app asks for news with GET /v1/rides/{id} every few seconds (ETag = version, so an
 * unchanged ride costs almost nothing).
 */
@Controller()
export class RidesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** POST /v1/quotes: a price for every vehicle type, worked out here from the route. */
  @Post('quotes')
  async quotes(@Body(validate(QuoteBody)) body: z.infer<typeof QuoteBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    const city = cityAt(body.pickup);
    if (!city || cityAt(body.destination) !== city) throw new AppError(422, 'OUT_OF_AREA', 'GoBye isn’t available for this trip yet. Pickup and destination must both be in Lagos or both in Abuja.');
    // Outside the transaction: a slow maps provider must not hold a database connection.
    const route = await this.providers.maps.route(body.pickup, body.destination);
    if (!(route.distanceMeters >= 1) || !(route.durationSeconds >= 1)) throw Errors.validation({ destination: 'Choose a destination that is not the pickup point.' });
    const estimated = this.providers.maps.name === 'fake';
    return this.write(p, key, 'POST', '/v1/quotes', body, reply, async (tx) => {
      const now = this.now();
      const batchId = randomUUID();
      const out = [];
      for (const c of VEHICLE_CATEGORIES) {
        const q = createQuote({ id: randomUUID(), route: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, polyline: [], isSimulated: estimated }, category: c.id, config: MOCK_PRICING_CONFIG, now });
        await tx.query(
          `insert into app.fare_quotes (id, batch_id, rider_id, category, city, pickup_lat, pickup_lng, pickup_label, destination_lat, destination_lng, destination_label,
                                        distance_m, duration_s, estimated, suggested_kobo, min_offer_kobo, max_offer_kobo, breakdown, created_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20)`,
          [q.id, batchId, p.userId, c.id, city, body.pickup.latitude.toFixed(6), body.pickup.longitude.toFixed(6), body.pickup.label, body.destination.latitude.toFixed(6), body.destination.longitude.toFixed(6), body.destination.label,
            Math.round(route.distanceMeters), Math.round(route.durationSeconds), estimated, q.suggested, q.negotiationRange.min, q.negotiationRange.max, JSON.stringify(q.breakdown), at(now), at(q.expiresAt)],
        );
        out.push({ id: q.id, category: c.id, suggestedKobo: q.suggested, minOfferKobo: q.negotiationRange.min, maxOfferKobo: q.negotiationRange.max, breakdown: q.breakdown, expiresAt: new Date(q.expiresAt).toISOString() });
      }
      return { status: 201, body: { city, route: { distanceMeters: Math.round(route.distanceMeters), durationSeconds: Math.round(route.durationSeconds), polyline: route.polyline, estimated }, quotes: out } };
    });
  }

  /** POST /v1/rides: book from a quote. The fare always comes from the stored quote, never the request. */
  @Post('rides')
  async book(@Body(validate(BookBody)) body: z.infer<typeof BookBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    return this.write(p, key, 'POST', '/v1/rides', body, reply, async (tx) => {
      const now = this.now();
      const q = (await tx.query<QuoteRow>(`select * from app.fare_quotes where id = $1 and rider_id = $2`, [body.quoteId, p.userId])).rows[0];
      if (!q) throw Errors.notFound('That price is no longer available. Get a new one.');
      if (q.expires_at.getTime() <= now) throw new AppError(409, 'QUOTE_EXPIRED', 'This price has expired. Get a new one.');
      if ((await tx.query(`select 1 from app.rides where rider_id = $1 and status = 'payment_pending' limit 1`, [p.userId])).rows[0]) throw UNPAID();
      const suggested = Number(q.suggested_kobo);
      const negotiate = body.mode === 'negotiate';
      let offer: PassengerOffer | null = null;
      if (negotiate) {
        if (body.offerKobo === undefined) throw Errors.validation({ offerKobo: 'Enter your offer.' });
        const v = validateOffer(body.offerKobo, quoteFor(Number(q.min_offer_kobo), Number(q.max_offer_kobo), q.expires_at.getTime()), MOCK_PRICING_CONFIG, now);
        if (!v.ok) throw Errors.validation({ offerKobo: offerErrorMessage(v.error) });
        offer = { id: randomUUID(), amount: v.value, round: 1, createdAt: now, expiresAt: now + MOCK_PRICING_CONFIG.negotiation.offerTtlSeconds * 1000 };
      } else if (body.offerKobo !== undefined) throw Errors.validation({ offerKobo: 'Quick Match uses the quoted fare.' });

      await tx.query('savepoint book');
      let ride: RideRow;
      try {
        ride = (
          await tx.query<RideRow>(
            `insert into app.rides (rider_id, mode, category, status, city, pickup_lat, pickup_lng, pickup_label, destination_lat, destination_lng, destination_label,
                                    quote_id, quoted_fare_kobo, agreed_fare_kobo, fare_locked_at, channel, route_distance_m, route_duration_s, route_estimated,
                                    offer_id, offer_kobo, offer_round, offer_expires_at, min_offer_kobo, max_offer_kobo, search_expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'app', $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) returning *`,
            [p.userId, body.mode, q.category, negotiate ? 'negotiating' : 'searching', q.city, q.pickup_lat, q.pickup_lng, q.pickup_label, q.destination_lat, q.destination_lng, q.destination_label,
              q.id, suggested, negotiate ? null : suggested, negotiate ? null : at(now), q.distance_m, q.duration_s, q.estimated,
              offer?.id ?? null, offer?.amount ?? null, offer ? 1 : 0, offer ? at(offer.expiresAt) : null, q.min_offer_kobo, q.max_offer_kobo,
              at(offer ? offer.expiresAt : now + DISPATCH.searchSeconds * 1000)],
          )
        ).rows[0]!;
      } catch (e) {
        await tx.query('rollback to savepoint book');
        if ((e as { code?: string }).code === '23505') throw OPEN_RIDE();
        throw e;
      }
      const sent = await dispatch(tx, ride, now);
      const data = { mode: body.mode, category: q.category, quotedFareKobo: suggested, offerKobo: offer?.amount ?? null, driversNotified: sent, estimatedRoute: q.estimated };
      await rideEvent(tx, ride.id, 'ride.requested', 'rider', p.userId, data);
      await audit(tx, { actorKind: 'rider', actorId: p.userId, actorName: 'Rider', action: 'ride.requested', rideId: ride.id, summary: negotiate ? 'Negotiate ride requested' : 'Quick Match ride requested', data, requestId: req.id });
      return { status: 201, body: await riderView(tx, this.providers.storage, ride, now) };
    });
  }

  /** GET /v1/rides/current: the ride in progress or awaiting payment, or null. */
  @Get('rides/current')
  async current(@CurrentPrincipal() p: Principal) {
    this.rider(p);
    const r = (await this.db.query<{ id: string }>(`select id from app.rides where rider_id = $1 and status = any($2) order by created_at desc limit 1`, [p.userId, [...OPEN, ...WITH_DRIVER, 'payment_pending']])).rows[0];
    if (!r) return { ride: null };
    return { ride: await this.read(p, r.id) };
  }

  /** GET /v1/rides: past rides, newest first. */
  @Get('rides')
  async list(@Query(validate(List)) q: z.infer<typeof List>, @CurrentPrincipal() p: Principal) {
    this.rider(p);
    const rows = await this.db.query<RideRow>(`select * from app.rides where rider_id = $1 and created_at < $2 order by created_at desc limit $3`, [p.userId, q.before ? new Date(q.before) : new Date(this.now() + 60_000), q.limit + 1]);
    const page = rows.rows.slice(0, q.limit);
    const now = this.now();
    const rides = [];
    for (const r of page) rides.push(await riderView(this.db, null, r, now));
    return { rides, nextBefore: rows.rows.length > q.limit ? page[page.length - 1]!.created_at.toISOString() : null };
  }

  /** GET /v1/rides/{id}: the ride now. Also widens the search to drivers who just came online. */
  @Get('rides/:id')
  async get(@Param(validate(Id)) params: z.infer<typeof Id>, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    const view = await this.read(p, params.id);
    reply.header('etag', `"${view.version}"`);
    return view;
  }

  /** POST /v1/rides/{id}/offers: raise the offer (Negotiate). Earlier driver answers no longer apply. */
  @Post('rides/:id/offers')
  @HttpCode(200)
  async raise(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(OfferBody)) body: z.infer<typeof OfferBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    return this.write(p, key, 'POST', `/v1/rides/${params.id}/offers`, body, reply, async (tx) => {
      const now = this.now();
      const r = await this.own(tx, p, params.id, now);
      if (r.status !== 'negotiating' || !r.offer_id) throw Errors.conflict('This ride isn’t open for offers.');
      const prev: PassengerOffer = { id: r.offer_id, amount: Number(r.offer_kobo) as Kobo, round: r.offer_round, createdAt: 0, expiresAt: r.offer_expires_at!.getTime() };
      const v = validateOffer(body.amountKobo, quoteFor(Number(r.min_offer_kobo), Number(r.max_offer_kobo), 0), MOCK_PRICING_CONFIG, now, prev);
      if (!v.ok) throw Errors.validation({ amountKobo: offerErrorMessage(v.error) });
      const expires = now + MOCK_PRICING_CONFIG.negotiation.offerTtlSeconds * 1000;
      const next = await updateRide(tx, r.id, `offer_id = $2, offer_kobo = $3, offer_round = offer_round + 1, offer_expires_at = $4, search_expires_at = $4`, [randomUUID(), v.value, at(expires)]);
      // Every driver who saw it gets the new offer to answer, including those who declined the lower one.
      await tx.query(`update app.ride_offers set status = 'open', response_kind = null, amount_kobo = null, for_offer_id = null, response_expires_at = null where ride_id = $1 and status in ('open', 'responded', 'declined')`, [r.id]);
      await dispatch(tx, next, now);
      await rideEvent(tx, r.id, 'ride.offer_raised', 'rider', p.userId, { amountKobo: v.value, round: next.offer_round });
      return { status: 200, body: await riderView(tx, this.providers.storage, next, now) };
    });
  }

  /** POST /v1/rides/{id}/select: accept one driver's answer. The fare locks at that amount. */
  @Post('rides/:id/select')
  @HttpCode(200)
  async select(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(SelectBody)) body: z.infer<typeof SelectBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    return this.write(p, key, 'POST', `/v1/rides/${params.id}/select`, body, reply, async (tx) => {
      const now = this.now();
      const r = await this.own(tx, p, params.id, now);
      if (r.status !== 'negotiating') throw new AppError(409, 'ALREADY_LOCKED', 'This ride already has a driver or has ended.');
      const o = (await tx.query<{ id: string; driver_id: string; amount_kobo: string; response_expires_at: Date; for_offer_id: string; status: string }>(`select * from app.ride_offers where id = $1 and ride_id = $2 for update`, [body.responseId, r.id])).rows[0];
      if (!o || o.status !== 'responded' || o.for_offer_id !== r.offer_id) throw new AppError(409, 'RESPONSE_GONE', 'That offer is no longer available.');
      if (o.response_expires_at.getTime() <= now) throw new AppError(409, 'RESPONSE_EXPIRED', 'That driver’s offer has expired. Choose another or wait for new responses.');
      const next = await assign(tx, r, o.driver_id, Number(o.amount_kobo), now);
      await rideEvent(tx, r.id, 'ride.matched', 'rider', p.userId, { driverId: o.driver_id, agreedFareKobo: Number(o.amount_kobo), via: 'negotiation' });
      await notifyRide(tx, next, 'matched');
      await audit(tx, { actorKind: 'rider', actorId: p.userId, actorName: 'Rider', action: 'ride.fare_locked', rideId: r.id, summary: 'Rider accepted a driver’s price', data: { driverId: o.driver_id, agreedFareKobo: Number(o.amount_kobo) }, requestId: req.id });
      return { status: 200, body: await riderView(tx, this.providers.storage, next, now) };
    });
  }

  /** POST /v1/rides/{id}/cancel: before the trip starts. A fee may apply once a driver is on the way. */
  @Post('rides/:id/cancel')
  @HttpCode(200)
  async cancel(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(CancelBody)) body: z.infer<typeof CancelBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    return this.write(p, key, 'POST', `/v1/rides/${params.id}/cancel`, body, reply, async (tx) => {
      const now = this.now();
      const r = await this.own(tx, p, params.id, now);
      if (r.status === 'cancelled') return { status: 200, body: await riderView(tx, this.providers.storage, r, now) };
      if (![...OPEN, 'matched', 'driver_en_route', 'driver_arrived'].includes(r.status)) throw Errors.conflict('This ride can’t be cancelled now.');
      const fee = passengerCancellationFee({ matchedAt: r.matched_at?.getTime(), arrivedAt: r.arrived_at?.getTime(), now }, MOCK_PRICING_CONFIG);
      const next = await updateRide(tx, r.id, `status = 'cancelled', cancelled_at = $2, cancelled_by = 'rider', cancel_reason = $3, cancel_fee_kobo = $4`, [at(now), body.reason ?? null, fee]);
      await tx.query(`update app.ride_offers set status = 'expired' where ride_id = $1 and status in ('open', 'responded')`, [r.id]);
      await rideEvent(tx, r.id, 'ride.cancelled', 'rider', p.userId, { feeKobo: fee, hadDriver: !!r.driver_id });
      await notifyRide(tx, { ...next, driver_id: r.driver_id }, 'cancelled_by_rider');
      await audit(tx, { actorKind: 'rider', actorId: p.userId, actorName: 'Rider', action: 'ride.cancelled', rideId: r.id, summary: 'Rider cancelled the ride', data: { feeKobo: fee, reason: body.reason ?? null }, requestId: req.id });
      return { status: 200, body: await riderView(tx, this.providers.storage, next, now) };
    });
  }

  /**
   * POST /v1/rides/{id}/payment: after the trip (D-030). `transfer` and `cash` go straight to the driver,
   * who confirms receiving it: until then the ride stays "payment pending", never "paid". `wallet` moves
   * money in the ledger and completes the ride at once (only when wallet money is switched on).
   */
  @Post('rides/:id/payment')
  @HttpCode(200)
  async pay(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(PayBody)) body: z.infer<typeof PayBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    if (body.method === 'cash' && !this.config.RIDE_CASH_ENABLED) throw Errors.conflict('Cash isn’t available. Pay by bank transfer.');
    if (body.method === 'wallet' && !this.config.WALLET_ENABLED) throw Errors.notConfigured('Paying from the wallet');
    return this.write(p, key, 'POST', `/v1/rides/${params.id}/payment`, body, reply, async (tx) => {
      const now = this.now();
      const r = await this.own(tx, p, params.id, now);
      if (r.status === 'completed' && r.payment_method === body.method) return { status: 200, body: await riderView(tx, this.providers.storage, r, now) };
      if (r.status !== 'payment_pending') throw Errors.conflict('This ride isn’t waiting for payment.');
      let next: RideRow;
      if (body.method === 'wallet') {
        const ref = await payByWallet(tx, r, now);
        next = await updateRide(tx, r.id, `status = 'completed', payment_method = 'wallet', payment_claimed_at = $2, paid_at = $2, payment_reference = $3`, [at(now), ref]);
      } else {
        next = await updateRide(tx, r.id, `payment_method = $2, payment_claimed_at = $3`, [body.method, at(now)]);
      }
      await rideEvent(tx, r.id, body.method === 'wallet' ? 'ride.paid' : 'ride.payment_claimed', 'rider', p.userId, { method: body.method });
      await notifyRide(tx, next, body.method === 'wallet' ? 'paid' : 'payment_claimed');
      await audit(tx, { actorKind: 'rider', actorId: p.userId, actorName: 'Rider', action: body.method === 'wallet' ? 'ride.paid' : 'ride.payment_claimed', rideId: r.id, summary: body.method === 'wallet' ? 'Paid from the wallet' : `Rider says they paid by ${body.method}`, data: { method: body.method, amountKobo: Number(r.agreed_fare_kobo) }, requestId: req.id });
      return { status: 200, body: await riderView(tx, this.providers.storage, next, now) };
    });
  }

  /** POST /v1/rides/{id}/rating: stars for the driver, once, after the trip. */
  @Post('rides/:id/rating')
  @HttpCode(200)
  async rate(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(RateBody)) body: z.infer<typeof RateBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.rider(p);
    return this.write(p, key, 'POST', `/v1/rides/${params.id}/rating`, body, reply, async (tx) => {
      const now = this.now();
      const r = await this.own(tx, p, params.id, now);
      if (!['payment_pending', 'completed'].includes(r.status) || !r.driver_id) throw Errors.conflict('You can rate a trip once it has ended.');
      if (r.driver_stars !== null) throw Errors.conflict('You have already rated this trip.');
      const next = await updateRide(tx, r.id, `driver_stars = $2`, [body.stars]);
      await addRating(tx, 'drivers', r.driver_id, body.stars);
      await rideEvent(tx, r.id, 'ride.driver_rated', 'rider', p.userId, { stars: body.stars });
      return { status: 200, body: await riderView(tx, this.providers.storage, next, now) };
    });
  }

  /* ---------- helpers ---------- */

  private rider(p: Principal) {
    if (!p.user?.isRider) throw Errors.forbidden('Create a rider account first.');
  }

  /** The rider's own ride, locked, with an overdue search ended. Someone else's ride reads as "not found". */
  private async own(tx: Querier, p: Principal, id: string, now: number): Promise<RideRow> {
    const r = await loadRide(tx, id, true);
    if (!r || r.rider_id !== p.userId) throw notYours();
    return expireIfDue(tx, r, now);
  }

  private async read(p: Principal, id: string) {
    const now = this.now();
    const peek = await loadRide(this.db, id);
    if (!peek || peek.rider_id !== p.userId) throw notYours();
    // Only an open ride needs a transaction (to end an overdue search or reach more drivers).
    if (!(OPEN as readonly string[]).includes(peek.status)) return riderView(this.db, this.providers.storage, peek, now);
    return this.db.tx(async (tx) => {
      let r = await this.own(tx, p, id, now);
      if ((OPEN as readonly string[]).includes(r.status)) {
        await dispatch(tx, r, now);
        r = (await loadRide(tx, id))!;
      }
      return riderView(tx, this.providers.storage, r, now);
    });
  }

  private async write<T>(p: Principal, key: string | undefined, method: string, path: string, hashed: unknown, reply: FastifyReply, fn: (tx: Querier) => Promise<{ status: number; body: T }>): Promise<T> {
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method, path, hash: requestHash(method, path, hashed) }, fn);
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    const v = (out.body as { version?: number })?.version;
    if (typeof v === 'number') reply.header('etag', `"${v}"`);
    return out.body;
  }
}

/**
 * Gives the ride to a driver at a fare. The unique index "one active ride per driver" decides races: the
 * loser gets DRIVER_UNAVAILABLE and nothing changes.
 */
export async function assign(tx: Querier, r: RideRow, driverId: string, fareKobo: number, now: number): Promise<RideRow> {
  await tx.query('savepoint assign');
  try {
    const next = await updateRide(tx, r.id, `driver_id = $2, status = 'driver_en_route', matched_at = $3, agreed_fare_kobo = $4, fare_locked_at = coalesce(fare_locked_at, $3), pickup_pin = $5, pin_attempts = 0, search_expires_at = null`, [driverId, at(now), fareKobo, newPin()]);
    await tx.query(`update app.ride_offers set status = case when driver_id = $2 then 'won' else 'lost' end where ride_id = $1 and status in ('open', 'responded')`, [r.id, driverId]);
    // The driver stops seeing other requests while on this ride.
    await tx.query(`update app.ride_offers set status = 'expired' where driver_id = $1 and ride_id <> $2 and status in ('open', 'responded')`, [driverId, r.id]);
    return next;
  } catch (e) {
    await tx.query('rollback to savepoint assign');
    if ((e as { code?: string }).code === '23505') throw new AppError(409, 'DRIVER_UNAVAILABLE', 'This driver is no longer available.');
    throw e;
  }
}
