import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DATABASE } from '../tokens';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AppError, Errors } from '../common/errors';
import { validate } from '../common/validation';
import { integrity, postJournal } from './ledger';
import { queuePayout, releaseWithdrawal, withdrawalView, type WithdrawalRow } from './money.service';

const Id = z.object({ id: z.string().uuid() }).strict();
const WList = z.object({ status: z.enum(['requested', 'approved', 'submitted', 'unknown', 'paid', 'failed', 'rejected', 'all']).default('requested') }).strict();
const Reason = z.object({ reason: z.string().trim().min(5, 'Say why, in a few words.').max(200) }).strict();
const Empty = z.object({}).strict();
const RefundBody = z.object({ rideId: z.string().uuid(), amountKobo: z.number().int().positive().max(100_000_000), reason: z.string().trim().min(5, 'Say why, in a few words.').max(200) }).strict();
const Paging = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

/**
 * Money for finance staff (D-101, D-067): totals from the ledger, the integrity checks, withdrawals to
 * approve, payments that need a person, and refunds (asked by one person, approved by another).
 */
@Controller('ops/finance')
export class FinanceController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** GET /v1/ops/finance/summary */
  @Get('summary')
  @RequirePermission('finance.view')
  async summary() {
    const totals = await this.db.query<{ account_kind: string; s: string }>(`select account_kind, sum(amount_kobo) as s from app.ledger_entries group by account_kind`);
    const collections = await this.db.query<{ status: string; c: string; s: string }>(`select status, count(*) as c, coalesce(sum(amount_kobo), 0) as s from app.collections group by status`);
    const withdrawals = await this.db.query<{ status: string; c: string; s: string }>(`select status, count(*) as c, coalesce(sum(amount_kobo), 0) as s from app.withdrawals group by status`);
    const by = (rows: { status: string; c: string; s: string }[]) => Object.fromEntries(rows.map((r) => [r.status, { count: Number(r.c), kobo: Number(r.s) }]));
    return { accounts: Object.fromEntries(totals.rows.map((t) => [t.account_kind, Number(t.s)])), integrity: await integrity(this.db), collections: by(collections.rows), withdrawals: by(withdrawals.rows) };
  }

  /** GET /v1/ops/finance/journals: the newest journals with their entries. */
  @Get('journals')
  @RequirePermission('ledger.view')
  async journals(@Query(validate(Paging)) q: z.infer<typeof Paging>) {
    const r = await this.db.query(
      `select j.id, j.kind, j.reference, j.description, j.provider, j.actor_kind, j.reason, j.created_at,
              (select jsonb_agg(jsonb_build_object('account', e.account_kind, 'ownerId', e.owner_id, 'provider', e.provider, 'amountKobo', e.amount_kobo) order by e.id) from app.ledger_entries e where e.journal_id = j.id) as entries
         from app.ledger_journals j order by j.created_at desc limit $1`,
      [q.limit],
    );
    return { journals: r.rows };
  }

  /** GET /v1/ops/finance/collections/review: payments that did not match and were not credited. */
  @Get('collections/review')
  @RequirePermission('finance.view')
  async review() {
    const r = await this.db.query(`select reference, user_id, purpose, method, provider, amount_kobo, detail, created_at, settled_at from app.collections where status = 'investigate' order by settled_at desc limit 100`);
    return { collections: r.rows };
  }

  /** GET /v1/ops/finance/withdrawals */
  @Get('withdrawals')
  @RequirePermission('withdrawals.view')
  async withdrawals(@Query(validate(WList)) q: z.infer<typeof WList>) {
    const r = await this.db.query<WithdrawalRow>(`select * from app.withdrawals where ($1::text is null or status = $1) order by created_at limit 200`, [q.status === 'all' ? null : q.status]);
    return { withdrawals: r.rows.map((w) => withdrawalView(w, true)) };
  }

  /** POST …/withdrawals/{id}/approve: a person says the payout may be sent. It is then sent once. */
  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  @RequirePermission('withdrawals.review')
  async approve(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.write(p, key, `/v1/ops/finance/withdrawals/${params.id}/approve`, body, reply, async (tx) => {
      const w = (await tx.query<WithdrawalRow>(`select * from app.withdrawals where id = $1 for update`, [params.id])).rows[0];
      if (!w) throw Errors.notFound('Withdrawal not found.');
      if (w.status !== 'requested') throw Errors.conflict('This withdrawal has already been decided.');
      // Staff can't approve money for themselves, even if they also drive.
      if (w.driver_id === p.userId) throw Errors.forbidden('You can’t approve your own withdrawal.');
      await tx.query(`update app.withdrawals set status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1`, [w.id, p.staff!.id]);
      await this.audit(tx, p, 'withdrawal.approved', 'withdrawal', w.id, 'Staff approved a driver withdrawal', { driverId: w.driver_id, amountKobo: Number(w.amount_kobo) }, req.id);
      await queuePayout(tx, 'payouts.submit', w.id);
      return { status: 200, body: withdrawalView({ ...w, status: 'approved' }, true) };
    });
  }

  /** POST …/withdrawals/{id}/reject: the money goes back to the driver's earnings. */
  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  @RequirePermission('withdrawals.review')
  async reject(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(Reason)) body: z.infer<typeof Reason>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.write(p, key, `/v1/ops/finance/withdrawals/${params.id}/reject`, body, reply, async (tx) => {
      const w = (await tx.query<WithdrawalRow>(`select * from app.withdrawals where id = $1 for update`, [params.id])).rows[0];
      if (!w) throw Errors.notFound('Withdrawal not found.');
      if (w.status !== 'requested') throw Errors.conflict('This withdrawal has already been decided.');
      await tx.query(`update app.withdrawals set reviewed_by = $2, reviewed_at = now(), review_reason = $3 where id = $1`, [w.id, p.staff!.id, body.reason]);
      await releaseWithdrawal(tx, w, 'rejected', body.reason, { kind: 'staff', id: p.staff!.id });
      await this.audit(tx, p, 'withdrawal.rejected', 'withdrawal', w.id, 'Staff rejected a driver withdrawal', { driverId: w.driver_id, amountKobo: Number(w.amount_kobo), reason: body.reason }, req.id);
      return { status: 200, body: withdrawalView({ ...w, status: 'rejected', review_reason: body.reason }, true) };
    });
  }

  /** POST /v1/ops/finance/refunds: ask for a refund to a rider's wallet. Someone else must approve it. */
  @Post('refunds')
  @RequirePermission('refunds.request')
  async requestRefund(@Body(validate(RefundBody)) body: z.infer<typeof RefundBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.write(p, key, '/v1/ops/finance/refunds', body, reply, async (tx) => {
      const ride = (await tx.query<{ rider_id: string; agreed_fare_kobo: string | null; status: string }>(`select rider_id, agreed_fare_kobo, status from app.rides where id = $1 for update`, [body.rideId])).rows[0];
      if (!ride) throw Errors.notFound('Ride not found.');
      if (ride.status !== 'completed') throw Errors.conflict('Only a completed, paid ride can be refunded.');
      const already = Number((await tx.query<{ s: string }>(`select coalesce(sum(amount_kobo), 0) as s from app.refunds where ride_id = $1 and status <> 'rejected'`, [body.rideId])).rows[0]!.s);
      if (already + body.amountKobo > Number(ride.agreed_fare_kobo)) throw new AppError(409, 'REFUND_TOO_LARGE', 'Refunds for a ride can’t add up to more than its fare.');
      const r = (await tx.query<{ id: string }>(`insert into app.refunds (ride_id, rider_id, amount_kobo, reason, requested_by) values ($1, $2, $3, $4, $5) returning id`, [body.rideId, ride.rider_id, body.amountKobo, body.reason, p.staff!.id])).rows[0]!;
      await this.audit(tx, p, 'refund.requested', 'refund', r.id, 'Staff asked for a refund', { rideId: body.rideId, amountKobo: body.amountKobo, reason: body.reason }, req.id);
      return { status: 201, body: { id: r.id, status: 'requested', amountKobo: body.amountKobo } };
    });
  }

  /** POST …/refunds/{id}/approve: a second person approves; the rider's wallet is credited (a cost to GoBye). */
  @Post('refunds/:id/approve')
  @HttpCode(200)
  @RequirePermission('refunds.approve')
  async approveRefund(@Param(validate(Id)) params: z.infer<typeof Id>, @Body(validate(Empty)) body: z.infer<typeof Empty>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.write(p, key, `/v1/ops/finance/refunds/${params.id}/approve`, body, reply, async (tx) => {
      const r = (await tx.query<{ id: string; ride_id: string; rider_id: string; amount_kobo: string; reason: string; status: string; requested_by: string }>(`select * from app.refunds where id = $1 for update`, [params.id])).rows[0];
      if (!r) throw Errors.notFound('Refund not found.');
      if (r.status !== 'requested') throw Errors.conflict('This refund has already been decided.');
      if (r.requested_by === p.staff!.id) throw new AppError(403, 'SECOND_PERSON_REQUIRED', 'A different member of staff must approve this refund.');
      const amount = Number(r.amount_kobo);
      await postJournal(tx, {
        kind: 'refund',
        reference: `refund:${r.id}`,
        description: 'Refund to the rider’s wallet',
        actor: { kind: 'staff', id: p.staff!.id },
        reason: r.reason,
        links: { rideId: r.ride_id, refundId: r.id },
        lines: [
          { account: 'passenger_wallet', ownerId: r.rider_id, amount },
          { account: 'promotions_expense', amount: -amount },
        ],
      });
      await tx.query(`update app.refunds set status = 'approved', decided_by = $2, decided_at = now() where id = $1`, [r.id, p.staff!.id]);
      await this.audit(tx, p, 'refund.approved', 'refund', r.id, 'A second member of staff approved a refund', { rideId: r.ride_id, amountKobo: amount }, req.id);
      return { status: 200, body: { id: r.id, status: 'approved', amountKobo: amount } };
    });
  }

  private audit(tx: Querier, p: Principal, action: string, type: string, id: string, summary: string, data: object, requestId: string) {
    return tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data, request_id) values ('staff', $1, 'Staff', $2, $3, $4, $5, $6::jsonb, $7)`, [p.staff!.id, action, type, id, summary, JSON.stringify(data), requestId]);
  }

  private async write<T>(p: Principal, key: string | undefined, path: string, hashed: unknown, reply: FastifyReply, fn: (tx: Querier) => Promise<{ status: number; body: T }>): Promise<T> {
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `staff:${p.staff!.id}`, key: idem, method: 'POST', path, hash: requestHash('POST', path, hashed) }, fn);
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return out.body;
  }
}
