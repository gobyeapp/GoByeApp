import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
  const staff = TEST_STAFF.find((s) => s.id === id && s.status === 'active') ?? null;
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
    }),
    [staff, signIn, signOut],
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
