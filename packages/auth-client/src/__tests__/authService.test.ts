import type { ApiResult } from '@gobye/core';
import { createSupabaseAuthService, friendlyAuthError, RESEND_AFTER_SECONDS } from '../authService';
import { chunkedSecureStorage, CHUNK } from '../secureStorage';
import type { AccountsApi, MeBody } from '../accountsApi';
import type { SbSession, SbUser, SupabaseAuthLike } from '../types';

const PHONE = '+2348031234567';
const user = (o: Partial<SbUser> = {}): SbUser => ({ id: 'u-1', phone: '2348031234567', email: null, created_at: '2026-11-26T10:00:00Z', user_metadata: {}, ...o });
const session = (u = user()): SbSession => ({ access_token: 'jwt-1', user: u });

function fakeAuth(over: Partial<SupabaseAuthLike> = {}) {
  const calls: Array<[string, unknown]> = [];
  const rec = <T>(name: string, value: T) => async (arg?: unknown) => { calls.push([name, arg]); return value as never; };
  const auth: SupabaseAuthLike = {
    signUp: rec('signUp', { data: { user: user(), session: null }, error: null }),
    signInWithPassword: rec('signInWithPassword', { data: { user: user(), session: session() }, error: null }),
    signInWithOtp: rec('signInWithOtp', { data: {}, error: null }),
    resend: rec('resend', { data: {}, error: null }),
    verifyOtp: rec('verifyOtp', { data: { user: user(), session: session() }, error: null }),
    resetPasswordForEmail: rec('resetPasswordForEmail', { data: {}, error: null }),
    updateUser: rec('updateUser', { data: { user: user({ user_metadata: { full_name: 'Ada Obi' } }) }, error: null }),
    getSession: rec('getSession', { data: { session: session() }, error: null }),
    signOut: rec('signOut', { error: null }),
    ...over,
  };
  for (const k of Object.keys(over) as (keyof SupabaseAuthLike)[]) {
    const f = over[k] as (a?: unknown) => unknown;
    (auth as unknown as Record<string, unknown>)[k] = async (a?: unknown) => { calls.push([k, a]); return f(a); };
  }
  return { auth, calls, names: () => calls.map((c) => c[0]) };
}

const me = (o: Partial<MeBody> = {}): MeBody => ({ userId: 'u-1', signupComplete: false, status: null, fullName: null, phoneConfirmed: true, rider: false, driver: null, consentsNeeded: [], deletion: null, ...o });
const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value }) as ApiResult<T>;

function fakeAccounts(first: MeBody) {
  const created: unknown[] = [];
  const api: AccountsApi = {
    me: async () => ok(first),
    createProfile: async (_id, body) => { created.push(body); return ok(me({ signupComplete: true, fullName: body.fullName, rider: body.role === 'rider' })); },
    rename: async (fullName) => ok(me({ signupComplete: true, fullName })),
    requestDeletion: async () => ok({ status: 'scheduled' as const, scheduledFor: '2026-12-10T10:00:00Z' }),
  };
  return { api, created };
}

