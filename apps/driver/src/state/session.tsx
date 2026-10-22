import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { assertMocksAllowed, createMockServices, type GoByeServices, type MockAccount, type Result, type SocialProvider } from '@gobye/core';
import { publicConfig } from './publicConfig';
import { KEYS, clearAll, readJson, readSecret, writeJson, writeSecret } from './storage';

type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

/** What the driver told us while creating the account; it prefills registration (About you). */
export interface DriverProfile {
  firstName: string;
  lastName: string;
  email?: string;
  city?: 'Lagos' | 'Abuja';
}

interface StoredSession {
  phone: string | null;
  userId: string | null;
  welcomeSeen: boolean;
  profile?: DriverProfile | null;
  createdAt?: number;
}

interface SessionValue {
  status: SessionStatus;
  phone: string | null;
  welcomeSeen: boolean;
  /** Set after a new account is verified (sign up or a new Apple / Google account). */
  profile: DriverProfile | null;
  createdAt: number | null;
  pendingPhone: string | null;
  markWelcomeSeen(): void;
  signUp(details: { fullName: string; email: string; phone: string; password: string; city: 'Lagos' | 'Abuja' }): Promise<Result<true>>;
  signIn(identifier: string, password: string): Promise<Result<true>>;
  /** `next`: verify the code, or ask for a phone number first (new Apple / Google account). */
  socialSignIn(provider: SocialProvider): Promise<Result<{ next: 'otp' | 'phone' }>>;
  requestPasswordReset(email: string): Promise<Result<{ email: string; resendAfterSeconds: number }>>;
  resetPassword(email: string, code: string, password: string): Promise<Result<true>>;
  requestOtp(phone: string): Promise<Result<{ phone: string; resendAfterSeconds: number }>>;
  /** `isNew`: a brand-new account (ends on the driver pass, then registration). */
  verifyOtp(code: string): Promise<Result<{ isNew: boolean }>>;
  signOut(): Promise<void>;
  /** Clears everything on this device after a deletion request (the request itself is simulated). */
  deleteLocalData(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const authStore = {
  load: () => readJson<MockAccount[]>(KEYS.mockAccounts),
  save: (list: MockAccount[]) => void writeJson(KEYS.mockAccounts, list),
};

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/**
 * Driver accounts, the same way as the rider app: create an account (name, city, email + phone,
 * password) or sign in with email / phone + password, or Apple / Google, then a code to the phone.
 * The token lives in the Keychain / Keystore; the rest in AsyncStorage. All simulated in this preview.
 */
export function SessionProvider({ children, services }: { children: ReactNode; services?: GoByeServices }) {
  const auth = useMemo(() => {
    if (services) return services.auth;
    // Simulated services refuse to start in a production build (D-051).
    assertMocksAllowed(publicConfig);
    return createMockServices({ authStore }).auth;
  }, [services]);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredSession>({ phone: null, userId: null, welcomeSeen: false });
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  /** A new account's details, applied once its phone is verified. */
  const [pendingProfile, setPendingProfile] = useState<DriverProfile | null>(null);

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

  const status: SessionStatus = !loaded ? 'loading' : token && stored.phone ? 'signed_in' : 'signed_out';

  const value = useMemo<SessionValue>(() => {
    const sendCode = async (phone: string): Promise<Result<true>> => {
      const o = await auth.requestOtp(phone);
      if (!o.ok) return o;
      setPendingPhone(o.value.phone);
      return { ok: true, value: true };
    };
    return {
      status,
      phone: stored.phone,
      welcomeSeen: stored.welcomeSeen,
      profile: stored.profile ?? null,
      createdAt: stored.createdAt ?? null,
      pendingPhone,
      markWelcomeSeen: () => persist({ ...stored, welcomeSeen: true }),
      async signUp({ city, ...details }) {
        const r = await auth.signUp(details);
        if (!r.ok) return r;
        setPendingProfile({ ...splitName(details.fullName), email: details.email.trim(), city });
        return sendCode(r.value.phone!);
      },
      async signIn(identifier, password) {
        const r = await auth.signIn(identifier, password);
        if (!r.ok) return r;
        setPendingProfile(null);
        return sendCode(r.value.phone!);
      },
      async socialSignIn(provider) {
        const r = await auth.socialSignIn(provider);
        if (!r.ok) return r;
        if (!r.value.phone) {
          setPendingProfile(r.value.profile ?? null);
          return { ok: true, value: { next: 'phone' } };
        }
        setPendingProfile(null);
        const o = await sendCode(r.value.phone);
        return o.ok ? { ok: true, value: { next: 'otp' } } : o;
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
        const isNew = !!pendingProfile || r.value.isNewUser;
        persist({
          ...stored,
          phone: pendingPhone,
          userId: r.value.user.id,
          welcomeSeen: true,
          profile: pendingProfile ?? (isNew ? null : stored.profile ?? null),
          createdAt: isNew ? Date.now() : stored.createdAt ?? Date.now(),
        });
        setPendingProfile(null);
        return { ok: true, value: { isNew } };
      },
      async signOut() {
        if (token) await auth.signOut(token);
        await writeSecret(KEYS.token, null);
        setToken(null);
        persist({ ...stored, phone: null, userId: null });
      },
      async deleteLocalData() {
        await clearAll();
        setToken(null);
        setStored({ phone: null, userId: null, welcomeSeen: true });
      },
    };
  }, [status, stored, pendingPhone, pendingProfile, token, auth, persist]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
