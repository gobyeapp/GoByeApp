import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../config/config';
import { Errors } from '../common/errors';

/**
 * Access-token verification (docs/AUTHENTICATION_PLAN.md): Supabase Auth by default, or any standards-based
 * (OIDC/JWKS) provider with AUTH_PROVIDER=oidc (docs/DATA_PLATFORM_PORTABILITY.md).
 *
 * - Asymmetric signing keys (ES256 / RS256) from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 *   Keys are cached for at most 10 minutes (Supabase's own edge cache time); unknown `kid` triggers a
 *   refetch, rate limited by jose's cooldown, so key rotation works without a restart.
 * - The legacy shared secret (HS256) is accepted only in development/test when explicitly enabled.
 * - Checks: signature, `iss`, `aud`, `exp`/`nbf` (5 s leeway), `sub` is a UUID, `role` = authenticated.
 *   Anonymous users and service-role tokens are refused: a leaked service key must not act as a user.
 * - Nothing about the user's permissions comes from the token's user_metadata (user-editable).
 */

export interface VerifiedToken {
  userId: string;
  sessionId: string | null;
  /** Authenticator assurance level: aal2 = signed in with a second factor (staff MFA). */
  aal: 'aal1' | 'aal2';
  email: string | null;
  phone: string | null;
  expiresAt: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
  /** For /health/ready (non-critical): can the signing keys be fetched? */
  keysReachable(): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/**
 * Claims → token. `supabase`: Supabase Auth's claims (role = authenticated, aal). `oidc`: standard claims
 * from any provider; a second factor is read from `aal` or from `amr` (RFC 8176: mfa, otp, hwk, swk).
 * Either way `sub` must be the UUID the account has in app.users: moving providers keeps user ids
 * (docs/DATA_PLATFORM_PORTABILITY.md).
 */
export function claimsToToken(p: JWTPayload, flavour: 'supabase' | 'oidc' = 'supabase'): VerifiedToken {
  if (typeof p.sub !== 'string' || !UUID.test(p.sub)) throw Errors.unauthenticated();
  if (p.is_anonymous === true) throw Errors.unauthenticated();
  let aal: 'aal1' | 'aal2';
  if (flavour === 'supabase') {
    if (p.role !== 'authenticated') throw Errors.unauthenticated();
    aal = p.aal === 'aal2' ? 'aal2' : 'aal1';
  } else {
    // A service or machine token is never a person.
    if (p.role !== undefined && p.role !== 'authenticated') throw Errors.unauthenticated();
    const amr = Array.isArray(p.amr) ? p.amr.map(String) : [];
    aal = p.aal === 'aal2' || amr.some((m) => ['mfa', 'otp', 'hwk', 'swk', 'totp'].includes(m)) ? 'aal2' : 'aal1';
  }
  return {
    userId: p.sub.toLowerCase(),
    sessionId: typeof p.session_id === 'string' ? p.session_id : typeof p.sid === 'string' ? p.sid : null,
    aal,
    email: typeof p.email === 'string' && p.email ? p.email : null,
    phone: typeof p.phone === 'string' && p.phone ? p.phone : null,
    expiresAt: (p.exp ?? 0) * 1000,
  };
}

export interface VerifierOptions {
  issuer: string;
  audience: string;
  /** Asymmetric key lookup (remote JWKS in deployments; local JWKS in tests). */
  keys?: JWTVerifyGetKey;
  /** Legacy HS256 secret (development/test only, config refuses it elsewhere). */
  sharedSecret?: string;
  keysReachable?: () => Promise<boolean>;
  /** Claim conventions: Supabase Auth (default) or standard OIDC. */
  flavour?: 'supabase' | 'oidc';
}

export function createTokenVerifier(o: VerifierOptions): TokenVerifier {
  const secret = o.sharedSecret ? new TextEncoder().encode(o.sharedSecret) : null;
  const common = { issuer: o.issuer, audience: o.audience, clockTolerance: 5, requiredClaims: ['exp', 'sub', 'iss', 'aud'] };
  return {
    async verify(token: string) {
      if (!token || token.length > 8192 || token.split('.').length !== 3) throw Errors.unauthenticated();
      try {
        let payload: JWTPayload;
        const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as { alg?: string };
        if (header.alg === 'HS256') {
          if (!secret) throw Errors.unauthenticated();
          ({ payload } = await jwtVerify(token, secret, { ...common, algorithms: ['HS256'] }));
        } else {
          if (!o.keys) throw Errors.unauthenticated();
          ({ payload } = await jwtVerify(token, o.keys, { ...common, algorithms: ['ES256', 'RS256'] }));
        }
        return claimsToToken(payload, o.flavour ?? 'supabase');
      } catch (e) {
        if (e instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
        if (e instanceof joseErrors.JWKSTimeout) throw Errors.unavailable('Sign-in could not be checked right now. Try again shortly.');
        if ((e as { name?: string }).name === 'AppError') throw e;
        throw Errors.unauthenticated();
      }
    },
    keysReachable: o.keysReachable ?? (async () => !!secret),
  };
}

/** Verifier from configuration: remote JWKS (cached ≤ 10 min) plus the dev-only shared secret. */
export function verifierFromConfig(c: AppConfig): TokenVerifier | null {
  const oidc = c.AUTH_PROVIDER === 'oidc';
  if (!oidc && !c.SUPABASE_URL && !c.SUPABASE_JWT_SECRET) return null;
  if (oidc && (!c.AUTH_ISSUER || !c.AUTH_JWKS_URL || !c.AUTH_AUDIENCE)) return null;
  const issuer = oidc ? c.AUTH_ISSUER! : c.SUPABASE_URL ? supabaseIssuer(c.SUPABASE_URL) : 'http://localhost/auth/v1';
  const jwksUrl = oidc ? c.AUTH_JWKS_URL! : c.SUPABASE_URL ? `${issuer}/.well-known/jwks.json` : null;
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
  if (jwksUrl) {
    keys = createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 600_000, cooldownDuration: 30_000, timeoutDuration: 3000 });
  }
  return createTokenVerifier({
    issuer,
    audience: oidc ? c.AUTH_AUDIENCE! : c.SUPABASE_JWT_AUDIENCE,
    keys,
    flavour: oidc ? 'oidc' : 'supabase',
    sharedSecret: !oidc && c.SUPABASE_ALLOW_HS256 ? c.SUPABASE_JWT_SECRET : undefined,
    keysReachable: keys ? cached(60_000, async () => {
      try {
        if (!keys!.fresh) await keys!.reload();
        return (keys!.jwks()?.keys?.length ?? 0) > 0;
      } catch {
        return false;
      }
    }) : undefined,
  });
}

/** Readiness probes run every few seconds; check the key endpoint at most once per window. */
function cached(windowMs: number, fn: () => Promise<boolean>): () => Promise<boolean> {
  let at = 0;
  let last = false;
  let inflight: Promise<boolean> | null = null;
  return async () => {
    if (Date.now() - at < windowMs) return last;
    inflight ??= fn().then((v) => ((last = v), (at = Date.now()), (inflight = null), v));
    return inflight;
  };
}
