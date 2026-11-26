import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { fileRolesFor, type FileCaller, type SqlQuerier } from '@gobye/core';

/**
 * The caller from the app's own Supabase session (WP3b, D-082), for when the gateway does not sign an
 * assertion: the access token is verified against Supabase's signing keys (issuer, audience, expiry,
 * `role = authenticated`, not anonymous), and the file roles come from the database. Never from the
 * token's metadata, which the user can edit.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jwks = new Map<string, JWTVerifyGetKey>();

export async function callerFromToken(p: { authorization: string | null; supabaseUrl: string; db: SqlQuerier; getKey?: JWTVerifyGetKey }): Promise<FileCaller | null> {
  const m = p.authorization ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(p.authorization) : null;
  if (!m) return null;
  const issuer = `${p.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  let getKey = p.getKey ?? jwks.get(issuer);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { cacheMaxAge: 600_000 });
    jwks.set(issuer, getKey);
  }
  let claims: Record<string, unknown>;
  try {
    claims = (await jwtVerify(m[1]!, getKey, { issuer, audience: 'authenticated', clockTolerance: 5, algorithms: ['ES256', 'RS256'] })).payload as Record<string, unknown>;
  } catch {
    return null;
  }
  const sub = claims.sub;
  if (typeof sub !== 'string' || !UUID.test(sub) || claims.role !== 'authenticated' || claims.is_anonymous === true) return null;
  const userId = sub.toLowerCase();
  const r = await p.db.query(
    `select (select status from app.users where id = $1) as user_status,
            exists (select 1 from app.riders where user_id = $1) as is_rider,
            exists (select 1 from app.drivers where user_id = $1) as is_driver,
            (select roles from app.staff_members where auth_user_id = $1 and status = 'active') as staff_roles`,
    [userId],
  );
  const row = r.rows[0] as { user_status: string | null; is_rider: boolean; is_driver: boolean; staff_roles: string[] | null } | undefined;
  if (!row) return null;
  const roles = fileRolesFor({ active: row.user_status === 'active', isRider: row.is_rider, isDriver: row.is_driver, staffRoles: row.staff_roles ?? [], aal2: claims.aal === 'aal2' });
  return roles.length ? { userId, roles } : null;
}
