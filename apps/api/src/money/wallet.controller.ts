import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOCK, CONFIG, DATABASE, PROVIDERS } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal, Public } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import type { Providers } from '../providers/ports';
import { AppError, Errors } from '../common/errors';
import { validate } from '../common/validation';
import { balance, postJournal } from './ledger';
import { LIMITS, NO_PROVIDER, collectionView, createCollection, initCollection, passPrice, queuePayout, queueVerify, settleCollection, withdrawalView, type CollectionRow, type WithdrawalRow } from './money.service';

const DepositBody = z.object({ amountKobo: z.number().int().min(LIMITS.depositMinKobo, 'Add at least ₦100.').max(LIMITS.depositMaxKobo, 'Add ₦500,000 or less at a time.').refine((n) => n % 100 === 0, 'Use whole naira.'), method: z.enum(['transfer', 'card']) }).strict();
const PassBody = z.object({ plan: z.enum(['daily', 'monthly']), method: z.enum(['transfer', 'card']) }).strict();
const WithdrawBody = z.object({ amountKobo: z.number().int().min(LIMITS.withdrawalMinKobo, 'Withdraw at least ₦1,000.').max(1_000_000_000).refine((n) => n % 100 === 0, 'Use whole naira.') }).strict();
const Ref = z.object({ reference: z.string().regex(/^[a-z0-9_-]{16,50}$/, 'Not a payment reference.') }).strict();
const Provider = z.object({ provider: z.string().regex(/^[a-z_]{3,20}$/) }).strict();

interface EntryRow {
  id: string;
  amount_kobo: string;
  kind: string;
  description: string;
  reference: string;
  created_at: Date;
}
const entryView = (e: EntryRow) => ({ id: e.id, amountKobo: Number(e.amount_kobo), kind: e.kind, description: e.description, reference: e.reference, at: e.created_at.toISOString() });
const entries = (q: Querier, account: string, ownerId: string) =>
  q.query<EntryRow>(
    `select e.id::text, e.amount_kobo, j.kind, j.description, j.reference, e.created_at from app.ledger_entries e join app.ledger_journals j on j.id = e.journal_id
      where e.owner_id = $1 and e.account_kind = $2 order by e.id desc limit 50`,
    [ownerId, account],
  );

/**
 * Wallet and payments (D-101). Every route here answers NOT_CONFIGURED until WALLET_ENABLED=true and a
 * payment provider is set, so nothing can move money by accident. Card details never reach GoBye: the
 * customer types them on the provider's own page (D-093).
 */
