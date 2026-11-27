import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CURRENT_CONSENTS, deletionDueAt, invalidConsents, isNigerianPhone, toE164, type AccountRole } from '@gobye/core';
import { CLOCK, CONFIG, DATABASE } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { enqueue } from '../jobs/queue';
import { meView } from './me.view';
import { exportPersonalData } from './export';

const Name = z.string().trim().min(2, 'Enter your full name.').max(80, 'Use 80 characters or fewer.');
const City = z.enum(['lagos', 'abuja'], { message: 'Choose Lagos or Abuja.' });
const Consents = z
  .array(z.object({ document: z.enum(['terms', 'privacy']), version: z.string().min(1).max(40) }).strict())
  .min(1)
  .max(4);
const InstallId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Use the app install id.');
const Device = z.object({ installId: InstallId, platform: z.enum(['ios', 'android', 'web']), appVersion: z.string().max(32).optional() }).strict();

const CreateProfile = z
  .object({ role: z.enum(['rider', 'driver']), fullName: Name, city: City.optional(), consents: Consents, device: Device.optional() })
  .strict()
  .refine((b) => b.role !== 'driver' || !!b.city, { message: 'Choose the city you will drive in.', path: ['city'] });
const UpdateProfile = z.object({ fullName: Name }).strict();
const AddRole = z
  .object({ role: z.enum(['rider', 'driver']), city: City.optional() })
  .strict()
  .refine((b) => b.role !== 'driver' || !!b.city, { message: 'Choose the city you will drive in.', path: ['city'] });
const AcceptConsents = z.object({ consents: Consents }).strict();
const Empty = z.object({}).strict();

type CreateProfile = z.infer<typeof CreateProfile>;

/**
 * Rider and driver accounts (Backend Phase 2, WP1). Supabase Auth has already signed the person in; these
 * routes create and maintain what GoBye stores about them. Every write takes an Idempotency-Key and writes
 * its audit row in the same transaction.
 */
