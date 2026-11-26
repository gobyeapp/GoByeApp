import {
  CURRENT_CONSENTS,
  isNigerianPhone,
  toE164,
  type AuthService,
  type ConsentDocument,
  type OtpChallenge,
  type Passenger,
  type PhoneStep,
  type Result,
  type Session,
} from '@gobye/core';
import type { AccountsApi, DeviceInfo, MeBody } from './accountsApi';
import type { SbError, SbSession, SbUser, SupabaseAuthLike } from './types';

export interface SupabaseAuthOptions {
  auth: SupabaseAuthLike;
  /** Which app this is: decides the profile created after the phone code. */
  role: 'rider' | 'driver';
  /**
   * The GoBye accounts API. When absent (no API deployed yet), the account lives in Supabase only: the
   * name and city stay in the sign-in account's metadata. Test builds only (D-078).
   */
  accounts?: AccountsApi;
  device?: () => Promise<DeviceInfo | undefined>;
  now?: () => number;
}

/** Seconds before the same phone can get another code (Supabase's default SMS limit is one a minute). */
export const RESEND_AFTER_SECONDS = 60;

type Pending =
  | { kind: 'signup'; phone: string; fullName: string; email: string; city?: 'lagos' | 'abuja'; sentAt: number }
  | { kind: 'signin'; phone: string; sentAt: number | null };

