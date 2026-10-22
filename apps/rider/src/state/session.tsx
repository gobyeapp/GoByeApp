import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Passenger, Result, SocialProvider } from '@gobye/core';
import { useServices } from './services';
import { KEYS, clearAll, readJson, readSecret, writeJson, writeSecret } from './storage';

type SessionStatus = 'loading' | 'signed_out' | 'needs_profile' | 'signed_in';

interface StoredSession {
  user: Passenger | null;
  onboardingSeen: boolean;
  locationPrimerSeen: boolean;
}

interface SessionValue {
  status: SessionStatus;
  user: Passenger | null;
  onboardingSeen: boolean;
  locationPrimerSeen: boolean;
  pendingPhone: string | null;
  /** Profile from Apple / Google for a new account, applied once the phone is verified. */
  pendingProfile: { firstName: string; lastName: string; email?: string } | null;
  completeOnboarding(): void;
  signUp(details: { fullName: string; email: string; phone: string; password: string }): Promise<Result<true>>;
  signIn(identifier: string, password: string): Promise<Result<true>>;
  /** `next` says where to go: verify the code, or ask for a phone number first (new social account). */
  socialSignIn(provider: SocialProvider): Promise<Result<{ next: 'otp' | 'phone' }>>;
  requestPasswordReset(email: string): Promise<Result<{ email: string; resendAfterSeconds: number }>>;
  resetPassword(email: string, code: string, password: string): Promise<Result<true>>;
  markLocationPrimerSeen(): void;
  requestOtp(phone: string): Promise<Result<{ phone: string; resendAfterSeconds: number }>>;
  verifyOtp(code: string): Promise<Result<{ isNewUser: boolean }>>;
  saveProfile(profile: { firstName: string; lastName: string; email?: string }): Promise<Result<Passenger>>;
  /** Add/replace/remove the profile photo (stored on device in the preview; upload is a backend task). */
  setPhoto(uri: string | null): void;
  signOut(): Promise<void>;
  requestDeletion(): Promise<Result<{ requestId: string }>>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices();
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredSession>({ user: null, onboardingSeen: false, locationPrimerSeen: false });
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<SessionValue['pendingProfile']>(null);

  useEffect(() => {
    (async () => {
      const [t, s] = await Promise.all([readSecret(KEYS.token), readJson<StoredSession>(KEYS.session)]);
      setToken(t);
      if (s) setStored(s);
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback((next: StoredSession) => {
    setStored(next);
    void writeJson(KEYS.session, next);
  }, []);

  const status: SessionStatus = !loaded
    ? 'loading'
    : !token || !stored.user
      ? 'signed_out'
      : !stored.user.firstName
        ? 'needs_profile'
        : 'signed_in';

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user: stored.user,
      onboardingSeen: stored.onboardingSeen,
      locationPrimerSeen: stored.locationPrimerSeen,
      pendingPhone,
      pendingProfile,
      completeOnboarding: () => persist({ ...stored, onboardingSeen: true }),
      markLocationPrimerSeen: () => persist({ ...stored, locationPrimerSeen: true }),
      async signUp(details) {
        const r = await auth.signUp(details);
        if (!r.ok) return r;
        setPendingProfile(null);
        const o = await auth.requestOtp(r.value.phone!);
        if (!o.ok) return o;
        setPendingPhone(o.value.phone);
        return { ok: true, value: true };
      },
      async signIn(identifier, password) {
        const r = await auth.signIn(identifier, password);
        if (!r.ok) return r;
        setPendingProfile(null);
        const o = await auth.requestOtp(r.value.phone!);
        if (!o.ok) return o;
        setPendingPhone(o.value.phone);
        return { ok: true, value: true };
      },
      async socialSignIn(provider) {
        const r = await auth.socialSignIn(provider);
        if (!r.ok) return r;
        if (!r.value.phone) {
          setPendingProfile(r.value.profile ?? null);
          return { ok: true, value: { next: 'phone' } };
        }
        setPendingProfile(null);
        const o = await auth.requestOtp(r.value.phone);
        if (!o.ok) return o;
        setPendingPhone(o.value.phone);
        return { ok: true, value: { next: 'otp' } };
      },
      requestPasswordReset: (email) => auth.requestPasswordReset(email),
      resetPassword: (email, code, password) => auth.resetPassword(email, code, password),
      async requestOtp(phone) {
        const r = await auth.requestOtp(phone);
        if (r.ok) setPendingPhone(r.value.phone);
        return r.ok ? { ok: true, value: { phone: r.value.phone, resendAfterSeconds: r.value.resendAfterSeconds } } : r;
      },
      async verifyOtp(code) {
        if (!pendingPhone) return { ok: false, error: 'Enter your phone number first.' };
        const r = await auth.verifyOtp(pendingPhone, code);
        if (!r.ok) return r;
        await writeSecret(KEYS.token, r.value.token);
        setToken(r.value.token);
        // New Apple / Google account: save the provider's name and email onto the verified user.
        if (pendingProfile && !r.value.user.firstName) {
          const p = await auth.updateProfile(r.value.token, pendingProfile, r.value.user);
          setPendingProfile(null);
          if (p.ok) {
            persist({ ...stored, onboardingSeen: true, user: p.value });
            return { ok: true, value: { isNewUser: false } };
          }
        }
        persist({ ...stored, onboardingSeen: true, user: r.value.user });
        return { ok: true, value: { isNewUser: r.value.isNewUser } };
      },
      async saveProfile(profile) {
        if (!token) return { ok: false, error: 'Session expired. Sign in again.' };
        const r = await auth.updateProfile(token, profile, stored.user ?? undefined);
        // Keep the local photo when the profile service returns the user.
        if (r.ok) persist({ ...stored, user: { ...r.value, photoUri: stored.user?.photoUri } });
        return r;
      },
      setPhoto(uri) {
        if (!stored.user) return;
        persist({ ...stored, user: { ...stored.user, photoUri: uri ?? undefined } });
      },
      async signOut() {
        if (token) await auth.signOut(token);
        await writeSecret(KEYS.token, null);
        setToken(null);
        persist({ ...stored, user: null });
      },
      async requestDeletion() {
        if (!token) return { ok: false, error: 'Session expired. Sign in again.' };
        const r = await auth.requestAccountDeletion(token);
        if (!r.ok) return r;
        await clearAll();
        setToken(null);
        setStored({ user: null, onboardingSeen: true, locationPrimerSeen: false });
        return { ok: true, value: { requestId: r.value.requestId } };
      },
    }),
    [status, stored, pendingPhone, pendingProfile, token, auth, persist],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