@Controller('me')
export class AccountsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /**
   * GET /v1/me/export: everything GoBye holds about the caller, as a JSON download (NDPA right of access,
   * D-083). Each export is written to the audit log.
   */
  @Get('export')
  async exportData(@CurrentPrincipal() p: Principal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const body = await this.db.tx(async (tx) => {
      const data = await exportPersonalData(tx, p.userId, new Date(this.now()));
      await this.audit(tx, p.userId, p.user?.isDriver ? 'driver' : 'rider', 'account.export', 'Downloaded their personal data', req, {});
      return data;
    });
    reply.header('content-disposition', `attachment; filename="gobye-my-data-${new Date(this.now()).toISOString().slice(0, 10)}.json"`);
    reply.header('cache-control', 'no-store');
    return body;
  }

  /** POST /v1/me/profile: finish sign-up as a rider or a driver. Needs a confirmed Nigerian phone number. */
  @Post('profile')
  @HttpCode(201)
  async create(
    @Body(validate(CreateProfile)) body: CreateProfile,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'POST', '/v1/me/profile', body, req, reply, async (tx) => {
      if (p.user) throw Errors.conflict('This account is already set up. Add a role instead.');
      const phone = toE164(p.phone);
      if (!isNigerianPhone(phone)) throw Errors.validation({ phone: 'Confirm a Nigerian mobile number (+234) first.' }, 'A confirmed Nigerian phone number is required.');
      this.checkConsents(body.consents);
      const taken = await tx.query(`select 1 from app.users where phone = $1 and status <> 'deleted' and id <> $2`, [phone, p.userId]);
      if (taken.rowCount) throw Errors.conflict('This phone number is already used by another account.');
      await tx.query(`insert into app.users (id, full_name, email, phone) values ($1, $2, $3, $4)`, [p.userId, body.fullName, p.email?.toLowerCase() ?? null, phone]);
      await this.addRole(tx, p.userId, body.role, body.city);
      await this.recordConsents(tx, p.userId, body.consents, req);
      if (body.device) await this.upsertDevice(tx, p.userId, body.device, true);
      await this.audit(tx, p.userId, body.role, 'account.created', `Signed up as a ${body.role}`, req, { role: body.role, city: body.city ?? null });
      return { status: 201, body: await meView(tx, p) };
    });
  }

  /** PATCH /v1/me/profile: the name only. Email and phone change through Supabase (verified), then sync. */
  @Patch('profile')
  async update(
    @Body(validate(UpdateProfile)) body: z.infer<typeof UpdateProfile>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'PATCH', '/v1/me/profile', body, req, reply, async (tx) => {
      this.requireUser(p);
      await tx.query(`update app.users set full_name = $2 where id = $1`, [p.userId, body.fullName]);
      await this.audit(tx, p.userId, this.actorKind(p), 'account.name_changed', 'Changed their name', req, {});
      return { status: 200, body: await meView(tx, p) };
    });
  }

  /** POST /v1/me/roles: a rider becomes a driver too, or the other way round. */
  @Post('roles')
  @HttpCode(201)
  async role(
    @Body(validate(AddRole)) body: z.infer<typeof AddRole>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'POST', '/v1/me/roles', body, req, reply, async (tx) => {
      const u = this.requireUser(p);
      if ((body.role === 'rider' && u.isRider) || (body.role === 'driver' && u.isDriver)) throw Errors.conflict(`You already have a ${body.role} account.`);
      await this.addRole(tx, p.userId, body.role, body.city);
      await this.audit(tx, p.userId, body.role, 'account.role_added', `Added the ${body.role} role`, req, { role: body.role, city: body.city ?? null });
      return { status: 201, body: await meView(tx, p) };
    });
  }

  /** POST /v1/me/consents: accept a newer version of the terms or privacy notice. */
  @Post('consents')
  @HttpCode(201)
  async consents(
    @Body(validate(AcceptConsents)) body: z.infer<typeof AcceptConsents>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'POST', '/v1/me/consents', body, req, reply, async (tx) => {
      this.requireUser(p);
      this.checkConsents(body.consents);
      await this.recordConsents(tx, p.userId, body.consents, req);
      await this.audit(tx, p.userId, this.actorKind(p), 'account.consent_recorded', 'Accepted updated documents', req, { consents: body.consents });
      return { status: 201, body: await meView(tx, p) };
    });
  }

  /** POST /v1/me/devices: register the phone or browser in use. Says whether a phone code is needed (D-062, proposed). */
  @Post('devices')
  async device(
    @Body(validate(Device)) body: z.infer<typeof Device>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'POST', '/v1/me/devices', body, req, reply, async (tx) => {
      this.requireUser(p);
      const d = await this.upsertDevice(tx, p.userId, body, false);
      return { status: 200, body: { deviceId: d.id, verificationRequired: d.verified_at === null } };
    });
  }

  /** DELETE /v1/me: ask for the account to be deleted after the grace period (Apple 5.1.1(v), NDPA). */
  @Delete()
  @HttpCode(202)
  async remove(
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'DELETE', '/v1/me', {}, req, reply, async (tx) => {
      this.requireUser(p);
      const now = this.now();
      const due = new Date(deletionDueAt(now));
      await tx.query(
        `insert into app.account_deletions (user_id, requested_at, scheduled_for) values ($1, $2, $3)
         on conflict (user_id) do update set requested_at = excluded.requested_at, scheduled_for = excluded.scheduled_for, status = 'scheduled'
         where app.account_deletions.status = 'cancelled'`,
        [p.userId, new Date(now), due],
      );
      const row = (await tx.query<{ status: string; scheduled_for: Date }>(`select status, scheduled_for from app.account_deletions where user_id = $1`, [p.userId])).rows[0]!;
      if (row.status === 'completed') throw Errors.conflict('This account has already been deleted.');
      await enqueue(tx, { kind: 'account.delete', idempotencyKey: `account.delete:${p.userId}:${row.scheduled_for.toISOString()}`, payload: { userId: p.userId }, runAt: row.scheduled_for });
      await this.audit(tx, p.userId, this.actorKind(p), 'account.deletion_requested', 'Asked to delete their account', req, { scheduledFor: row.scheduled_for.toISOString() });
      return { status: 202, body: { status: 'scheduled', scheduledFor: row.scheduled_for.toISOString() } };
    });
  }

  /** POST /v1/me/deletion/cancel: changed their mind during the grace period. */
  @Post('deletion/cancel')
  async cancelDeletion(
    @Body(validate(Empty)) body: z.infer<typeof Empty>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.write(p, key, 'POST', '/v1/me/deletion/cancel', body, req, reply, async (tx) => {
      this.requireUser(p);
      const r = await tx.query(`update app.account_deletions set status = 'cancelled' where user_id = $1 and status = 'scheduled'`, [p.userId]);
      if (!r.rowCount) throw Errors.notFound('There is no deletion to cancel.');
      await this.audit(tx, p.userId, this.actorKind(p), 'account.deletion_cancelled', 'Cancelled their account deletion', req, {});
      return { status: 200, body: { status: 'cancelled' } };
    });
  }

  /* ---------- helpers ---------- */

  private async write<T>(
    p: Principal,
    key: string | undefined,
    method: string,
    path: string,
    body: unknown,
    _req: FastifyRequest,
    reply: FastifyReply,
    fn: (tx: Querier) => Promise<{ status: number; body: T }>,
  ): Promise<T> {
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method, path, hash: requestHash(method, path, body) }, fn);
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return out.body;
  }

  private requireUser(p: Principal): NonNullable<Principal['user']> {
    if (!p.user) throw Errors.forbidden('Finish signing up first.');
    return p.user;
  }

  private actorKind(p: Principal): AccountRole {
    return p.user?.isDriver && !p.user.isRider ? 'driver' : 'rider';
  }

  private checkConsents(given: { document: 'terms' | 'privacy'; version: string }[]) {
    const bad = invalidConsents(given);
    if (bad.length) throw Errors.validation({ consents: `Accept the current versions: terms ${CURRENT_CONSENTS.terms}, privacy ${CURRENT_CONSENTS.privacy}.` }, 'These document versions are not current.');
  }

  private async addRole(tx: Querier, userId: string, role: AccountRole, city: string | undefined) {
    if (role === 'rider') await tx.query(`insert into app.riders (user_id) values ($1)`, [userId]);
    else await tx.query(`insert into app.drivers (user_id, city) values ($1, $2)`, [userId, city]);
  }

  private async recordConsents(tx: Querier, userId: string, consents: { document: string; version: string }[], req: FastifyRequest) {
    const ipHash = this.config.IP_HASH_SALT ? createHash('sha256').update(`${this.config.IP_HASH_SALT}:${req.ip}`).digest('hex') : null;
    for (const c of consents) {
      await tx.query(`insert into app.consents (user_id, document, version, ip_hash) values ($1, $2, $3, $4) on conflict (user_id, document, version) do nothing`, [userId, c.document, c.version, ipHash]);
    }
  }

  private async upsertDevice(tx: Querier, userId: string, d: z.infer<typeof Device>, verified: boolean) {
    return (
      await tx.query<{ id: string; verified_at: Date | null }>(
        `insert into app.devices (user_id, install_id, platform, app_version, verified_at) values ($1, $2, $3, $4, case when $5 then now() end)
         on conflict (user_id, install_id) do update set last_seen = now(), platform = excluded.platform, app_version = excluded.app_version,
           verified_at = coalesce(app.devices.verified_at, excluded.verified_at)
         returning id, verified_at`,
        [userId, d.installId, d.platform, d.appVersion ?? null, verified],
      )
    ).rows[0]!;
  }

  private async audit(tx: Querier, userId: string, kind: AccountRole, action: string, summary: string, req: FastifyRequest, data: object) {
    await tx.query(
      `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, request_id, data)
       values ($1, $2, $3, $4, 'user', $2, $5, $6, $7::jsonb)`,
      [kind, userId, `${kind}:${userId}`, action, summary, req.id, JSON.stringify(data)],
    );
  }
}
