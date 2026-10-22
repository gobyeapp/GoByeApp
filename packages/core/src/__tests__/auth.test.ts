import { createMockServices, type MockAccount } from '../mocks/services';
import { OTHER_NIGERIAN_STATES, parseIdentifier, passwordChecks, passwordStrength, searchStates, validateFullName, validatePassword } from '../validation';

const fast = () => createMockServices({ flags: { latency: [0, 0] } });

describe('auth rules', () => {
  it('requires 8+ character passwords with a letter and a number', () => {
    expect(validatePassword('gobye2026').ok).toBe(true);
    expect(validatePassword('short1').ok).toBe(false);
    expect(validatePassword('lettersonly').ok).toBe(false);
    expect(validatePassword('12345678').ok).toBe(false);
  });

  it('splits a full name and asks for both parts', () => {
    expect(validateFullName('  Ada   Okafor ')).toEqual({ ok: true, value: { firstName: 'Ada', lastName: 'Okafor' } });
    expect(validateFullName('Ada Chioma Okafor')).toEqual({ ok: true, value: { firstName: 'Ada', lastName: 'Chioma Okafor' } });
    expect(validateFullName('Ada').ok).toBe(false);
  });

  it('accepts an email or a Nigerian number to sign in', () => {
    expect(parseIdentifier('Ada@Example.com')).toEqual({ ok: true, value: { kind: 'email', value: 'ada@example.com' } });
    expect(parseIdentifier('0803 123 4567')).toEqual({ ok: true, value: { kind: 'phone', value: '+2348031234567' } });
    expect(parseIdentifier('ada@').ok).toBe(false);
    expect(parseIdentifier('').ok).toBe(false);
  });
});

describe('sign-up journey helpers', () => {
  it('rates password strength as the rider types', () => {
    expect(passwordStrength('')).toBe('empty');
    expect(passwordStrength('gobye')).toBe('weak');
    expect(passwordStrength('gobye2026')).toBe('okay');
    expect(passwordStrength('Gobye2026')).toBe('strong');
    expect(passwordStrength('gobye2026rides')).toBe('strong');
  });

  it('searches states by name or city, best matches first', () => {
    expect(searchStates('')).toHaveLength(35);
    expect(searchStates('  ')).toHaveLength(35);
    expect(searchStates('ka').map((m) => m.state).slice(0, 3)).toEqual(['Kaduna', 'Kano', 'Katsina']);
    expect(searchStates('ka')).toContainEqual({ state: 'Anambra', city: 'Awka' });
    expect(searchStates('crossriver')).toEqual([{ state: 'Cross River' }]);
    expect(searchStates('ibadan')).toEqual([{ state: 'Oyo', city: 'Ibadan' }]);
    expect(searchStates('port har')).toEqual([{ state: 'Rivers', city: 'Port Harcourt' }]);
    expect(searchStates('ado ekiti')).toEqual([{ state: 'Ekiti', city: 'Ado-Ekiti' }]);
    expect(searchStates('lagos')).toEqual([]);
    // State names that start with the query come before ones that only contain it.
    expect(searchStates('o').map((m) => m.state).slice(0, 5)).toEqual(['Ogun', 'Ondo', 'Osun', 'Oyo', 'Akwa Ibom']);
  });

  it('turns the password rule into a live checklist', () => {
    expect(passwordChecks('').every((c) => !c.met)).toBe(true);
    expect(passwordChecks('gobye').map((c) => c.met)).toEqual([false, true, false]);
    expect(passwordChecks('gobye2026').every((c) => c.met)).toBe(true);
    expect(passwordChecks('12345678').map((c) => c.met)).toEqual([true, false, true]);
  });

  it('lists the 35 other states, without Lagos or the FCT', () => {
    expect(OTHER_NIGERIAN_STATES).toHaveLength(35);
    expect(OTHER_NIGERIAN_STATES).not.toContain('Lagos');
  });
});

describe('mock auth flows', () => {
  const details = { fullName: 'Ada Okafor', email: 'ada@example.com', phone: '0803 123 4567', password: 'gobye2026' };

  it('signs up, verifies the phone and keeps the profile', async () => {
    const s = fast();
    const r = await s.auth.signUp(details);
    expect(r.ok && r.value.phone).toBe('+2348031234567');
    const v = await s.auth.verifyOtp('+2348031234567', '123456');
    expect(v.ok && v.value.user.firstName).toBe('Ada');
    expect(v.ok && v.value.isNewUser).toBe(false);
    expect((await s.auth.signUp(details)).ok).toBe(false); // duplicate email
  });

  it('signs in with email or phone, with one message for any wrong detail', async () => {
    const s = fast();
    await s.auth.signUp(details);
    expect((await s.auth.signIn('ADA@example.com', 'gobye2026')).ok).toBe(true);
    expect((await s.auth.signIn('08031234567', 'gobye2026')).ok).toBe(true);
    const wrong = await s.auth.signIn('ada@example.com', 'nope12345');
    const unknown = await s.auth.signIn('who@example.com', 'gobye2026');
    expect(!wrong.ok && !unknown.ok && wrong.error === unknown.error).toBe(true);
  });

  it('resets a password with a code', async () => {
    const s = fast();
    await s.auth.signUp(details);
    expect((await s.auth.requestPasswordReset('ada@example.com')).ok).toBe(true);
    expect((await s.auth.requestPasswordReset('nobody@example.com')).ok).toBe(true); // no enumeration
    expect((await s.auth.resetPassword('ada@example.com', '000000', 'newpass99')).ok).toBe(false);
    expect((await s.auth.resetPassword('ada@example.com', '123456', 'weak')).ok).toBe(false);
    expect((await s.auth.resetPassword('ada@example.com', '123456', 'newpass99')).ok).toBe(true);
    expect((await s.auth.signIn('ada@example.com', 'gobye2026')).ok).toBe(false);
    expect((await s.auth.signIn('ada@example.com', 'newpass99')).ok).toBe(true);
  });

  it('asks a new social account for a phone, then recognises it next time', async () => {
    const s = fast();
    const first = await s.auth.socialSignIn('google');
    expect(first.ok && first.value.phone).toBeNull();
    expect(first.ok && first.value.profile?.firstName).toBe('Ada');
    const v = await s.auth.verifyOtp('+2348091112222', '123456');
    if (!v.ok || !first.ok || !first.value.profile) throw new Error('verify');
    await s.auth.updateProfile(v.value.token, first.value.profile);
    const again = await s.auth.socialSignIn('google');
    expect(again.ok && again.value.phone).toBe('+2348091112222');
    expect((await s.auth.signIn('ada.okafor@example.com', '')).ok).toBe(false); // no password on a Google account
  });

  it('restores accounts from the store after a restart', async () => {
    let saved: MockAccount[] = [];
    const store = { load: async () => saved, save: (l: MockAccount[]) => { saved = l; } };
    const a = createMockServices({ flags: { latency: [0, 0] }, authStore: store });
    await a.auth.signUp(details);
    expect(saved).toHaveLength(1);
    const b = createMockServices({ flags: { latency: [0, 0] }, authStore: store });
    await new Promise<void>((r) => setTimeout(() => r(), 0));
    expect((await b.auth.signIn('ada@example.com', 'gobye2026')).ok).toBe(true);
  });
});