@Controller()
export class WalletController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private gateway() {
    if (!this.config.WALLET_ENABLED || !this.providers.payments) throw NO_PROVIDER();
    return this.providers.payments;
  }

  /** GET /v1/wallet: balance, recent movements and payments still waiting. Reads work while money is off. */
  @Get('wallet')
  async wallet(@CurrentPrincipal() p: Principal) {
    if (!p.user?.isRider) throw Errors.forbidden('Create a rider account first.');
    const pending = await this.db.query<CollectionRow>(`select * from app.collections where user_id = $1 and purpose = 'wallet_funding' and status = 'pending' and expires_at > $2 order by created_at desc limit 5`, [p.userId, new Date(this.now())]);
    return {
      enabled: this.config.WALLET_ENABLED && !!this.providers.payments,
      simulated: this.providers.payments?.simulated ?? false,
      balanceKobo: await balance(this.db, 'passenger_wallet', p.userId),
      transactions: (await entries(this.db, 'passenger_wallet', p.userId)).rows.map(entryView),
      pending: pending.rows.map((c) => collectionView(c, this.providers.payments?.simulated ?? false)),
      limits: { minKobo: LIMITS.depositMinKobo, maxKobo: LIMITS.depositMaxKobo },
    };
  }

  /** POST /v1/wallet/deposits: start a top-up. Returns the provider's payment page or an account to pay into. */
  @Post('wallet/deposits')
  async deposit(@Body(validate(DepositBody)) body: z.infer<typeof DepositBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!p.user?.isRider) throw Errors.forbidden('Create a rider account first.');
    return this.collect(p, key, '/v1/wallet/deposits', body, reply, { purpose: 'wallet_funding', method: body.method, amountKobo: body.amountKobo });
  }

  /** GET /v1/payments/{reference}: where a payment stands. Asks the provider when it is still waiting. */
  @Get('payments/:reference')
  async payment(@Param(validate(Ref)) params: z.infer<typeof Ref>, @CurrentPrincipal() p: Principal) {
    const c = (await this.db.query<CollectionRow>(`select * from app.collections where reference = $1 and user_id = $2`, [params.reference, p.userId])).rows[0];
    if (!c) throw Errors.notFound('Payment not found.');
    const now = this.now();
    if (c.status === 'pending' && this.config.WALLET_ENABLED && (!c.last_checked_at || now - c.last_checked_at.getTime() >= LIMITS.recheckMs)) {
      await settleCollection(this.db, this.providers.payments, c.reference, now).catch(() => undefined);
    }
    const fresh = (await this.db.query<CollectionRow>(`select * from app.collections where reference = $1`, [c.reference])).rows[0]!;
    return collectionView(fresh, this.providers.payments?.simulated ?? false);
  }

  /** GET /v1/drivers/me/earnings: what the driver holds, what is set aside for a withdrawal, and the history. */
  @Get('drivers/me/earnings')
  async earnings(@CurrentPrincipal() p: Principal) {
    if (!p.user?.isDriver) throw Errors.forbidden('Create a driver account first.');
    const w = await this.db.query<WithdrawalRow>(`select * from app.withdrawals where driver_id = $1 order by created_at desc limit 20`, [p.userId]);
    return {
      enabled: this.config.WALLET_ENABLED && !!this.providers.payments,
      balanceKobo: await balance(this.db, 'driver_earnings', p.userId),
      setAsideKobo: await balance(this.db, 'driver_withdrawal_reserve', p.userId),
      transactions: (await entries(this.db, 'driver_earnings', p.userId)).rows.map(entryView),
      withdrawals: w.rows.map((x) => withdrawalView(x)),
      limits: { minKobo: LIMITS.withdrawalMinKobo },
    };
  }

  /** POST /v1/drivers/me/pass: pay for a driver pass (D-024). The pass starts only after the provider confirms. */
  @Post('drivers/me/pass')
  async pass(@Body(validate(PassBody)) body: z.infer<typeof PassBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!p.user?.isDriver) throw Errors.forbidden('Create a driver account first.');
    if (p.user.driverVerification !== 'approved') throw new AppError(403, 'DRIVER_NOT_APPROVED', 'Your registration must be approved first.');
    return this.collect(p, key, '/v1/drivers/me/pass', body, reply, { purpose: 'package_purchase', method: body.method, amountKobo: passPrice(body.plan), plan: body.plan });
  }

  /**
   * POST /v1/drivers/me/withdrawals: ask to take earnings out. The money is set aside at once (so it
   * can't be spent twice), a member of staff approves, then it is sent to the driver's saved account.
   */
  @Post('drivers/me/withdrawals')
  async withdraw(@Body(validate(WithdrawBody)) body: z.infer<typeof WithdrawBody>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!p.user?.isDriver) throw Errors.forbidden('Create a driver account first.');
    this.gateway();
    const idem = parseIdempotencyKey(key);
    const path = '/v1/drivers/me/withdrawals';
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method: 'POST', path, hash: requestHash('POST', path, body) }, async (tx) => {
      const acct = (await tx.query<{ bank_code: string | null; bank_name: string; account_number: string; account_name: string }>(`select bank_code, bank_name, account_number, account_name from app.driver_payout_accounts where driver_id = $1`, [p.userId])).rows[0];
      if (!acct?.bank_code) throw Errors.conflict('Add your bank account (with the bank chosen from the list) before withdrawing.');
      await tx.query('savepoint wd');
      let w: WithdrawalRow;
      try {
        w = (await tx.query<WithdrawalRow>(`insert into app.withdrawals (reference, driver_id, amount_kobo, bank_code, bank_name, account_number, account_name) values ('gbx-' || gen_random_uuid()::text, $1, $2, $3, $4, $5, $6) returning *`, [p.userId, body.amountKobo, acct.bank_code, acct.bank_name, acct.account_number, acct.account_name])).rows[0]!;
      } catch (e) {
        await tx.query('rollback to savepoint wd');
        if ((e as { code?: string }).code === '23505') throw Errors.conflict('You already have a withdrawal in progress.');
        throw e;
      }
      await postJournal(tx, {
        kind: 'withdrawal_reserve',
        reference: `wd:${w.id}`,
        description: 'Withdrawal requested: money set aside',
        actor: { kind: 'driver', id: p.userId },
        links: { withdrawalId: w.id },
        lines: [
          { account: 'driver_earnings', ownerId: p.userId, amount: -body.amountKobo },
          { account: 'driver_withdrawal_reserve', ownerId: p.userId, amount: body.amountKobo },
        ],
      });
      await tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data, request_id) values ('driver', $1, 'Driver', 'withdrawal.requested', 'withdrawal', $2, 'Driver asked to withdraw earnings', $3::jsonb, $4)`, [p.userId, w.id, JSON.stringify({ amountKobo: body.amountKobo, accountEnding: acct.account_number.slice(-4) }), req.id]);
      return { status: 201, body: withdrawalView(w) };
    });
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return out.body;
  }

  /**
   * POST /v1/webhooks/payments/{provider}: the provider says something happened. The signature is
   * checked over the exact bytes received; the event is stored once; then WE look the payment up. A
   * webhook never moves money by itself. Answers 404 when that provider isn't the one configured.
   */
  @Post('webhooks/payments/:provider')
  @Public()
  async webhook(@Param(validate(Provider)) params: z.infer<typeof Provider>, @Req() req: RawBodyRequest<FastifyRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    const gateway = this.providers.payments;
    if (!this.config.WALLET_ENABLED || !gateway || gateway.key !== params.provider) throw Errors.notFound();
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    const parsed = req.rawBody ? gateway.parseWebhook({ rawBody: req.rawBody.toString('utf8'), headers }) : null;
    if (!parsed?.ok) throw Errors.unauthenticated('Invalid signature.');
    const e = parsed.value;
    reply.status(200);
    const first = await this.db.query(`insert into ops.payment_webhook_events (provider, event_id, type, reference) values ($1, $2, $3, $4) on conflict do nothing`, [gateway.key, e.eventId.slice(0, 200), e.type, e.reference.slice(0, 120)]);
    if (!first.rowCount) return { received: true, duplicate: true };
    if (e.type.startsWith('collection')) {
      await queueVerify(this.db, e.reference);
      await settleCollection(this.db, gateway, e.reference, this.now()).catch(() => undefined);
    } else if (e.type.startsWith('transfer')) {
      const w = (await this.db.query<{ id: string; status: string }>(`select id, status from app.withdrawals where reference = $1`, [e.reference])).rows[0];
      if (w && e.type === 'transfer.reversed' && w.status === 'paid') {
        await this.db.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ('provider', $1, $1, 'withdrawal.needs_review', 'withdrawal', $2, 'The provider reversed a payout that was already marked paid', '{}'::jsonb)`, [gateway.key, w.id]);
      } else if (w) await queuePayout(this.db, 'payouts.check', w.id);
    }
    return { received: true, duplicate: false };
  }

  private async collect(p: Principal, key: string | undefined, path: string, body: unknown, reply: FastifyReply, c: { purpose: CollectionRow['purpose']; method: CollectionRow['method']; amountKobo: number; plan?: 'daily' | 'monthly' }) {
    const gateway = this.gateway();
    if (c.method === 'card' && !gateway.capabilities.includes('collect_card')) throw Errors.conflict('Card payments aren’t available. Use bank transfer.');
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method: 'POST', path, hash: requestHash('POST', path, body) }, async (tx) => {
      const open = Number((await tx.query<{ c: string }>(`select count(*) as c from app.collections where user_id = $1 and status = 'pending' and expires_at > $2`, [p.userId, new Date(this.now())])).rows[0]!.c);
      if (open >= 5) throw Errors.conflict('You have several payments waiting. Finish or wait for one before starting another.');
      const row = await createCollection(tx, { userId: p.userId, ...c, provider: gateway.key, now: this.now() });
      return { status: 201, body: { reference: row.reference } };
    });
    const row = await initCollection(this.db, gateway, out.body.reference, this.config.PAYMENTS_RETURN_URL);
    await queueVerify(this.db, row.reference, 60).catch(() => undefined);
    reply.status(201);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return collectionView(row, gateway.simulated);
  }
}
