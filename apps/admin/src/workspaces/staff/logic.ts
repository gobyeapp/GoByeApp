import type { Permission, StaffMember, StaffRole } from '@gobye/core';

/** Roles whose grant needs owner approval unless the owner grants them (APPROVAL_RULES.staff_role). */
export const SENSITIVE_ROLES: readonly StaffRole[] = ['owner', 'finance', 'developer'];

export interface RolePlan {
  /** Roles to set on the record now. */
  applyNow: StaffRole[];
  /** Newly added sensitive roles that wait for an approval. */
  pending: StaffRole[];
}

/**
 * Split a role change into what applies now and what waits for approval. Removing roles always applies
 * now. The owner's own grants apply immediately (still audited).
 */
export function planRoleChange(current: readonly StaffRole[], next: readonly StaffRole[], actorIsOwner: boolean): RolePlan {
  const added = next.filter((r) => !current.includes(r));
  const pending = actorIsOwner ? [] : added.filter((r) => SENSITIVE_ROLES.includes(r));
  return { applyNow: next.filter((r) => !pending.includes(r)), pending };
}

/** Permissions grouped by area ("drivers.verify" → "drivers"), areas and keys sorted. */
export function groupPermissions(perms: Iterable<Permission>): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const p of perms) {
    const [area, action] = p.split('.') as [string, string];
    m.set(area, [...(m.get(area) ?? []), action]);
  }
  return [...m.entries()].map(([a, xs]) => [a, xs.sort()] as [string, string[]]).sort((a, b) => a[0].localeCompare(b[0]));
}

export const AREA_LABELS: Record<string, string> = {
  overview: 'Overview',
  staff: 'Staff',
  approvals: 'Approvals',
  audit: 'Audit',
  reports: 'Reports',
  passengers: 'Passengers',
  drivers: 'Drivers',
  trips: 'Trips',
  live: 'Live operations',
  config: 'Configuration',
  cases: 'Support cases',
  safety: 'Safety',
  finance: 'Finance',
  ledger: 'Ledger',
  refunds: 'Refunds',
  withdrawals: 'Withdrawals',
  reconciliation: 'Reconciliation',
  payments_setup: 'Payments setup',
  integrations: 'Integrations',
  logs: 'Logs',
  comms: 'Announcements',
  promos: 'Promotions',
  referrals: 'Referrals',
  events: 'Events',
};

export interface InviteInput {
  name: string;
  email: string;
  roles: StaffRole[];
}

export function validateInvite(input: InviteInput, existing: readonly Pick<StaffMember, 'email'>[]): Partial<Record<keyof InviteInput, string>> {
  const e: Partial<Record<keyof InviteInput, string>> = {};
  if (!input.name.trim()) e.name = 'Enter a name';
  const email = input.email.trim().toLowerCase();
  if (!email) e.email = 'Enter an email address';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email address';
  else if (existing.some((s) => s.email.toLowerCase() === email)) e.email = 'Someone already uses this email';
  if (!input.roles.length) e.roles = 'Choose at least one role';
  return e;
}

/** Guard: never leave the platform without an active owner. */
export function wouldRemoveLastOwner(staff: readonly StaffMember[], id: string, change: { roles?: StaffRole[]; status?: StaffMember['status'] }): boolean {
  const after = staff.map((s) => (s.id === id ? { ...s, ...change } : s));
  return !after.some((s) => s.status === 'active' && s.roles.includes('owner'));
}
