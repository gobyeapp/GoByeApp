import { consentsNeeded, type ConsentDocument } from '@gobye/core';
import type { Querier } from '../database/database';
import { sqlPrincipalRepository, type Principal } from '../auth/principal';

/**
 * The body of GET /v1/me, read fresh inside the caller's transaction so a write returns the state it
 * just created. The apps use it after sign-in to choose their next screen.
 */
export async function meView(q: Querier, p: Principal) {
  const { user } = await sqlPrincipalRepository(q).load(p.userId);
  const accepted = user
    ? (await q.query<{ document: ConsentDocument; version: string }>(`select document, version from app.consents where user_id = $1`, [p.userId])).rows
    : [];
  const deletion = user
    ? (await q.query<{ status: string; scheduled_for: Date }>(`select status, scheduled_for from app.account_deletions where user_id = $1 and status = 'scheduled'`, [p.userId])).rows[0]
    : undefined;
  return {
    userId: p.userId,
    signupComplete: !!user,
    status: user?.status ?? null,
    phoneConfirmed: !!p.phone,
    rider: user?.isRider ?? false,
    driver: user?.isDriver ? { city: user.driverCity, verification: user.driverVerification } : null,
    consentsNeeded: user ? consentsNeeded(accepted) : [],
    deletion: deletion ? { status: 'scheduled', scheduledFor: deletion.scheduled_for.toISOString() } : null,
    staff: p.staff
      ? { roles: p.staff.roles, cities: p.staff.cities, status: p.staff.status, mfaRequired: p.mfaPending, permissions: [...p.permissions].sort() }
      : null,
    session: { aal: p.aal },
  };
}
