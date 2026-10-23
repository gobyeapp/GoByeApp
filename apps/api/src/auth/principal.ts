import { permissionsOf, type Permission, type StaffRole } from '@gobye/core';
import type { Querier } from '../database/database';
import type { VerifiedToken } from './jwt';

/**
 * Who is calling, decided on the server (never from the request body or token metadata).
 * Rider/driver/staff facts come from the database rows keyed by the Supabase Auth user id.
 */
export interface Principal {
  userId: string;
  sessionId: string | null;
  aal: 'aal1' | 'aal2';
  /** null until the person completes sign-up (no app.users row yet). */
  user: { status: 'active' | 'suspended' | 'deleted'; isRider: boolean; isDriver: boolean; driverCity: string | null; driverVerification: string | null } | null;
  staff: { id: string; roles: StaffRole[]; cities: string[]; status: 'active' | 'suspended' | 'removed' } | null;
  /** Effective staff permissions: the union of roles, and empty without MFA when MFA is required. */
  permissions: ReadonlySet<Permission>;
  /** True when staff permissions are withheld only because the session lacks a second factor. */
  mfaPending: boolean;
}

export interface PrincipalRepository {
  load(userId: string): Promise<{ user: Principal['user']; staff: Principal['staff'] }>;
}

export function buildPrincipal(token: VerifiedToken, rows: { user: Principal['user']; staff: Principal['staff'] }, opts: { staffRequireMfa: boolean }): Principal {
  const activeStaff = rows.staff && rows.staff.status === 'active' ? rows.staff : null;
  const mfaOk = !opts.staffRequireMfa || token.aal === 'aal2';
  const permissions = activeStaff && mfaOk ? permissionsOf({ roles: activeStaff.roles, status: 'active' }) : new Set<Permission>();
  return {
    userId: token.userId,
    sessionId: token.sessionId,
    aal: token.aal,
    user: rows.user,
    staff: rows.staff,
    permissions,
    mfaPending: !!activeStaff && !mfaOk,
  };
}

export function sqlPrincipalRepository(db: Querier): PrincipalRepository {
  return {
    async load(userId) {
      const r = await db.query<{
        user_status: string | null;
        is_rider: boolean;
        is_driver: boolean;
        driver_city: string | null;
        driver_verification: string | null;
        staff_id: string | null;
        staff_roles: string[] | null;
        staff_cities: string[] | null;
        staff_status: string | null;
      }>(
        `select u.status as user_status,
                (r.user_id is not null) as is_rider,
                (d.user_id is not null) as is_driver,
                d.city as driver_city,
                d.verification_status as driver_verification,
                s.id as staff_id, s.roles as staff_roles, s.cities as staff_cities, s.status as staff_status
           from (select $1::uuid as id) me
           left join app.users u on u.id = me.id
           left join app.riders r on r.user_id = me.id
           left join app.drivers d on d.user_id = me.id
           left join app.staff_members s on s.auth_user_id = me.id`,
        [userId],
      );
      const row = r.rows[0]!;
      return {
        user: row.user_status ? { status: row.user_status as 'active', isRider: row.is_rider, isDriver: row.is_driver, driverCity: row.driver_city, driverVerification: row.driver_verification } : null,
        staff: row.staff_id ? { id: row.staff_id, roles: (row.staff_roles ?? []) as StaffRole[], cities: row.staff_cities ?? [], status: row.staff_status as 'active' } : null,
      };
    },
  };
}
