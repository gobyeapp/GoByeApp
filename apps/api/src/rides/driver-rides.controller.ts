import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MOCK_PRICING_CONFIG, validateDriverResponse, type FareQuote, type Kobo, type PassengerOffer } from '@gobye/core';
import { CLOCK, CONFIG, DATABASE } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AppError, Errors } from '../common/errors';
import { validate } from '../common/validation';
import { hasDriverAccess } from '../subscriptions/access';
import { DISPATCH, WITH_DRIVER, addRating, at, audit, dispatch, driverView, expireIfDue, loadRide, metersBetween, newPin, notYours, notifyRide, rideEvent, updateRide, type RideRow } from './rides.repository';
import { assign } from './rides.controller';

const Fix = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), heading: z.number().min(0).max(360).optional(), accuracyMeters: z.number().min(0).max(100_000).optional() }).strict();
const PresenceBody = z.object({ online: z.boolean(), location: Fix.optional() }).strict();
const RideId = z.object({ rideId: z.string().uuid('Must be a ride id.') }).strict();
const Id = z.object({ id: z.string().uuid('Must be a ride id.') }).strict();
const Empty = z.object({}).strict();
const CounterBody = z.object({ amountKobo: z.number().int().positive().max(100_000_000) }).strict();
const StartBody = z.object({ pin: z.string().regex(/^[0-9]{4}$/, 'Enter the 4 digit PIN the rider gives you.') }).strict();
const CancelBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();
const ConfirmBody = z.object({ method: z.enum(['transfer', 'cash']).optional() }).strict();
const RateBody = z.object({ stars: z.number().int().min(1).max(5) }).strict();
const PayoutBody = z.object({ bankName: z.string().trim().min(2).max(60), accountNumber: z.string().regex(/^[0-9]{10}$/, 'Enter the 10 digit account number.'), accountName: z.string().trim().min(2).max(80), bankCode: z.string().regex(/^[0-9A-Za-z]{2,10}$/).optional() }).strict();
const List = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }).strict();

const NOT_APPROVED = () => new AppError(403, 'DRIVER_NOT_APPROVED', 'Your registration must be approved before you can drive.');
const NO_ACCESS = () => new AppError(403, 'NO_ACTIVE_ACCESS', 'Buy a driver pass to go online.');

/**
 * Rides for drivers (D-100): go online, send position, see requests, accept or counter, run the trip,
 * confirm payment, rate the rider. Only an approved driver can go online or take a ride.
 */
