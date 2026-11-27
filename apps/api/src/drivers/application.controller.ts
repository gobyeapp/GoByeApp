import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  draftStatus,
  queuedChecks,
  resolveIssuesForStep,
  resubmitApplication,
  submitApplication,
  validateExpiry,
  validateIdentityNumber,
  validateLicenceNumber,
  validatePlate,
  validateVehicleYear,
  type ApplicationFileSlot,
  type DriverApplication,
  type OnboardingStepId,
} from '@gobye/core';
import { CLOCK, DATABASE } from '../tokens';
import type { Database, Querier } from '../database/database';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { applicationView, assertFilesReady, assertFilesUsable, loadApplication, saveApplication, versionConflict, type StoredApplication } from './application.repository';

const FileId = z.string().uuid('Upload the file first.');
const Text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, `Use ${max} characters or fewer.`);

const Steps = {
  personal: z.object({ firstName: Text(40, 'Enter your first name.'), lastName: Text(40, 'Enter your last name.'), email: z.string().trim().email('Check the email address.').max(254).optional(), photoFileId: FileId }).strict(),
  licence: z.object({ number: z.string().max(30), expiry: z.string().max(10), photoFileId: FileId }).strict(),
  identity: z.object({ type: z.enum(['nin', 'voters_card', 'passport']), number: z.string().max(30), selfieFileId: FileId }).strict(),
  vehicle: z
    .object({
      category: z.enum(['keke', 'go', 'comfort', 'xl']),
      make: Text(30, 'Enter the make.'),
      model: Text(30, 'Enter the model.'),
      year: z.union([z.number(), z.string().max(4)]),
      colour: Text(20, 'Enter the colour.'),
      plate: z.string().max(15),
    })
    .strict(),
  documents: z
    .object({ registration: FileId.optional(), insurance: FileId.optional(), roadworthiness: FileId.optional() })
    .strict()
    .refine((d) => Object.keys(d).length > 0, { message: 'Add at least one document.' }),
} as const;

const StepParam = z.object({ step: z.enum(['personal', 'licence', 'identity', 'vehicle', 'documents']) }).strict();
const Empty = z.object({}).strict();

/** "3" or "\"3\"" or W/"3" → 3. */
function parseIfMatch(h: string | undefined): number {
  const m = h ? /^(?:W\/)?"?(\d{1,9})"?$/.exec(h.trim()) : null;
  if (!m) throw Errors.validation({ 'If-Match': 'Send the application version you last read.' }, 'If-Match header is required.');
  return Number(m[1]);
}

function check<T>(field: string, r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw Errors.validation({ [field]: r.error });
  return r.value;
}

/**
 * The driver's own application (Backend Phase 2, WP3). Rules come from @gobye/core driver/onboarding and
 * driver/verification; this controller stores the result, checks files and versions, and records events.
 */
