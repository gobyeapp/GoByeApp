import { describe, expect, it } from 'vitest';
import { createPlatformDataset, permissionsOf } from '@gobye/core';
import { groupPermissions, planRoleChange, validateInvite, wouldRemoveLastOwner } from './logic';

describe('planRoleChange', () => {
  it('holds new sensitive roles for approval when the actor is not the owner', () => {
    expect(planRoleChange(['care'], ['care', 'finance', 'marketing'], false)).toEqual({ applyNow: ['care', 'marketing'], pending: ['finance'] });
  });
  it('applies everything for the owner', () => {
    expect(planRoleChange(['care'], ['developer'], true)).toEqual({ applyNow: ['developer'], pending: [] });
  });
  it('keeps existing sensitive roles without a new approval', () => {
    expect(planRoleChange(['finance'], ['finance', 'care'], false).pending).toEqual([]);
  });
});

describe('groupPermissions', () => {
  it('groups by area', () => {
    const g = groupPermissions(permissionsOf({ roles: ['onboarding'], status: 'active' }));
    expect(g.find(([a]) => a === 'drivers')![1]).toEqual(['contact_details', 'verify', 'view']);
  });
});

describe('validateInvite', () => {
  const staff = createPlatformDataset().staff;
  it('requires name, valid unique email and a role', () => {
    expect(validateInvite({ name: '', email: 'bad', roles: [] }, staff)).toEqual({ name: 'Enter a name', email: 'Enter a valid email address', roles: 'Choose at least one role' });
    expect(validateInvite({ name: 'A', email: 'OWNER@example.test', roles: ['care'] }, staff).email).toBe('Someone already uses this email');
    expect(validateInvite({ name: 'A', email: 'a@example.test', roles: ['care'] }, staff)).toEqual({});
  });
});

describe('wouldRemoveLastOwner', () => {
  const staff = createPlatformDataset().staff;
  it('blocks suspending the only owner', () => {
    expect(wouldRemoveLastOwner(staff, 'stf-owner', { status: 'suspended' })).toBe(true);
    expect(wouldRemoveLastOwner(staff, 'stf-care', { status: 'suspended' })).toBe(false);
  });
});
