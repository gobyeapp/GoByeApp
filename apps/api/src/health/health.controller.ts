import { Controller, Get, Inject, Res, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { publicHealth, readiness, healthHttpStatus, type HealthReport } from '@gobye/core';
import type { FastifyReply } from 'fastify';
import { CONFIG, DATABASE, MIGRATIONS, TOKEN_VERIFIER } from '../tokens';
import type { AppConfig } from '../config/config';
import type { Database } from '../database/database';
import { schemaIsCurrent, type MigrationFile } from '../database/migrations';
import type { TokenVerifier } from '../auth/jwt';
import { Public, RequirePermission, SkipOriginAuth } from '../auth/decorators';
import { RawResponse } from '../common/envelope.interceptor';

/**
 * Health (contract in packages/core/src/infra/health.ts):
 * - GET /health/live   process is up; no dependency checks. Used by the host to restart a hung process.
 * - GET /health/ready  can serve traffic: database reachable (critical), schema at this build's version
 *                      (critical), auth signing keys reachable (non-critical → "degraded"). 503 when not ready.
 * Both are unversioned, public and exempt from the gateway signature (host and gateway probes call them).
 * They return status and version only; dependency names and timings are on the staff-only /v1/ops/health.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MIGRATIONS) private readonly migrations: MigrationFile[],
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
  ) {}

  async report(): Promise<HealthReport & { timingsMs: Record<string, number> }> {
    const timingsMs: Record<string, number> = {};
    const timed = async (name: string, f: () => Promise<boolean>) => {
      const t = performance.now();
      const ok = await f().catch(() => false);
      timingsMs[name] = Math.round(performance.now() - t);
      return ok ? ('ok' as const) : ('fail' as const);
    };
    const database = await timed('database', () => this.db.ping(2000));
    const schema = database === 'ok' ? await timed('schema', () => schemaIsCurrent(this.db as never, this.migrations)) : 'fail';
    const authKeys = await timed('auth_keys', () => (this.verifier ? this.verifier.keysReachable() : Promise.resolve(false)));
    return { ...readiness(this.config.APP_VERSION, { database, schema, auth_keys: authKeys }, ['database', 'schema']), timingsMs };
  }

  @Get('health/live')
  @Version(VERSION_NEUTRAL)
  @Public()
  @SkipOriginAuth()
  @RawResponse()
  live() {
    return { status: 'ok', version: this.config.APP_VERSION };
  }

  @Get('health/ready')
  @Version(VERSION_NEUTRAL)
  @Public()
  @SkipOriginAuth()
  @RawResponse()
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.report();
    reply.status(healthHttpStatus(r));
    if (r.status === 'unavailable') reply.header('retry-after', '5');
    return publicHealth(r);
  }

  /** Full detail for staff dashboards (developer/technical roles hold logs.view). */
  @Get('ops/health')
  @RequirePermission('logs.view')
  async detail() {
    const r = await this.report();
    return { ...r, environment: this.config.APP_ENV };
  }
}