@Controller('drivers/me/application')
export class DriverApplicationController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** GET /v1/drivers/me/application */
  @Get()
  async get(@CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    const s = await this.own(this.db, p, false);
    reply.header('etag', `"${s.version}"`);
    return applicationView(this.db, s);
  }

  /** PUT /v1/drivers/me/application/steps/{step}: save one registration step (If-Match: version). */
  @Put('steps/:step')
  async saveStep(
    @Param(validate(StepParam)) params: z.infer<typeof StepParam>,
    @Body() raw: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const step = params.step as OnboardingStepId;
    const parsed = Steps[step].safeParse(raw);
    if (!parsed.success) throw Errors.validation(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || step, i.message])));
    const expected = parseIfMatch(ifMatch);
    const path = `/v1/drivers/me/application/steps/${step}`;
    return this.write(p, key, 'PUT', path, { body: parsed.data, expected }, reply, async (tx) => {
      const s = await this.own(tx, p, true);
      if (s.version !== expected) throw versionConflict();
      if (!['not_started', 'in_progress', 'changes_requested'].includes(s.app.status)) throw Errors.conflict('This application can’t be changed now.');
      const now = this.now();
      const { app: changed, slots } = this.applyStep(s, step, parsed.data, now);
      await assertFilesUsable(tx, s.driverId, changed, slots);
      let next = resolveIssuesForStep(changed, step, now);
      next = { ...next, status: draftStatus(next) };
      const version = await saveApplication(tx, s, next, { actorKind: 'driver', actorId: p.userId, kind: 'step_saved', data: { step }, requestId: req.id });
      return { status: 200, body: await applicationView(tx, { ...s, app: next, version }) };
    });
  }

  /** POST /v1/drivers/me/application/submit: send for review, or back for review after changes. */
  @Post('submit')
  @HttpCode(200)
  async submit(
    @Body(validate(Empty)) body: z.infer<typeof Empty>,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const expected = parseIfMatch(ifMatch);
    return this.write(p, key, 'POST', '/v1/drivers/me/application/submit', { body, expected }, reply, async (tx) => {
      const s = await this.own(tx, p, true);
      if (s.version !== expected) throw versionConflict();
      const now = this.now();
      const resubmit = s.app.status === 'changes_requested';
      const r = resubmit ? resubmitApplication(s.app, now) : submitApplication(s.app, now);
      if (!r.ok) throw Errors.conflict(r.error);
      await assertFilesReady(tx, s.driverId, s.app);
      const next: DriverApplication = { ...r.value, checks: r.value.checks ?? queuedChecks(now) };
      const version = await saveApplication(tx, s, next, { actorKind: 'driver', actorId: p.userId, kind: resubmit ? 'resubmitted' : 'submitted', requestId: req.id });
      return { status: 200, body: await applicationView(tx, { ...s, app: next, version }) };
    });
  }

  /* ---------- helpers ---------- */

  private applyStep(s: StoredApplication, step: OnboardingStepId, body: unknown, now: number): { app: DriverApplication; slots: ApplicationFileSlot[] } {
    const a = s.app;
    switch (step) {
      case 'personal': {
        const b = body as z.infer<typeof Steps.personal>;
        return { app: { ...a, personal: { firstName: b.firstName, lastName: b.lastName, email: b.email?.toLowerCase(), photoUri: b.photoFileId.toLowerCase(), city: s.city === 'abuja' ? 'Abuja' : 'Lagos' } }, slots: ['photo'] };
      }
      case 'licence': {
        const b = body as z.infer<typeof Steps.licence>;
        const licence = { number: check('number', validateLicenceNumber(b.number)), expiry: check('expiry', validateExpiry(b.expiry, now)), photoUri: b.photoFileId.toLowerCase() };
        return { app: { ...a, licence }, slots: ['licence'] };
      }
      case 'identity': {
        const b = body as z.infer<typeof Steps.identity>;
        return { app: { ...a, identity: { type: b.type, number: check('number', validateIdentityNumber(b.type, b.number)), selfieUri: b.selfieFileId.toLowerCase() } }, slots: ['selfie'] };
      }
      case 'vehicle': {
        const b = body as z.infer<typeof Steps.vehicle>;
        const vehicle = { category: b.category, make: b.make, model: b.model, colour: b.colour, year: check('year', validateVehicleYear(b.year, now)), plate: check('plate', validatePlate(b.plate)) };
        return { app: { ...a, vehicle }, slots: [] };
      }
      case 'documents': {
        const b = body as z.infer<typeof Steps.documents>;
        const given = Object.fromEntries(Object.entries(b).filter(([, v]) => !!v).map(([k, v]) => [k, (v as string).toLowerCase()]));
        return { app: { ...a, documents: { ...a.documents, ...given } }, slots: Object.keys(given) as ApplicationFileSlot[] };
      }
    }
  }

  private async own(q: Querier, p: Principal, lock: boolean): Promise<StoredApplication> {
    if (!p.user?.isDriver) throw Errors.forbidden('Create a driver account first.');
    const s = await loadApplication(q, p.userId, lock);
    if (!s) throw Errors.forbidden('Create a driver account first.');
    return s;
  }

  private async write<T>(p: Principal, key: string | undefined, method: string, path: string, hashed: unknown, reply: FastifyReply, fn: (tx: Querier) => Promise<{ status: number; body: T }>): Promise<T> {
    const idem = parseIdempotencyKey(key);
    const out = await withIdempotency(this.db, { scope: `user:${p.userId}`, key: idem, method, path, hash: requestHash(method, path, hashed) }, fn);
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    const body = out.body as { version?: number };
    if (typeof body?.version === 'number') reply.header('etag', `"${body.version}"`);
    return out.body;
  }
}

