/**
 * Management platform: staff roles are permission groups (owner brief 2026-10-21 §1). A staff member
 * may hold several roles; their access is the union of those roles' permissions, never a merged
 * "super role". Sensitive actions additionally need an approval from someone else (see approvals.ts).
 */

export type StaffRole =
  | 'owner'
  | 'admin'
  | 'operations'
  | 'onboarding'
  | 'care'
  | 'safety'
  | 'finance'
  | 'marketing'
  | 'developer'
  | 'auditor';

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Company owner',
  admin: 'Platform administrator',
  operations: 'Operations and dispatch',
  onboarding: 'Driver onboarding',
  care: 'Customer care',
  safety: 'Safety',
  finance: 'Accounting and finance',
  marketing: 'Marketing and partnerships',
  developer: 'Developer and technical',
  auditor: 'Auditor (read only)',
};

/**
 * Permission keys: `<area>.<action>`. `view` reads records; other actions change them.
 * Keep this list the single source for the admin UI, the API contract and tests.
 */
export const PERMISSIONS = [
  // Oversight
  'overview.view',
  'staff.view',
  'staff.manage',
  'approvals.view',
  'approvals.decide',
  'audit.view',
  'reports.view',
  'reports.export',
  // People and trips
  'passengers.view',
  'passengers.restrict',
  'passengers.contact_details',
  'drivers.view',
  'drivers.verify',
  'drivers.restrict',
  'drivers.contact_details',
  'trips.view',
  'trips.intervene',
  'live.view',
  'live.dispatch',
  // Configuration (versioned, effective dated)
  'config.view',
  'config.edit',
  'config.publish',
  // Care and safety
  'cases.view',
  'cases.work',
  'cases.assign',
  'safety.view',
  'safety.work',
  'safety.location',
  // Money
  'finance.view',
  'ledger.view',
  'ledger.adjust',
  'refunds.request',
  'refunds.approve',
  'withdrawals.view',
  'withdrawals.review',
  'withdrawals.process',
  'reconciliation.work',
  // Payments setup and technical
  'payments_setup.view',
  'payments_setup.approve',
  'integrations.view',
  'integrations.configure',
  'integrations.secrets',
  'logs.view',
  // Growth
  'comms.view',
  'comms.draft',
  'comms.publish',
  'promos.manage',
  'referrals.manage',
  'events.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEW_ALL: Permission[] = PERMISSIONS.filter((p) => p.endsWith('.view'));

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: [
    ...VIEW_ALL,
    'staff.manage',
    'approvals.decide',
    'reports.export',
    'payments_setup.approve',
    'config.publish',
    'refunds.approve',
    'comms.publish',
  ],
  admin: [
    'overview.view', 'passengers.view', 'passengers.restrict', 'drivers.view', 'drivers.verify', 'drivers.restrict', 'trips.view', 'live.view',
    'config.view', 'config.edit', 'cases.view', 'approvals.view', 'audit.view', 'reports.view', 'promos.manage', 'referrals.manage', 'events.manage', 'comms.view', 'comms.draft',
  ],
  operations: ['overview.view', 'live.view', 'live.dispatch', 'trips.view', 'trips.intervene', 'drivers.view', 'passengers.view', 'cases.view', 'config.view'],
  onboarding: ['drivers.view', 'drivers.verify', 'drivers.contact_details', 'cases.view'],
  care: ['passengers.view', 'passengers.contact_details', 'drivers.view', 'trips.view', 'cases.view', 'cases.work', 'cases.assign', 'finance.view', 'refunds.request'],
  safety: ['safety.view', 'safety.work', 'safety.location', 'trips.view', 'passengers.view', 'passengers.contact_details', 'drivers.view', 'drivers.contact_details', 'drivers.restrict', 'passengers.restrict', 'cases.view'],
  finance: [
    'overview.view', 'finance.view', 'ledger.view', 'ledger.adjust', 'refunds.request', 'refunds.approve', 'withdrawals.view', 'withdrawals.review', 'withdrawals.process',
    'reconciliation.work', 'reports.view', 'reports.export', 'trips.view', 'passengers.view', 'drivers.view', 'payments_setup.view', 'approvals.view', 'audit.view',
  ],
  marketing: ['comms.view', 'comms.draft', 'comms.publish', 'promos.manage', 'referrals.manage', 'events.manage', 'reports.view', 'config.view'],
  developer: ['integrations.view', 'integrations.configure', 'integrations.secrets', 'logs.view', 'payments_setup.view', 'audit.view'],
  // Read only by construction: only `.view` permissions, never contact details or precise safety location.
  auditor: VIEW_ALL.filter((p) => p !== 'safety.view'),
};

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  roles: StaffRole[];
  /** City scope; empty = all cities. */
  cities: string[];
  status: 'invited' | 'active' | 'suspended';
}

export function permissionsOf(staff: Pick<StaffMember, 'roles' | 'status'>): Set<Permission> {
  if (staff.status !== 'active') return new Set();
  return new Set(staff.roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

export function can(staff: Pick<StaffMember, 'roles' | 'status'>, permission: Permission): boolean {
  return permissionsOf(staff).has(permission);
}

/** True if the staff member can see records in `city` (empty scope = every city). */
export function inCityScope(staff: Pick<StaffMember, 'cities'>, city: string): boolean {
  return staff.cities.length === 0 || staff.cities.includes(city);
}

/** Every permission must be a `.view` one for a read-only role (guard used by tests and the staff editor). */
export function isReadOnly(roles: StaffRole[]): boolean {
  return roles.flatMap((r) => ROLE_PERMISSIONS[r]).every((p) => p.endsWith('.view'));
}
