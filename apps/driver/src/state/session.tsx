import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createMockServices, type GoByeServices, type Result } from '@gobye/core';
import { KEYS, clearAll, readJson, readSecret, writeJson, writeSecret } from './storage';

type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

interface StoredSession {
  phone: string | null;
  userId: string | null;
  welcomeSeen: boolean;
}

interface SessionValue {
  status: SessionStatus;
  phone: string | null;
  welcomeSeen: boolean;
  pendingPhone: string | null;
  markWelcomeSeen(): void;
  requestOtp(phone: string): Promise<Result<{ phone: string; resendAfterSeconds: number }>>;
  verifyOtp(code: string): Promise<Result<true>>;
  signOut(): Promise<void>;
  /** Clears everything on this device after a deletion request (the request itself is simulated). */
  deleteLocalData(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Driver sign-in: phone + one-time code (D-008), the same simulated auth service as the rider app.
 * The token lives in the Keychain / Keystore; the phone number in AsyncStorage.
 */
export function SessionProvider({ children, services }: { children: ReactNode; services?: GoByeServices }) {
  const auth = useMemo(() => (services ?? createMockServices()).auth, [services]);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredSession>({ phone: null, userId: null, welcomeSeen: false });
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);

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

  const value = useMemo<SessionValue>(
    () => ({
      status,
      phone: stored.phone,
      welcomeSeen: stored.welcomeSeen,
      pendingPhone,
      markWelcomeSeen: () => persist({ ...stored, welcomeSeen: true }),
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
        persist({ ...stored, phone: pendingPhone, userId: r.value.user.id, welcomeSeen: true });
        return { ok: true, value: true };
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
    }),
    [status, stored, pendingPhone, token, auth, persist],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
