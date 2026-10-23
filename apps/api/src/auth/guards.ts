import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Permission } from '@gobye/core';
import type { FastifyRequest } from 'fastify';
import { CONFIG, PRINCIPALS, TOKEN_VERIFIER } from '../tokens';
import type { AppConfig } from '../config/config';
import { Errors } from '../common/errors';
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS, SKIP_ORIGIN_AUTH } from './decorators';
import type { TokenVerifier } from './jwt';
import { buildPrincipal, type Principal, type PrincipalRepository } from './principal';

/**
 * Guard order (registered globally in app.module.ts):
 * 1. OriginAuthGuard: the request came through our Cloudflare gateway (HMAC over request id + time).
 * 2. AuthGuard: a valid Supabase session; builds the Principal from the database.
 * 3. PermissionGuard: staff permissions required by the route.
 * Ownership checks ("is this my ride?") happen in the handlers, which know the resource.
 */

/**
 * Same algorithm as infra/cloudflare/src/workers/api-gateway/originAuth.ts (tested against each other):
 * HMAC-SHA256 over `${requestId}.${t}.${METHOD}.${pathAndQuery}`, valid for 60 s.
 */
export function verifyOriginSignature(secret: string, requestId: string, header: string | undefined, now: number, method: string, pathAndQuery: string, maxAgeMs = 60_000): boolean {
  const m = header ? /^t=(\d+),sig=([0-9a-f]{64})$/.exec(header) : null;
  if (!m) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(now - t) > maxAgeMs) return false;
  const want = createHmac('sha256', secret).update(`${requestId}.${t}.${method.toUpperCase()}.${pathAndQuery}`).digest();
  const got = Buffer.from(m[2]!, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Per-instance memory of signed request ids seen in the last 60 s: a captured header can't be replayed
 * against this instance even for the same route. (The gateway issues a new id per client request.)
 */
export class ReplayCache {
  private readonly seen = new Map<string, number>();
  constructor(private readonly windowMs = 60_000, private readonly maxEntries = 100_000) {}

  /** True the first time an id is presented within the window. */
  firstUse(id: string, now: number): boolean {
    if (this.seen.size > this.maxEntries || this.seen.size % 1000 === 0) for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
    const exp = this.seen.get(id);
    if (exp && exp > now) return false;
    if (this.seen.size >= this.maxEntries) return false; // under a flood, refuse rather than forget
    this.seen.set(id, now + this.windowMs * 2);
    return true;
  }
}

@Injectable()
export class OriginAuthGuard implements CanActivate {
  private readonly replays = new ReplayCache();

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.config.ORIGIN_AUTH_REQUIRED) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_AUTH, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers['x-gobye-origin-auth'];
    const requestId = String(req.headers['x-request-id'] ?? '');
    const now = Date.now();
    const ok = verifyOriginSignature(this.config.ORIGIN_AUTH_SECRET!, requestId, Array.isArray(header) ? header[0] : header, now, req.method, req.url);
    // Same answer whatever failed: direct callers learn nothing about the API.
    if (!ok || !this.replays.firstUse(requestId, now)) throw Errors.forbidden('Requests must come through api.gobye.app.');
    return true;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
    @Inject(PRINCIPALS) private readonly principals: PrincipalRepository | null,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { principal?: Principal }>();
    const auth = req.headers.authorization;
    const m = typeof auth === 'string' ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(auth) : null;
    if (!m) throw Errors.unauthenticated();
    if (!this.verifier) throw Errors.notConfigured('Sign-in');
    const token = await this.verifier.verify(m[1]!);
    if (!this.principals) throw Errors.notConfigured('The database');
    const principal = buildPrincipal(token, await this.principals.load(token.userId), { staffRequireMfa: this.config.STAFF_REQUIRE_MFA });
    if (principal.user && principal.user.status !== 'active') throw Errors.suspended();
    if (principal.staff && principal.staff.status !== 'active' && !principal.user) throw Errors.suspended();
    req.principal = principal;
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (!needed?.length) return true;
    const p = ctx.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    if (!p) throw Errors.unauthenticated();
    if (p.mfaPending) throw Errors.mfaRequired();
    if (!needed.every((perm) => p.permissions.has(perm))) throw Errors.forbidden();
    return true;
  }
}

/** City scope for staff limited to some cities (empty list = all cities). */
export function assertCityScope(p: Principal, city: string | null | undefined) {
  if (!p.staff || !p.staff.cities.length || !city) return;
  if (!p.staff.cities.includes(city)) throw Errors.forbidden('This record is outside your cities.');
}
