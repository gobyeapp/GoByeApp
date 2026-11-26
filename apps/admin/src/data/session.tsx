import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LIVE, nextStep } from './live';
import { can as canDo, createPlatformDataset, inCityScope, type Actor, type CityId, type Permission, type StaffMember } from '@gobye/core';

/**
 * SIMULATED sign in: pick a test staff account. Real authentication (email + OTP or SSO, session
 * policy, device trust) is a backend dependency (docs/management/01-foundation.md). The session only
 * decides which workspaces and actions the UI offers; the backend must enforce the same permissions.
 */
interface SessionValue {
  staff: StaffMember | null;
  actor: Actor | null;
  can: (p: Permission) => boolean;
  inScope: (city: CityId) => boolean;
  signIn: (id: string) => void;
  signOut: () => void;
  /** Real staff sign-in (D-081): the signed-in staff member from GET /v1/me. */
  setLiveStaff: (staff: StaffMember) => void;
  /** Real sign-in is on and the saved session is still being checked. */
  restoring: boolean;
}

const Ctx = createContext<SessionValue | null>(null);
const KEY = 'gobye.admin.staff';
export const TEST_STAFF = createPlatformDataset().staff;

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children, initialStaffId }: { children: ReactNode; initialStaffId?: string }) {
  const [id, setId] = useState<string | null>(initialStaffId ?? read());
  const [liveStaff, setLiveStaff] = useState<StaffMember | null>(null);
  const [restoring, setRestoring] = useState(!!LIVE);
  const staff = LIVE ? liveStaff : TEST_STAFF.find((s) => s.id === id && s.status === 'active') ?? null;

  // Real sign-in: a saved session that already passed the second step goes straight in.
  useEffect(() => {
    if (!LIVE) return;
    let alive = true;
    (async () => {
      const has = (await LIVE.supabase.auth.getSession()).data.session;
      const r = has ? await nextStep(LIVE) : null;
      if (alive && r?.ok && r.value.step === 'done') setLiveStaff(r.value.staff);
      if (alive) setRestoring(false);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const signIn = useCallback((sid: string) => {
    setId(sid);
    try {
      sessionStorage.setItem(KEY, sid);
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
  }, []);
  const signOut = useCallback(() => {
    setId(null);
    setLiveStaff(null);
    if (LIVE) void LIVE.supabase.auth.signOut();
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<SessionValue>(
    () => ({
      staff,
      actor: staff ? { kind: 'staff', id: staff.id, name: staff.name } : null,
      can: (p) => (staff ? canDo(staff, p) : false),
      inScope: (c) => (staff ? inCityScope(staff, c) : false),
      signIn,
      signOut,
      setLiveStaff,
      restoring,
    }),
    [staff, signIn, signOut, restoring],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/* ---------- Global filters (city, date range) shared by every list and dashboard ---------- */
export type RangeKey = 'today' | '7d' | '30d' | 'all';
interface FilterValue {
  city: CityId | 'all';
  range: RangeKey;
  setCity: (c: CityId | 'all') => void;
  setRange: (r: RangeKey) => void;
}
const FilterCtx = createContext<FilterValue | null>(null);
export function FilterProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<CityId | 'all'>('all');
  const [range, setRange] = useState<RangeKey>('30d');
  const value = useMemo(() => ({ city, range, setCity, setRange }), [city, range]);
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}
export function useFilters() {
  const v = useContext(FilterCtx);
  if (!v) throw new Error('useFilters outside FilterProvider');
  return v;
}
export const RANGE_MS: Record<RangeKey, number> = { today: 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: Number.POSITIVE_INFINITY };

/** Filter helper: city filter + the staff member's own city scope + date range. */
export function useScopedFilter() {
  const { city, range } = useFilters();
  const { inScope } = useSession();
  return useCallback(
    (rowCity: CityId, at: number | undefined, now: number) => (city === 'all' || rowCity === city) && inScope(rowCity) && (at === undefined || now - at <= RANGE_MS[range]),
    [city, range, inScope],
  );
}