/** Neutral messages from Supabase error codes (D-045: never say whether an account exists). */
export function friendlyAuthError(e: SbError | null | undefined, fallback = 'Something went wrong. Try again.'): string {
  const code = e?.code ?? '';
  if (code === 'invalid_credentials') return 'Those details don’t match an account. Check them and try again.';
  if (code === 'user_already_exists' || code === 'phone_exists' || code === 'email_exists') return 'That phone number or email can’t be used for a new account. Try signing in.';
  if (code === 'weak_password') return 'Choose a stronger password: at least 8 characters, with letters and numbers.';
  if (code === 'otp_expired' || code === 'invalid_otp') return 'That code is wrong or has expired. Request a new one.';
  if (code.startsWith('over_') || e?.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (code === 'sms_send_failed') return 'We couldn’t send a text to that number. Check it and try again.';
  if (code === 'phone_provider_disabled' || code === 'sms_provider_disabled') return 'Phone sign-in isn’t switched on yet.';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Check your details and try again.';
  return fallback;
}

const fail = <T>(error: string): Result<T> => ({ ok: false, error });

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function toPassenger(user: SbUser, fullName: string | null): Passenger {
  const name = splitName(fullName ?? (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''));
  return {
    id: user.id,
    role: 'passenger',
    ...name,
    phone: toE164(user.phone) ?? '',
    email: user.email || (typeof user.user_metadata?.email === 'string' ? user.user_metadata.email : undefined),
    createdAt: Date.parse(user.created_at) || 0,
    rating: 5,
  };
}

/**
 * Real sign-in (Backend Phase 2, WP2) behind the AuthService interface the apps already use:
 * - sign up: phone + password in Supabase (Supabase texts the code), then the profile on our API;
 * - sign in: email or phone + password, then a code to the account's phone (D-045, D-048);
 * - password reset: an emailed code, then a new password;
 * - Apple and Google come later (they need native modules and store accounts).
 */
export function createSupabaseAuthService(o: SupabaseAuthOptions): AuthService {
  const { auth } = o;
  const now = o.now ?? Date.now;
  let pending: Pending | null = null;

  const challenge = (phone: string, sentAt: number): Result<OtpChallenge> => ({
    ok: true,
    value: { phone, resendAfterSeconds: Math.max(0, RESEND_AFTER_SECONDS - Math.floor((now() - sentAt) / 1000)), isSimulated: false },
  });

  /** After the phone code: make sure the GoBye profile exists, then describe the person. */
  async function finish(session: SbSession): Promise<Result<Session>> {
    const signup = pending?.kind === 'signup' ? pending : null;
    const meta = session.user.user_metadata ?? {};
    const fullName = signup?.fullName ?? (typeof meta.full_name === 'string' ? meta.full_name : '');
    const city = signup?.city ?? (meta.city === 'lagos' || meta.city === 'abuja' ? meta.city : undefined);
    let isNewUser = !!signup;

    if (o.accounts) {
      const me = await o.accounts.me();
      if (!me.ok) return fail(me.error.message);
      let body: MeBody = me.value;
      if (!body.signupComplete) {
        if (!fullName) return fail('Finish creating your account: add your name.');
        const consents = (Object.keys(CURRENT_CONSENTS) as ConsentDocument[]).map((d) => ({ document: d, version: CURRENT_CONSENTS[d] }));
        const created = await o.accounts.createProfile(session.user.id, { role: o.role, fullName, city: o.role === 'driver' ? city : undefined, consents, device: await o.device?.() });
        if (!created.ok) return fail(created.error.message);
        body = created.value;
        isNewUser = true;
      }
      pending = null;
      return { ok: true, value: { token: session.access_token, user: toPassenger(session.user, body.fullName), isNewUser } };
    }

    pending = null;
    return { ok: true, value: { token: session.access_token, user: toPassenger(session.user, fullName || null), isNewUser } };
  }

  return {
    async signUp({ fullName, email, phone, password, city }) {
      const e164 = toE164(phone);
      if (!isNigerianPhone(e164)) return fail('Enter a Nigerian mobile number, like 0803 123 4567.');
      const r = await auth.signUp({ phone: e164!, password, options: { data: { full_name: fullName.trim(), email: email.trim().toLowerCase(), ...(city ? { city } : {}) } } });
      if (r.error) return fail(friendlyAuthError(r.error));
      pending = { kind: 'signup', phone: e164!, fullName: fullName.trim(), email: email.trim().toLowerCase(), city, sentAt: now() };
      return { ok: true, value: { phone: e164, isSimulated: false } satisfies PhoneStep };
    },

    async signIn(identifier, password) {
      const id = identifier.trim();
      const r = await auth.signInWithPassword(id.includes('@') ? { email: id.toLowerCase(), password } : { phone: toE164(id) ?? id, password });
      if (r.error || !r.data.user) return fail(friendlyAuthError(r.error, 'Those details don’t match an account. Check them and try again.'));
      const phone = toE164(r.data.user.phone);
      // The password only proves the first step: the session starts after the phone code (D-045, D-048).
      await auth.signOut({ scope: 'local' });
      if (!phone) return fail('This account has no phone number. Contact support.');
      pending = { kind: 'signin', phone, sentAt: null };
      return { ok: true, value: { phone, isSimulated: false } };
    },

    async socialSignIn() {
      return fail('Apple and Google sign-in are coming soon. Use your phone number for now.');
    },

    async requestPasswordReset(email) {
      const r = await auth.resetPasswordForEmail(email.trim().toLowerCase());
      if (r.error && (r.error.status === 429 || r.error.code?.startsWith('over_'))) return fail(friendlyAuthError(r.error));
      return { ok: true, value: { email: email.trim().toLowerCase(), resendAfterSeconds: RESEND_AFTER_SECONDS, isSimulated: false } };
    },

    async resetPassword(email, code, newPassword) {
      const v = await auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
      if (v.error || !v.data.session) return fail(friendlyAuthError(v.error, 'That code is wrong or has expired. Request a new one.'));
      const u = await auth.updateUser({ password: newPassword });
      await auth.signOut({ scope: 'local' });
      if (u.error) return fail(friendlyAuthError(u.error));
      return { ok: true, value: true };
    },

    async requestOtp(phone) {
      const e164 = toE164(phone);
      if (!isNigerianPhone(e164)) return fail('Enter a Nigerian mobile number, like 0803 123 4567.');
      const p = pending && pending.phone === e164 ? pending : null;
      // A code went out less than a minute ago (sign-up sends one itself): don't send another yet.
      if (p?.sentAt && now() - p.sentAt < RESEND_AFTER_SECONDS * 1000) return challenge(e164!, p.sentAt);
      const r = p?.kind === 'signup' ? await auth.resend({ type: 'sms', phone: e164! }) : await auth.signInWithOtp({ phone: e164!, options: { shouldCreateUser: false } });
      if (r.error) return fail(friendlyAuthError(r.error));
      const sentAt = now();
      pending = p ? { ...p, sentAt } : { kind: 'signin', phone: e164!, sentAt };
      return challenge(e164!, sentAt);
    },

    async verifyOtp(phone, code) {
      const e164 = toE164(phone);
      if (!e164) return fail('Enter your phone number first.');
      const v = await auth.verifyOtp({ phone: e164, token: code.trim(), type: 'sms' });
      if (v.error || !v.data.session) return fail(friendlyAuthError(v.error, 'That code is wrong or has expired. Request a new one.'));
      const done = await finish(v.data.session);
      if (done.ok && pending === null && v.data.session.user.email == null) {
        // The email from sign-up becomes the account's email (Supabase sends a confirmation link). Best effort.
        const email = v.data.session.user.user_metadata?.email;
        if (typeof email === 'string' && email) await auth.updateUser({ email }).catch(() => undefined);
      }
      return done;
    },

    async updateProfile(_token, profile, current) {
      const fullName = `${profile.firstName} ${profile.lastName}`.trim();
      if (fullName.length < 2) return fail('Enter your full name.');
      if (o.accounts) {
        const r = await o.accounts.rename(fullName, `rename-${now()}`);
        if (!r.ok) return fail(r.error.message);
      }
      const u = await auth.updateUser({ data: { full_name: fullName }, ...(profile.email && profile.email !== current?.email ? { email: profile.email.trim().toLowerCase() } : {}) });
      if (u.error || !u.data.user) return fail(friendlyAuthError(u.error));
      return { ok: true, value: { ...toPassenger(u.data.user, fullName), photoUri: current?.photoUri } };
    },

    async requestAccountDeletion() {
      if (!o.accounts) return fail('Deleting an account needs the GoBye server, which isn’t connected to this build. Contact support.');
      const r = await o.accounts.requestDeletion(`delete-${now()}`);
      if (!r.ok) return fail(r.error.message);
      await auth.signOut({ scope: 'local' });
      return { ok: true, value: { requestId: r.value.scheduledFor, isSimulated: false } };
    },

    async signOut() {
      pending = null;
      await auth.signOut({ scope: 'local' });
    },
  };
}