@Controller('drivers/me')
export class DriverRidesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** GET /v1/drivers/me/presence */
  @Get('presence')
  async presence(@CurrentPrincipal() p: Principal) {
    this.driver(p);
    return this.presenceView(this.db, p.userId);
  }

  /**
   * PUT /v1/drivers/me/presence: go online or offline. A PUT that overwrites one row: sending it twice
   * gives the same result, so it takes no Idempotency-Key (D-100).
   */
  @Put('presence')
  async setPresence(@Body(validate(PresenceBody)) body: z.infer<typeof PresenceBody>, @CurrentPrincipal() p: Principal) {
    this.driver(p);
    const now = this.now();
    return this.db.tx(async (tx) => {
      if (body.online) {
        if (p.user?.driverVerification !== 'approved') throw NOT_APPROVED();
        if (this.config.DRIVER_PASS_REQUIRED && !(await hasDriverAccess(tx, p.userId, now))) throw NO_ACCESS();
        const v = (await tx.query<{ category: string }>(`select category from app.vehicles where driver_id = $1 and status = 'active'`, [p.userId])).rows[0];
        if (!v) throw Errors.conflict('Your vehicle isn’t set up yet. Contact support.');
        if (!body.location) throw Errors.validation({ location: 'Turn on location to go online.' });
        await tx.query(
          `insert into app.driver_presence (driver_id, online, category, lat, lng, heading, accuracy_m, located_at, online_since, updated_at)
           values ($1, true, $2, $3, $4, $5, $6, $7, $7, $7)
           on conflict (driver_id) do update set online = true, category = excluded.category, lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
             accuracy_m = excluded.accuracy_m, located_at = excluded.located_at, online_since = case when app.driver_presence.online then app.driver_presence.online_since else excluded.online_since end, updated_at = excluded.updated_at`,
          [p.userId, v.category, body.location.latitude.toFixed(6), body.location.longitude.toFixed(6), heading(body.location.heading), accuracy(body.location.accuracyMeters), at(now)],
        );
      } else {
        const busy = (await tx.query(`select 1 from app.rides where driver_id = $1 and status = any($2)`, [p.userId, [...WITH_DRIVER]])).rows[0];
        if (busy) throw Errors.conflict('Finish your current trip before going offline.');
        await tx.query(`insert into app.driver_presence (driver_id, online, updated_at) values ($1, false, $2) on conflict (driver_id) do update set online = false, online_since = null, updated_at = excluded.updated_at`, [p.userId, at(now)]);
        await tx.query(`update app.ride_offers set status = 'expired' where driver_id = $1 and status in ('open', 'responded')`, [p.userId]);
      }
      return this.presenceView(tx, p.userId);
    });
  }

  /** PUT /v1/drivers/me/location: the newest position (overwrites; no history is kept). */
  @Put('location')
  @HttpCode(204)
  async location(@Body(validate(Fix)) body: z.infer<typeof Fix>, @CurrentPrincipal() p: Principal) {
    this.driver(p);
    const r = await this.db.query(`update app.driver_presence set lat = $2, lng = $3, heading = $4, accuracy_m = $5, located_at = $6, updated_at = $6 where driver_id = $1 and (online or exists (select 1 from app.rides a where a.driver_id = $1 and a.status = any($7)))`, [
      p.userId, body.latitude.toFixed(6), body.longitude.toFixed(6), heading(body.heading), accuracy(body.accuracyMeters), at(this.now()), [...WITH_DRIVER],
    ]);
    if (!r.rowCount) throw Errors.conflict('Go online first.');
  }

  /** GET /v1/drivers/me/requests: rides offered to this driver that are still open. */
  @Get('requests')
  async requests(@CurrentPrincipal() p: Principal) {
    this.driver(p);
    const now = this.now();
    const rows = await this.db.query<RideRow & { offer_row_id: string; offer_status: string; o_distance_m: number; o_eta: number; o_kind: string | null; o_amount: string | null; o_for: string | null; o_expires: Date | null; rider_name: string; rider_rating: string | null }>(
      `select r.*, o.id as offer_row_id, o.status as offer_status, o.distance_m as o_distance_m, o.eta_seconds as o_eta, o.response_kind as o_kind, o.amount_kobo as o_amount,
              o.for_offer_id as o_for, o.response_expires_at as o_expires, u.full_name as rider_name, rd.rating as rider_rating
         from app.ride_offers o join app.rides r on r.id = o.ride_id join app.users u on u.id = r.rider_id join app.riders rd on rd.user_id = r.rider_id
        where o.driver_id = $1 and o.status in ('open', 'responded') and r.status in ('searching', 'negotiating') and r.search_expires_at > $2
        order by o.created_at desc limit 20`,
      [p.userId, at(now)],
    );
    return {
      requests: rows.rows.map((r) => {
        const mine = r.offer_status === 'responded' && r.o_for === r.offer_id && r.o_expires && r.o_expires.getTime() > now;
        return {
          rideId: r.id,
          mode: r.mode,
          category: r.category,
          pickup: { latitude: Number(r.pickup_lat), longitude: Number(r.pickup_lng), label: r.pickup_label },
          destination: { latitude: Number(r.destination_lat), longitude: Number(r.destination_lng), label: r.destination_label },
          route: { distanceMeters: r.route_distance_m, durationSeconds: r.route_duration_s, estimated: r.route_estimated },
          toPickup: { distanceMeters: r.o_distance_m, etaSeconds: r.o_eta },
          fareKobo: r.status === 'negotiating' ? Number(r.offer_kobo) : Number(r.agreed_fare_kobo),
          fixedFare: r.status !== 'negotiating',
          quotedFareKobo: Number(r.quoted_fare_kobo),
          offer: r.status === 'negotiating' ? { id: r.offer_id, amountKobo: Number(r.offer_kobo), round: r.offer_round, maxCounterKobo: Number(r.max_offer_kobo) } : null,
          myResponse: mine ? { kind: r.o_kind, amountKobo: Number(r.o_amount), expiresAt: r.o_expires!.toISOString() } : null,
          expiresAt: r.search_expires_at!.toISOString(),
          rider: { firstName: r.rider_name.trim().split(/\s+/)[0] ?? 'Rider', rating: r.rider_rating ? Number(r.rider_rating) : null },
        };
      }),
    };
  }

  /**
   * POST /v1/drivers/me/requests/{rideId}/accept. Quick Match: the first driver to accept gets the ride.
   * Negotiate: tells the rider "I'll take your price"; the rider then chooses among the answers.
   */
  @Post('requests/:rideId/accept')
  @HttpCode(200)
  async accept(@Param(validate(RideId)) params: z.infer<typeof RideId>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.canDrive(p);
    return this.write<object>(p, key, 'POST', `/v1/drivers/me/requests/${params.rideId}/accept`, body, reply, async (tx) => {
      const now = this.now();
      const { ride, offerRow } = await this.offered(tx, p, params.rideId, now);
      if (ride.status === 'negotiating') return { status: 200, body: await this.respond(tx, ride, offerRow, 'accept', Number(ride.offer_kobo), p, now) };
      const next = await assign(tx, ride, p.userId, Number(ride.agreed_fare_kobo), now);
      await rideEvent(tx, ride.id, 'ride.matched', 'driver', p.userId, { driverId: p.userId, agreedFareKobo: Number(ride.agreed_fare_kobo), via: 'quick_match' });
      await notifyRide(tx, next, 'matched');
      await audit(tx, { actorKind: 'driver', actorId: p.userId, actorName: 'Driver', action: 'ride.accepted', rideId: ride.id, summary: 'Driver accepted the ride', data: { agreedFareKobo: Number(ride.agreed_fare_kobo) }, requestId: req.id });
      return { status: 200, body: { matched: true, ride: await driverView(tx, next) } };
    });
  }

  /** POST /v1/drivers/me/requests/{rideId}/counter: ask for more than the rider offered (Negotiate). */
  @Post('requests/:rideId/counter')
  @HttpCode(200)
  async counter(@Param(validate(RideId)) params: z.infer<typeof RideId>, @Body(validate(CounterBody)) body: z.infer<typeof CounterBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.canDrive(p);
    return this.write(p, key, 'POST', `/v1/drivers/me/requests/${params.rideId}/counter`, body, reply, async (tx) => {
      const now = this.now();
      const { ride, offerRow } = await this.offered(tx, p, params.rideId, now);
      if (ride.status !== 'negotiating') throw Errors.conflict('This ride has a fixed fare. Accept or decline it.');
      if (body.amountKobo % MOCK_PRICING_CONFIG.negotiation.stepKobo !== 0) throw Errors.validation({ amountKobo: 'Use steps of ₦50.' });
      return { status: 200, body: await this.respond(tx, ride, offerRow, 'counter', body.amountKobo, p, now) };
    });
  }

  /** POST /v1/drivers/me/requests/{rideId}/decline */
  @Post('requests/:rideId/decline')
  @HttpCode(200)
  async decline(@Param(validate(RideId)) params: z.infer<typeof RideId>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.write(p, key, 'POST', `/v1/drivers/me/requests/${params.rideId}/decline`, body, reply, async (tx) => {
      await tx.query(`update app.ride_offers set status = 'declined', response_kind = null, amount_kobo = null, for_offer_id = null, response_expires_at = null where ride_id = $1 and driver_id = $2 and status in ('open', 'responded')`, [params.rideId, p.userId]);
      return { status: 200, body: { declined: true } };
    });
  }

  /** GET /v1/drivers/me/rides/current */
  @Get('rides/current')
  async current(@CurrentPrincipal() p: Principal) {
    this.driver(p);
    const r = (await this.db.query<RideRow>(`select * from app.rides where driver_id = $1 and (status = any($2) or (status = 'payment_pending' and paid_at is null)) order by matched_at desc limit 1`, [p.userId, [...WITH_DRIVER]])).rows[0];
    return { ride: r ? await driverView(this.db, r) : null };
  }

  /** GET /v1/drivers/me/rides: past trips, newest first. */
  @Get('rides')
  async list(@Query(validate(List)) q: z.infer<typeof List>, @CurrentPrincipal() p: Principal) {
    this.driver(p);
    const rows = await this.db.query<RideRow>(`select * from app.rides where driver_id = $1 and created_at < $2 order by created_at desc limit $3`, [p.userId, q.before ? new Date(q.before) : new Date(this.now() + 60_000), q.limit + 1]);
    const page = rows.rows.slice(0, q.limit);
    const rides = [];
    for (const r of page) rides.push(await driverView(this.db, r));
    return { rides, nextBefore: rows.rows.length > q.limit ? page[page.length - 1]!.created_at.toISOString() : null };
  }

  /** GET /v1/drivers/me/rides/{id} */
  @Get('rides/:id')
  async get(@Param(validate(Id)) params: z.infer<typeof Id>, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    const r = await loadRide(this.db, params.id);
    if (!r || r.driver_id !== p.userId) throw notYours();
    reply.header('etag', `"${r.version}"`);
    return driverView(this.db, r);
  }

  /** POST …/rides/{id}/arrived: at the pickup point (must be near it). */
  @Post('rides/:id/arrived')
  @HttpCode(200)
  async arrived(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.step(p, key, params.id, 'arrived', body, reply, async (tx, r, now) => {
      if (r.status === 'driver_arrived') return r;
      if (!['matched', 'driver_en_route'].includes(r.status)) throw Errors.conflict('This ride isn’t waiting for pickup.');
      const pos = (await tx.query<{ lat: string | null; lng: string | null }>(`select lat, lng from app.driver_presence where driver_id = $1`, [p.userId])).rows[0];
      if (pos?.lat && pos.lng && metersBetween({ latitude: Number(pos.lat), longitude: Number(pos.lng) }, { latitude: Number(r.pickup_lat), longitude: Number(r.pickup_lng) }) > 500) {
        throw new AppError(409, 'TOO_FAR', 'You’re not at the pickup point yet.');
      }
      const next = await updateRide(tx, r.id, `status = 'driver_arrived', arrived_at = $2`, [at(now)]);
      await rideEvent(tx, r.id, 'ride.driver_arrived', 'driver', p.userId, {});
      await notifyRide(tx, next, 'driver_arrived');
      return next;
    });
  }

  /** POST …/rides/{id}/start: needs the rider's PIN, so the right person is in the right car. */
  @Post('rides/:id/start')
  @HttpCode(200)
  async start(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(StartBody)) body: z.infer<typeof StartBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    // The wrong-PIN count must survive the error, so it is recorded outside the idempotent transaction.
    const peek = await loadRide(this.db, params.id);
    if (!peek || peek.driver_id !== p.userId) throw notYours();
    if (peek.status === 'driver_arrived' && peek.pickup_pin !== body.pin) {
      const left = await this.db.tx(async (tx) => {
        const r = (await loadRide(tx, params.id, true))!;
        if (r.status !== 'driver_arrived' || r.pickup_pin === body.pin) return null;
        const attempts = r.pin_attempts + 1;
        // Too many wrong tries: a new PIN, so guessing all 10,000 is never possible.
        if (attempts >= DISPATCH.pinAttempts) await tx.query(`update app.rides set pickup_pin = $2, pin_attempts = 0, version = version + 1 where id = $1`, [r.id, newPin()]);
        else await tx.query(`update app.rides set pin_attempts = $2 where id = $1`, [r.id, attempts]);
        await rideEvent(tx, r.id, 'ride.pin_wrong', 'driver', p.userId, { attempts });
        return DISPATCH.pinAttempts - attempts;
      });
      if (left !== null) throw new AppError(422, 'WRONG_PIN', left > 0 ? 'That PIN doesn’t match. Ask the rider to read it again.' : 'Too many wrong tries. The rider now has a new PIN.');
    }
    return this.step(p, key, params.id, 'start', {}, reply, async (tx, r, now) => {
      if (r.status === 'in_progress') return r;
      if (r.status !== 'driver_arrived') throw Errors.conflict('Mark that you have arrived first.');
      if (r.pickup_pin !== body.pin) throw new AppError(422, 'WRONG_PIN', 'That PIN doesn’t match. Ask the rider to read it again.');
      const next = await updateRide(tx, r.id, `status = 'in_progress', started_at = $2`, [at(now)]);
      await rideEvent(tx, r.id, 'ride.started', 'driver', p.userId, {});
      return next;
    });
  }

  /** POST …/rides/{id}/complete: the trip is over; payment is the next, separate step (D-030). */
  @Post('rides/:id/complete')
  @HttpCode(200)
  async complete(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.step(p, key, params.id, 'complete', body, reply, async (tx, r, now) => {
      if (r.status === 'payment_pending' || r.status === 'completed') return r;
      if (r.status !== 'in_progress') throw Errors.conflict('This trip hasn’t started.');
      const next = await updateRide(tx, r.id, `status = 'payment_pending', completed_at = $2`, [at(now)]);
      await tx.query(`update app.drivers set completed_trips = completed_trips + 1 where user_id = $1`, [p.userId]);
      await rideEvent(tx, r.id, 'ride.trip_ended', 'driver', p.userId, { fareKobo: Number(r.agreed_fare_kobo) });
      await notifyRide(tx, next, 'trip_ended');
      await audit(tx, { actorKind: 'driver', actorId: p.userId, actorName: 'Driver', action: 'ride.trip_ended', rideId: r.id, summary: 'Driver ended the trip', data: { fareKobo: Number(r.agreed_fare_kobo) }, requestId: req.id });
      return next;
    });
  }

  /**
   * POST …/rides/{id}/cancel: before the trip starts. The ride goes back to searching for another
   * driver at the same fare; this driver doesn't get it again.
   */
  @Post('rides/:id/cancel')
  @HttpCode(200)
  async cancel(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(CancelBody)) body: z.infer<typeof CancelBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    const idem = parseIdempotencyKey(key);
    const path = `/v1/drivers/me/rides/${params.id}/cancel`;
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method: 'POST', path, hash: requestHash('POST', path, body) }, async (tx) => {
      const now = this.now();
      const r = await loadRide(tx, params.id, true);
      if (!r || r.driver_id !== p.userId) throw notYours();
      if (!['matched', 'driver_en_route', 'driver_arrived'].includes(r.status)) throw Errors.conflict('This ride can’t be cancelled now.');
      const next = await updateRide(tx, r.id, `driver_id = null, status = 'searching', matched_at = null, arrived_at = null, pickup_pin = null, pin_attempts = 0, search_expires_at = $2`, [at(now + DISPATCH.searchSeconds * 1000)]);
      await tx.query(`update app.ride_offers set status = case when driver_id = $2 then 'declined' else 'open' end, response_kind = null, amount_kobo = null, for_offer_id = null, response_expires_at = null where ride_id = $1`, [r.id, p.userId]);
      await dispatch(tx, next, now);
      await rideEvent(tx, r.id, 'ride.driver_cancelled', 'driver', p.userId, { reason: body.reason ?? null });
      await notifyRide(tx, next, 'driver_cancelled');
      await audit(tx, { actorKind: 'driver', actorId: p.userId, actorName: 'Driver', action: 'ride.driver_cancelled', rideId: r.id, summary: 'Driver cancelled; searching for another driver', data: { reason: body.reason ?? null }, requestId: req.id });
      return { status: 200, body: { cancelled: true } };
    });
    reply.status(out.status);
    return out.body;
  }

  /** POST …/rides/{id}/payment/confirm: "I have received the money" (transfer or cash). Completes the ride. */
  @Post('rides/:id/payment/confirm')
  @HttpCode(200)
  async confirm(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(ConfirmBody)) body: z.infer<typeof ConfirmBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.step(p, key, params.id, 'payment/confirm', body, reply, async (tx, r, now) => {
      if (r.status === 'completed') return r;
      if (r.status !== 'payment_pending') throw Errors.conflict('This ride isn’t waiting for payment.');
      const method = r.payment_method ?? body.method;
      if (!method) throw Errors.validation({ method: 'Say how you were paid: transfer or cash.' });
      if (method === 'wallet') throw Errors.conflict('Wallet payments confirm by themselves.');
      if (method === 'cash' && !this.config.RIDE_CASH_ENABLED) throw Errors.conflict('Cash isn’t available. Ask the rider to pay by bank transfer.');
      const next = await updateRide(tx, r.id, `status = 'completed', payment_method = $2, paid_at = $3`, [method, at(now)]);
      await rideEvent(tx, r.id, 'ride.paid', 'driver', p.userId, { method, confirmedBy: 'driver' });
      await notifyRide(tx, next, 'paid');
      await audit(tx, { actorKind: 'driver', actorId: p.userId, actorName: 'Driver', action: 'ride.payment_confirmed', rideId: r.id, summary: `Driver confirmed receiving payment by ${method}`, data: { method, amountKobo: Number(r.agreed_fare_kobo) }, requestId: req.id });
      return next;
    });
  }

  /** POST …/rides/{id}/rating: stars for the rider, once, after the trip. */
  @Post('rides/:id/rating')
  @HttpCode(200)
  async rate(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(RateBody)) body: z.infer<typeof RateBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.step(p, key, params.id, 'rating', body, reply, async (tx, r) => {
      if (!['payment_pending', 'completed'].includes(r.status)) throw Errors.conflict('You can rate a trip once it has ended.');
      if (r.rider_stars !== null) throw Errors.conflict('You have already rated this trip.');
      const next = await updateRide(tx, r.id, `rider_stars = $2`, [body.stars]);
      await addRating(tx, 'riders', r.rider_id, body.stars);
      await rideEvent(tx, r.id, 'ride.rider_rated', 'driver', p.userId, { stars: body.stars });
      return next;
    });
  }

  /** GET /v1/drivers/me/payout-account: where riders send bank transfers. */
  @Get('payout-account')
  async payout(@CurrentPrincipal() p: Principal) {
    this.driver(p);
    const a = (await this.db.query<{ bank_name: string; account_number: string; account_name: string }>(`select bank_name, account_number, account_name from app.driver_payout_accounts where driver_id = $1`, [p.userId])).rows[0];
    return { account: a ? { bankName: a.bank_name, accountNumber: a.account_number, accountName: a.account_name } : null };
  }

  /** PUT /v1/drivers/me/payout-account. Changing where money goes is always audited. */
  @Put('payout-account')
  async setPayout(@Body(validate(PayoutBody)) body: z.infer<typeof PayoutBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.driver(p);
    return this.write(p, key, 'PUT', '/v1/drivers/me/payout-account', body, reply, async (tx) => {
      await tx.query(
        `insert into app.driver_payout_accounts (driver_id, bank_name, account_number, account_name, updated_at, bank_code) values ($1, $2, $3, $4, $5, $6)
         on conflict (driver_id) do update set bank_name = excluded.bank_name, account_number = excluded.account_number, account_name = excluded.account_name, updated_at = excluded.updated_at, bank_code = excluded.bank_code`,
        [p.userId, body.bankName, body.accountNumber, body.accountName, at(this.now()), body.bankCode ?? null],
      );
      // The audit keeps the last four digits only.
      await tx.query(
        `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data, request_id)
         values ('driver', $1, 'Driver', 'driver.payout_account_changed', 'driver', $1, 'Driver changed the account riders pay into', $2::jsonb, $3)`,
        [p.userId, JSON.stringify({ bankName: body.bankName, accountEnding: body.accountNumber.slice(-4) }), req.id],
      );
      return { status: 200, body: { account: body } };
    });
  }

  /* ---------- helpers ---------- */

  private driver(p: Principal) {
    if (!p.user?.isDriver) throw Errors.forbidden('Create a driver account first.');
  }

  private async canDrive(p: Principal) {
    this.driver(p);
    if (p.user?.driverVerification !== 'approved') throw NOT_APPROVED();
    if (this.config.DRIVER_PASS_REQUIRED && !(await hasDriverAccess(this.db, p.userId, this.now()))) throw NO_ACCESS();
  }

  private async presenceView(q: Querier, driverId: string) {
    const r = (await q.query<{ online: boolean; category: string | null; lat: string | null; lng: string | null; located_at: Date | null; online_since: Date | null }>(`select online, category, lat, lng, located_at, online_since from app.driver_presence where driver_id = $1`, [driverId])).rows[0];
    return { online: r?.online ?? false, category: r?.category ?? null, location: r?.lat && r.lng ? { latitude: Number(r.lat), longitude: Number(r.lng), at: r.located_at?.toISOString() ?? null } : null, onlineSince: r?.online_since?.toISOString() ?? null };
  }

  /** The ride and this driver's request for it, both locked; refuses when either is no longer open. */
  private async offered(tx: Querier, p: Principal, rideId: string, now: number) {
    const found = await loadRide(tx, rideId, true);
    const offerRow = found ? (await tx.query<{ id: string; status: string }>(`select id, status from app.ride_offers where ride_id = $1 and driver_id = $2 for update`, [rideId, p.userId])).rows[0] : undefined;
    // A ride this driver was never offered reads as "not found": ride ids can't be probed.
    if (!found || !offerRow) throw notYours();
    const ride = await expireIfDue(tx, found, now);
    if (!['searching', 'negotiating'].includes(ride.status) || !['open', 'responded'].includes(offerRow.status)) throw new AppError(409, 'REQUEST_GONE', 'This request is no longer available.');
    const online = (await tx.query<{ online: boolean }>(`select online from app.driver_presence where driver_id = $1`, [p.userId])).rows[0];
    if (!online?.online) throw Errors.conflict('Go online to take requests.');
    return { ride, offerRow };
  }

  private async respond(tx: Querier, ride: RideRow, offerRow: { id: string }, kind: 'accept' | 'counter', amount: number, p: Principal, now: number) {
    const offer: PassengerOffer = { id: ride.offer_id!, amount: Number(ride.offer_kobo) as Kobo, round: ride.offer_round, createdAt: 0, expiresAt: ride.offer_expires_at!.getTime() };
    const quote = { negotiationRange: { min: Number(ride.min_offer_kobo) as Kobo, max: Number(ride.max_offer_kobo) as Kobo } } as FareQuote;
    const ok = validateDriverResponse({ kind, amount: amount as Kobo, offerId: offer.id }, offer, quote);
    if (!ok.ok) throw Errors.validation({ amountKobo: kind === 'counter' ? 'Ask for at least the rider’s offer, and no more than the top of the range.' : ok.error });
    const expires = Math.min(now + MOCK_PRICING_CONFIG.negotiation.responseTtlSeconds * 1000, ride.search_expires_at!.getTime());
    await tx.query(`update app.ride_offers set status = 'responded', response_kind = $2, amount_kobo = $3, for_offer_id = $4, response_expires_at = $5 where id = $1`, [offerRow.id, kind, amount, offer.id, at(expires)]);
    // The rider needs time to see and choose it.
    if (ride.search_expires_at!.getTime() < expires + 5000) await tx.query(`update app.rides set search_expires_at = $2 where id = $1`, [ride.id, at(expires + 5000)]);
    await tx.query(`update app.rides set version = version + 1 where id = $1`, [ride.id]);
    await rideEvent(tx, ride.id, kind === 'accept' ? 'ride.driver_accepted_offer' : 'ride.driver_countered', 'driver', p.userId, { amountKobo: amount });
    return { matched: false, response: { kind, amountKobo: amount, expiresAt: new Date(expires).toISOString() } };
  }

  /** One trip step by the assigned driver: lock, check it is theirs, change, return the driver's view. */
  private async step(p: Principal, key: string | undefined, id: string, name: string, hashed: unknown, reply: FastifyReply, fn: (tx: Querier, r: RideRow, now: number) => Promise<RideRow>) {
    return this.write(p, key, 'POST', `/v1/drivers/me/rides/${id}/${name}`, hashed, reply, async (tx) => {
      const r = await loadRide(tx, id, true);
      if (!r || r.driver_id !== p.userId) throw notYours();
      return { status: 200, body: await driverView(tx, await fn(tx, r, this.now())) };
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

const heading = (h: number | undefined) => (h === undefined ? null : Math.round(h) % 360);
const accuracy = (a: number | undefined) => (a === undefined ? null : Math.round(a));
