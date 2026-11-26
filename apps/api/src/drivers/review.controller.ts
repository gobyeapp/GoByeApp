import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { decideApplication, ISSUES, openIssues, requestChanges, type IssueCode } from '@gobye/core';
import { CLOCK, DATABASE } from '../tokens';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import { assertCityScope } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { applicationView, assertFilesReady, loadApplication, saveApplication, versionConflict, type StoredApplication } from './application.repository';

const ISSUE_CODES = Object.keys(ISSUES) as [IssueCode, ...IssueCode[]];
const Status = z.enum(['in_progress', 'pending_review', 'changes_requested', 'approved', 'rejected']);
const ListQuery = z
  .object({ status: Status.default('pending_review'), city: z.enum(['lagos', 'abuja']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();
const IdParam = z.object({ driverId: z.string().uuid('Must be a driver id.') }).strict();
const Version = z.number().int().positive();
const RequestChanges = z
  .object({ version: Version, issues: z.array(z.object({ code: z.enum(ISSUE_CODES), note: z.string().trim().max(280).optional() }).strict()).min(1).max(10), note: z.string().trim().max(500).optional() })
  .strict();
const Decision = z.discriminatedUnion('decision', [
  z.object({ version: Version, decision: z.literal('approve') }).strict(),
  z.object({ version: Version, decision: z.literal('reject'), reason: z.string().trim().min(10, 'Give the driver a reason (at least 10 characters).').max(500) }).strict(),
]);

interface QueueRow {
  driver_id: string;
  full_name: string;
  city: string;
  status: string;
  version: number;
  submitted_at: Date | null;
  updated_at: Date;
  open_issues: number;
}

/**
 * Staff review of driver applications (Backend Phase 2, WP3). Reading needs drivers.view, deciding needs
 * drivers.verify; both need a confirmed second factor and stay inside the staff member's cities.
 */
@Controller('staff/driver-applications')
export class DriverReviewController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** GET /v1/staff/driver-applications?status&city: the review queue, oldest submission first. */
  @Get()
  @RequirePermission('drivers.view')
  async list(@Query(validate(ListQuery)) q: z.infer<typeof ListQuery>, @CurrentPrincipal() p: Principal) {
    const scope = p.staff?.cities ?? [];
    if (q.city && scope.length && !scope.includes(q.city)) throw Errors.forbidden('This city is outside your cities.');
    const cities = q.city ? [q.city] : scope.length ? scope : null;
    const r = await this.db.query<QueueRow>(
      `select a.driver_id, u.full_name, d.city, a.status, a.version, a.submitted_at, a.updated_at,
              (select count(*)::int from jsonb_array_elements(coalesce(a.data->'issues', '[]'::jsonb)) i where i->>'resolvedAt' is null) as open_issues
         from app.driver_applications a
         join app.drivers d on d.user_id = a.driver_id
         join app.users u on u.id = a.driver_id
        where a.status = $1 and ($2::text[] is null or d.city = any($2))
        order by a.submitted_at nulls last, a.updated_at
        limit $3`,
      [q.status, cities, q.limit],
    );
    return {
      items: r.rows.map((x) => ({
        driverId: x.driver_id,
        name: x.full_name,
        city: x.city,
        status: x.status,
        version: x.version,
        submittedAt: x.submitted_at?.toISOString() ?? null,
        updatedAt: x.updated_at.toISOString(),
        openIssues: x.open_issues,
      })),
    };
  }

  /** GET /v1/staff/driver-applications/{driverId}: everything needed to review, plus the history. */
  @Get(':driverId')
  @RequirePermission('drivers.view')
  async get(@Param(validate(IdParam)) params: z.infer<typeof IdParam>, @CurrentPrincipal() p: Principal) {
    const s = await this.load(this.db, p, params.driverId, false);
    const person = (await this.db.query<{ full_name: string; email: string | null; phone: string | null }>(`select full_name, email, phone from app.users where id = $1`, [s.driverId])).rows[0]!;
    const events = (
      await this.db.query<{ at: Date; actor_kind: string; kind: string; version: number; data: object }>(
        `select at, actor_kind, kind, version, data from app.application_events where driver_id = $1 order by id desc limit 50`,
        [s.driverId],
      )
    ).rows;
    const contact = p.permissions.has('drivers.contact_details');
    return {
      ...(await applicationView(this.db, s)),
      driver: { name: person.full_name, ...(contact ? { email: person.email, phone: person.phone } : {}) },
      events: events.map((e) => ({ at: e.at.toISOString(), by: e.actor_kind, kind: e.kind, version: e.version, data: e.data })),
    };
  }

  /** POST …/{driverId}/request-changes: send it back with the items to fix. */
  @Post(':driverId/request-changes')
  @HttpCode(200)
  @RequirePermission('drivers.verify')
  async requestChanges(
    @Param(validate(IdParam)) params: z.infer<typeof IdParam>,
    @Body(validate(RequestChanges)) body: z.infer<typeof RequestChanges>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const path = `/v1/staff/driver-applications/${params.driverId}/request-changes`;
    return this.write(p, key, 'POST', path, body, reply, async (tx) => {
      const s = await this.load(tx, p, params.driverId, true);
      if (s.version !== body.version) throw versionConflict();
      const r = requestChanges(s.app, body.issues, this.now(), body.note);
      if (!r.ok) throw Errors.conflict(r.error);
      const version = await saveApplication(tx, s, r.value, {
        actorKind: 'staff',
        actorId: p.staff!.id,
        kind: 'changes_requested',
        data: { issues: body.issues.map((i) => i.code), open: openIssues(r.value).length },
        requestId: req.id,
        reason: body.note,
      });
      return { status: 200, body: await applicationView(tx, { ...s, app: r.value, version }) };
    });
  }

  /** POST …/{driverId}/decision: approve (documents checked, licence valid) or reject with a reason. */
  @Post(':driverId/decision')
  @HttpCode(200)
  @RequirePermission('drivers.verify')
  async decide(
    @Param(validate(IdParam)) params: z.infer<typeof IdParam>,
    @Body(validate(Decision)) body: z.infer<typeof Decision>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const path = `/v1/staff/driver-applications/${params.driverId}/decision`;
    return this.write(p, key, 'POST', path, body, reply, async (tx) => {
      const s = await this.load(tx, p, params.driverId, true);
      if (s.version !== body.version) throw versionConflict();
      const now = this.now();
      const r = decideApplication(s.app, body.decision === 'approve' ? { kind: 'approve' } : { kind: 'reject', reason: body.reason }, now);
      if (!r.ok) throw Errors.conflict(r.error);
      if (body.decision === 'approve') {
        await assertFilesReady(tx, s.driverId, s.app);
        await this.activateVehicle(tx, s);
      }
      const version = await saveApplication(tx, s, r.value, {
        actorKind: 'staff',
        actorId: p.staff!.id,
        kind: body.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: p.staff!.id,
        requestId: req.id,
        reason: body.decision === 'reject' ? body.reason : undefined,
      });
      return { status: 200, body: await applicationView(tx, { ...s, app: r.value, version }) };
    });
  }

  /* ---------- helpers ---------- */

  /** The approved vehicle becomes the driver's active vehicle. A plate already active elsewhere stops approval. */
  private async activateVehicle(tx: Querier, s: StoredApplication) {
    const v = s.app.vehicle!;
    const plateKey = v.plate.replace(/ /g, '').toUpperCase();
    const taken = await tx.query(`select 1 from app.vehicles where upper(replace(plate, ' ', '')) = $1 and status <> 'retired' and driver_id <> $2`, [plateKey, s.driverId]);
    if (taken.rowCount) throw Errors.conflict('This plate is already registered to another driver. Check it before approving.');
    await tx.query(`update app.vehicles set status = 'retired' where driver_id = $1 and status <> 'retired'`, [s.driverId]);
    await tx.query(
      `insert into app.vehicles (driver_id, category, make, model, colour, year, plate, status) values ($1, $2, $3, $4, $5, $6, $7, 'active')`,
      [s.driverId, v.category, v.make, v.model, v.colour, v.year, v.plate],
    );
  }

  private async load(q: Querier, p: Principal, driverId: string, lock: boolean): Promise<StoredApplication> {
    const id = driverId.toLowerCase();
    if (id === p.userId) throw Errors.forbidden('You can’t review your own application.');
    const s = await loadApplication(q, id, lock);
    if (!s || s.version === 0) throw Errors.notFound('Application not found.');
    assertCityScope(p, s.city);
    return s;
  }

  private async write<T>(p: Principal, key: string | undefined, method: string, path: string, body: unknown, reply: FastifyReply, fn: (tx: Querier) => Promise<{ status: number; body: T }>): Promise<T> {
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `staff:${p.staff!.id}`, key: idem, method, path, hash: requestHash(method, path, body) }, fn);
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return out.body;
  }
}
