import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOCK, DATABASE } from '../tokens';
import type { Database } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import { assertCityScope } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { OPEN, WITH_DRIVER, at, audit, driverCards, loadRide, notifyRide, rideEvent, riderView, updateRide, type RideRow } from './rides.repository';

const List = z
  .object({
    status: z.enum(['open', 'active', 'payment_pending', 'completed', 'cancelled', 'all']).default('all'),
    city: z.enum(['lagos', 'abuja']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
  })
  .strict();
const Id = z.object({ id: z.string().uuid('Must be a ride id.') }).strict();
const CancelBody = z.object({ reason: z.string().trim().min(5, 'Say why, in a few words.').max(200) }).strict();

const GROUPS: Record<string, string[]> = { open: [...OPEN], active: [...WITH_DRIVER], payment_pending: ['payment_pending'], completed: ['completed'], cancelled: ['cancelled', 'no_drivers', 'failed'] };

/**
 * Rides for staff (D-100, D-067): the live list, one ride with its full history, and stopping a ride.
 * Staff see first names only here; contact details need their own permission on the person's page.
 */
@Controller('admin/rides')
export class StaffRidesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** GET /v1/admin/rides */
  @Get()
  @RequirePermission('trips.view')
  async list(@Query(validate(List)) q: z.infer<typeof List>, @CurrentPrincipal() p: Principal) {
    const cities = p.staff?.cities.length ? p.staff.cities : null;
    if (q.city) assertCityScope(p, q.city);
    const rows = await this.db.query<RideRow & { rider_name: string; driver_name: string | null }>(
      `select r.*, ru.full_name as rider_name, du.full_name as driver_name
         from app.rides r join app.users ru on ru.id = r.rider_id left join app.users du on du.id = r.driver_id
        where ($1::text[] is null or r.status = any($1)) and ($2::text is null or r.city = $2) and ($3::text[] is null or r.city = any($3)) and r.created_at < $4
        order by r.created_at desc limit $5`,
      [q.status === 'all' ? null : GROUPS[q.status], q.city ?? null, cities, q.before ? new Date(q.before) : new Date(this.now() + 60_000), q.limit + 1],
    );
    const page = rows.rows.slice(0, q.limit);
    const counts = await this.db.query<{ status: string; c: string }>(`select status, count(*) as c from app.rides where ($1::text[] is null or city = any($1)) and created_at > now() - interval '24 hours' group by status`, [cities]);
    return {
      rides: page.map((r) => ({
        id: r.id,
        status: r.status,
        mode: r.mode,
        category: r.category,
        city: r.city,
        channel: r.channel,
        pickupLabel: r.pickup_label,
        destinationLabel: r.destination_label,
        fareKobo: r.agreed_fare_kobo ? Number(r.agreed_fare_kobo) : r.quoted_fare_kobo ? Number(r.quoted_fare_kobo) : null,
        riderFirstName: first(r.rider_name),
        driverFirstName: r.driver_name ? first(r.driver_name) : null,
        paymentMethod: r.payment_method,
        createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? null,
      })),
      last24h: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.c)])),
      nextBefore: rows.rows.length > q.limit ? page[page.length - 1]!.created_at.toISOString() : null,
    };
  }

  /** GET /v1/admin/rides/{id}: the ride and everything that happened to it. */
  @Get(':id')
  @RequirePermission('trips.view')
  async get(@Param(validate(Id)) params: z.infer<typeof Id>, @CurrentPrincipal() p: Principal) {
    const r = await loadRide(this.db, params.id);
    if (!r) throw Errors.notFound('Ride not found.');
    assertCityScope(p, r.city);
    const view = await riderView(this.db, null, r, this.now());
    const events = await this.db.query<{ at: Date; type: string; actor_kind: string; data: object }>(`select at, type, actor_kind, data from app.ride_events where ride_id = $1 order by id`, [r.id]);
    const names = await this.db.query<{ id: string; full_name: string }>(`select id, full_name from app.users where id = any($1)`, [[r.rider_id, r.driver_id].filter(Boolean)]);
    const name = (id: string | null) => (id ? first(names.rows.find((n) => n.id === id)?.full_name ?? '') : null);
    const driver = r.driver_id ? ((await driverCards(this.db, null, [r.driver_id])).get(r.driver_id) ?? null) : null;
    // The PIN and the payout account are for the rider only.
    return { ...view, pickupPin: null, payTo: null, riderId: r.rider_id, driverId: r.driver_id, riderFirstName: name(r.rider_id), driver, cancelReason: r.cancel_reason, events: events.rows.map((e) => ({ at: e.at.toISOString(), type: e.type, by: e.actor_kind, data: e.data })) };
  }

  /** POST /v1/admin/rides/{id}/cancel: stop a ride that hasn't finished (a reason is required and audited). */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('trips.intervene')
  async cancel(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(CancelBody)) body: z.infer<typeof CancelBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const idem = parseIdempotencyKey(key);
    const path = `/v1/admin/rides/${params.id}/cancel`;
    const out = await withIdempotency(this.db, { scope: `staff:${p.staff!.id}`, key: idem, method: 'POST', path, hash: requestHash('POST', path, body) }, async (tx) => {
      const r = await loadRide(tx, params.id, true);
      if (!r) throw Errors.notFound('Ride not found.');
      assertCityScope(p, r.city);
      if (![...OPEN, ...WITH_DRIVER].includes(r.status as never)) throw Errors.conflict('This ride has already ended.');
      const now = this.now();
      const next = await updateRide(tx, r.id, `status = 'cancelled', cancelled_at = $2, cancelled_by = 'system', cancel_reason = $3`, [at(now), body.reason]);
      await tx.query(`update app.ride_offers set status = 'expired' where ride_id = $1 and status in ('open', 'responded')`, [r.id]);
      await rideEvent(tx, r.id, 'ride.cancelled_by_staff', 'staff', p.staff!.id, { reason: body.reason, was: r.status });
      await notifyRide(tx, { ...next, driver_id: r.driver_id }, 'cancelled_by_staff');
      await audit(tx, { actorKind: 'staff', actorId: p.staff!.id, actorName: 'Staff', action: 'ride.cancelled_by_staff', rideId: r.id, summary: `Staff cancelled a ride that was ${r.status.replace(/_/g, ' ')}`, data: { reason: body.reason, was: r.status }, requestId: req.id });
      return { status: 200, body: { id: next.id, status: next.status, version: next.version } };
    });
    reply.status(out.status);
    return out.body;
  }
}

const first = (full: string) => full.trim().split(/\s+/)[0] ?? '';
