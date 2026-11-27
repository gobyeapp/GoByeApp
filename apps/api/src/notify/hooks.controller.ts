import { Body, Controller, Get, Headers, HttpCode, Inject, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOCK, CONFIG, DATABASE, PROVIDERS } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal, Public } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import type { Providers } from '../providers/ports';
import { verifyStandardWebhook } from '../providers/notify';
import { AppError, Errors } from '../common/errors';
import { validate } from '../common/validation';

const Search = z.object({ q: z.string().trim().min(2).max(120), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }).strict();
const Reverse = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).strict();
const Prefs = z.object({ emailReceipts: z.boolean() }).strict();
const PushToken = z.object({ installId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), pushToken: z.string().min(10).max(300).nullable() }).strict();

/** Requests per person per minute for the map lookups (each one costs money at the provider). */
const MAP_LIMIT = 40;

/**
 * Small connections to outside services (D-103): place search through OUR server key, notification
 * choices, push tokens, and the sign-in service's "send this code by SMS" hook.
 */
@Controller()
export class HooksController {
  private readonly used = new Map<string, { minute: number; n: number }>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** A per-process cap: enough to stop one account running up the maps bill. The gateway limits per IP as well. */
  private meter(userId: string) {
    const minute = Math.floor(this.now() / 60_000);
    const u = this.used.get(userId);
    if (!u || u.minute !== minute) {
      if (this.used.size > 20_000) this.used.clear();
      this.used.set(userId, { minute, n: 1 });
      return;
    }
    if (++u.n > MAP_LIMIT) throw new AppError(429, 'rate_limited', 'Too many searches. Wait a moment.', { retryAfterSeconds: 30 });
  }

  /** GET /v1/places/search?q=…&lat=…&lng=… */
  @Get('places/search')
  async search(@Query(validate(Search)) q: z.infer<typeof Search>, @CurrentPrincipal() p: Principal) {
    if (!p.user) throw Errors.forbidden('Finish creating your account first.');
    this.meter(p.userId);
    const near = q.lat !== undefined && q.lng !== undefined ? { latitude: q.lat, longitude: q.lng } : null;
    return { places: await this.providers.maps.searchPlaces(q.q, near, p.sessionId ?? p.userId), estimated: this.providers.maps.name === 'fake' };
  }

  /** GET /v1/places/reverse?lat=…&lng=…: the name of a point (for "use my current location"). */
  @Get('places/reverse')
  async reverse(@Query(validate(Reverse)) q: z.infer<typeof Reverse>, @CurrentPrincipal() p: Principal) {
    if (!p.user) throw Errors.forbidden('Finish creating your account first.');
    this.meter(p.userId);
    return { place: await this.providers.maps.reverseGeocode({ latitude: q.lat, longitude: q.lng }) };
  }

  /** GET /v1/me/notifications */
  @Get('me/notifications')
  async prefs(@CurrentPrincipal() p: Principal) {
    if (!p.user) throw Errors.forbidden('Finish creating your account first.');
    const u = (await this.db.query<{ email_receipts: boolean; email: string | null; email_verified_at: Date | null }>(`select email_receipts, email, email_verified_at from app.users where id = $1`, [p.userId])).rows[0]!;
    return { emailReceipts: u.email_receipts, emailConfirmed: !!u.email && !!u.email_verified_at };
  }

  /** PATCH /v1/me/notifications: turn emailed receipts on or off. */
  @Patch('me/notifications')
  async setPrefs(@Body(validate(Prefs)) body: z.infer<typeof Prefs>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!p.user) throw Errors.forbidden('Finish creating your account first.');
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: parseIdempotencyKey(key), method: 'PATCH', path: '/v1/me/notifications', hash: requestHash('PATCH', '/v1/me/notifications', body) }, async (tx) => {
      await tx.query(`update app.users set email_receipts = $2 where id = $1`, [p.userId, body.emailReceipts]);
      await tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ($1, $2, 'Account holder', 'account.receipts_changed', 'user', $2, $3, '{}'::jsonb)`, [p.user!.isRider ? 'rider' : 'driver', p.userId, body.emailReceipts ? 'Turned emailed receipts on' : 'Turned emailed receipts off']);
      return { status: 200, body: { emailReceipts: body.emailReceipts } };
    });
    reply.status(out.status);
    return out.body;
  }

  /** POST /v1/me/push-token: where to send this install's notifications (null to stop). */
  @Post('me/push-token')
  @HttpCode(200)
  async pushToken(@Body(validate(PushToken)) body: z.infer<typeof PushToken>, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal) {
    if (!p.user) throw Errors.forbidden('Finish creating your account first.');
    parseIdempotencyKey(key);
    // One token belongs to one person: taking it over removes it from whoever had it (a shared or sold phone).
    if (body.pushToken) await this.db.query(`update app.devices set push_token = null where push_token = $1 and user_id <> $2`, [body.pushToken, p.userId]);
    const r = await this.db.query(`update app.devices set push_token = $3, push_token_at = now() where user_id = $1 and install_id = $2`, [p.userId, body.installId, body.pushToken]);
    if (!r.rowCount) throw Errors.notFound('Register this device first.');
    return { saved: true };
  }

  /**
   * POST /v1/hooks/auth/send-sms: the sign-in service (Supabase Auth "Send SMS" hook) asks us to deliver a
   * sign-in code. The request must carry a valid Standard Webhooks signature made with the hook's secret.
   * The code is passed straight to the SMS provider: never logged, stored or returned.
   */
  @Post('hooks/auth/send-sms')
  @Public()
  @HttpCode(200)
  async sendSms(@Req() req: RawBodyRequest<FastifyRequest>) {
    const secret = this.config.SUPABASE_SMS_HOOK_SECRET;
    const sms = this.providers.smsCodes;
    if (!secret || !sms) throw Errors.notFound();
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!raw || !verifyStandardWebhook(secret, raw, headers, this.now())) throw Errors.unauthenticated('Invalid signature.');
    const parsed = z.object({ user: z.object({ phone: z.string().regex(/^\+?234[789][01][0-9]{8}$/) }).passthrough(), sms: z.object({ otp: z.string().regex(/^[0-9]{6}$/) }).passthrough() }).safeParse(req.body);
    if (!parsed.success) throw Errors.validation({ phone: 'Only Nigerian mobile numbers can receive codes.' });
    try {
      await sms.sendText(parsed.data.user.phone, `Your GoBye code is ${parsed.data.sms.otp}. It expires in 10 minutes. Never share it.`);
    } catch {
      throw Errors.unavailable('We couldn’t send the code. Try again.');
    }
    return {};
  }
}