describe('Supabase sign-in (WP2)', () => {
  it('signs up by phone, waits before resending, then creates the profile with the current consents', async () => {
    let t = 1_000_000;
    const f = fakeAuth();
    const acc = fakeAccounts(me());
    const s = createSupabaseAuthService({ auth: f.auth, role: 'rider', accounts: acc.api, now: () => t, device: async () => ({ installId: 'i-1', platform: 'android' }) });

    const up = await s.signUp({ fullName: ' Ada  Obi ', email: 'ADA@x.ng', phone: '0803 123 4567', password: 'secret123' });
    expect(up).toEqual({ ok: true, value: { phone: PHONE, isSimulated: false } });
    expect(f.calls[0]).toEqual(['signUp', { phone: PHONE, password: 'secret123', options: { data: { full_name: 'Ada  Obi', email: 'ada@x.ng' } } }]);

    t += 10_000;
    const otp = await s.requestOtp(PHONE);
    expect(otp.ok && otp.value.resendAfterSeconds).toBe(RESEND_AFTER_SECONDS - 10);
    expect(f.names()).toEqual(['signUp']); // sign-up already sent the code

    t += 60_000;
    await s.requestOtp(PHONE);
    expect(f.names()).toEqual(['signUp', 'resend']);

    const v = await s.verifyOtp(PHONE, ' 123456 ');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toMatchObject({ token: 'jwt-1', isNewUser: true, user: { id: 'u-1', firstName: 'Ada', lastName: 'Obi', phone: PHONE } });
    expect(acc.created[0]).toMatchObject({ role: 'rider', fullName: 'Ada  Obi', device: { installId: 'i-1' }, consents: [{ document: 'terms' }, { document: 'privacy' }] });
  });

  it('sign-in with a password always ends with a phone code (D-045, D-048)', async () => {
    const f = fakeAuth();
    const acc = fakeAccounts(me({ signupComplete: true, fullName: 'Ada Obi', rider: true }));
    const s = createSupabaseAuthService({ auth: f.auth, role: 'rider', accounts: acc.api });
    const r = await s.signIn('Ada@X.ng', 'secret123');
    expect(r).toEqual({ ok: true, value: { phone: PHONE, isSimulated: false } });
    expect(f.calls[0]).toEqual(['signInWithPassword', { email: 'ada@x.ng', password: 'secret123' }]);
    expect(f.calls[1]).toEqual(['signOut', { scope: 'local' }]);
    await s.requestOtp(PHONE);
    expect(f.calls[2]).toEqual(['signInWithOtp', { phone: PHONE, options: { shouldCreateUser: false } }]);
    const v = await s.verifyOtp(PHONE, '123456');
    expect(v.ok && v.value).toMatchObject({ isNewUser: false, user: { firstName: 'Ada', lastName: 'Obi' } });
    expect(acc.created).toHaveLength(0);
  });

  it('keeps error messages neutral', async () => {
    const f = fakeAuth({ signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }) });
    const s = createSupabaseAuthService({ auth: f.auth, role: 'rider' });
    const r = await s.signIn('0803 123 4567', 'nope');
    expect(r).toEqual({ ok: false, error: 'Those details don’t match an account. Check them and try again.' });
    expect(friendlyAuthError({ message: 'x', code: 'phone_exists' })).not.toMatch(/already/i);
    expect(friendlyAuthError({ message: 'x', status: 429 })).toMatch(/Too many/);
    expect(await s.signUp({ fullName: 'A B', email: 'a@b.ng', phone: '+447700900000', password: 'secret123' })).toEqual({ ok: false, error: expect.stringMatching(/Nigerian/) });
  });

  it('works without the API: the name comes from the sign-in account, and deletion is refused', async () => {
    const u = user({ user_metadata: { full_name: 'Bayo Ade', email: 'b@x.ng' } });
    const f = fakeAuth({ verifyOtp: async () => ({ data: { user: u, session: session(u) }, error: null }) });
    const s = createSupabaseAuthService({ auth: f.auth, role: 'driver' });
    const v = await s.verifyOtp(PHONE, '123456');
    expect(v.ok && v.value.user).toMatchObject({ firstName: 'Bayo', lastName: 'Ade', email: 'b@x.ng' });
    expect(f.names()).toContain('updateUser'); // the sign-up email becomes the account email
    expect((await s.requestAccountDeletion('jwt-1')).ok).toBe(false);
  });

  it('resets a password with an emailed code, then signs out', async () => {
    const f = fakeAuth();
    const s = createSupabaseAuthService({ auth: f.auth, role: 'rider' });
    expect((await s.requestPasswordReset(' A@B.ng ')).ok).toBe(true);
    expect(await s.resetPassword('a@b.ng', '654321', 'newsecret1')).toEqual({ ok: true, value: true });
    expect(f.calls.slice(1)).toEqual([
      ['verifyOtp', { email: 'a@b.ng', token: '654321', type: 'recovery' }],
      ['updateUser', { password: 'newsecret1' }],
      ['signOut', { scope: 'local' }],
    ]);
  });

  it('schedules deletion through the API and signs out', async () => {
    const f = fakeAuth();
    const acc = fakeAccounts(me({ signupComplete: true }));
    const s = createSupabaseAuthService({ auth: f.auth, role: 'rider', accounts: acc.api });
    expect(await s.requestAccountDeletion('jwt-1')).toEqual({ ok: true, value: { requestId: '2026-12-10T10:00:00Z', isSimulated: false } });
    expect(f.names()).toEqual(['signOut']);
    expect((await s.socialSignIn('apple')).ok).toBe(false);
  });
});

describe('chunked secure storage', () => {
  it('splits, reads back and cleans up old chunks', async () => {
    const m = new Map<string, string>();
    const store = { getItemAsync: async (k: string) => m.get(k) ?? null, setItemAsync: async (k: string, v: string) => void m.set(k, v), deleteItemAsync: async (k: string) => void m.delete(k) };
    const s = chunkedSecureStorage(store);
    const big = 'x'.repeat(CHUNK * 2 + 5);
    await s.setItem('sb-abc-auth-token', big);
    expect(await s.getItem('sb-abc-auth-token')).toBe(big);
    expect(m.get('sb-abc-auth-token.n')).toBe('3');
    await s.setItem('sb-abc-auth-token', 'small');
    expect(m.has('sb-abc-auth-token.2')).toBe(false);
    expect(await s.getItem('sb-abc-auth-token')).toBe('small');
    await s.removeItem('sb-abc-auth-token');
    expect(m.size).toBe(0);
    expect(await s.getItem('missing')).toBeNull();
  });
});
