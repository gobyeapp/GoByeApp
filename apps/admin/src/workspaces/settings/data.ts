import { ROLE_LABELS, type StaffMember } from '@gobye/core';

export { ROLE_LABELS };
export type { StaffMember };

/** Shown only if the page renders without a signed in staff member (tests, previews). */
export const TEST_STAFF_FALLBACK: StaffMember = { id: 'none', name: 'Signed out', email: '', roles: [], cities: [], status: 'active' };
