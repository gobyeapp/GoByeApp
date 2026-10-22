import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPlatformDataset, type Actor, type AuditEvent, type PlatformDataset } from '@gobye/core';

/**
 * Prototype data layer. Every workspace reads ONE shared dataset (shared record ids) through this
 * provider and changes it only through `mutate`, which:
 *  - simulates network latency (and, when switched on, failures) so loading/pending/error states are real,
 *  - applies the change to a copy and keeps the old data if the change is refused,
 *  - appends an audit event for every successful change.
 * When the backend exists, `mutate` calls are replaced by API calls with the same inputs (see
 * docs/management/README.md §Backend contract). Nothing here talks to a server.
 */

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface MutationSpec {
  /** Short human label for toasts and logs, e.g. "Approve refund". */
  label: string;
  apply: (draft: PlatformDataset, ctx: { now: number; actor: Actor }) => MutationResult;
  /** Audit entry (actor and time are filled in). Omit only for pure UI preferences. */
  audit?: (draft: PlatformDataset) => Omit<AuditEvent, 'id' | 'at' | 'actor'>;
  /** Milliseconds of simulated latency (default 650). */
  latency?: number;
}

interface PlatformValue {
  data: PlatformDataset | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  reset: () => void;
  mutate: (spec: MutationSpec) => Promise<MutationResult>;
  /** The prototype clock: the dataset's "now" plus time since it loaded. */
  now: () => number;
  simulateFailures: boolean;
  setSimulateFailures: (v: boolean) => void;
}

const Ctx = createContext<PlatformValue | null>(null);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PlatformProvider({ children, actor, initial }: { children: ReactNode; actor: Actor | null; initial?: PlatformDataset }) {
  const [data, setData] = useState<PlatformDataset | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [simulateFailures, setSimulateFailures] = useState(false);
  const loadedAt = useRef(Date.now());
  const dataRef = useRef(data);
  dataRef.current = data;
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const failRef = useRef(simulateFailures);
  failRef.current = simulateFailures;

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setError(null);
    await wait(700);
    if (failRef.current) {
      setError('The server didn’t respond (simulated failure).');
      setLoading(false);
      return;
    }
    if (fresh || !dataRef.current) {
      const d = createPlatformDataset();
      loadedAt.current = Date.now();
      setData(d);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!initial) void load(true);
  }, [initial, load]);

  const now = useCallback(() => (dataRef.current?.generatedAt ?? Date.now()) + (Date.now() - loadedAt.current), []);

  const mutate = useCallback(async (spec: MutationSpec): Promise<MutationResult> => {
    const current = dataRef.current;
    const who = actorRef.current;
    if (!current || !who) return { ok: false, error: 'Not signed in' };
    await wait(spec.latency ?? 650);
    if (failRef.current) return { ok: false, error: 'Couldn’t save. Nothing was changed (simulated failure). Try again.' };
    const draft = structuredClone(dataRef.current ?? current);
    const at = now();
    const res = spec.apply(draft, { now: at, actor: who });
    if (!res.ok) return res;
    if (spec.audit) {
      const a = spec.audit(draft);
      draft.audit = [{ ...a, id: `aud-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at, actor: who }, ...draft.audit];
    }
    dataRef.current = draft;
    setData(draft);
    return { ok: true };
  }, [now]);

  const value = useMemo<PlatformValue>(
    () => ({ data, loading, error, reload: () => void load(false), reset: () => void load(true), mutate, now, simulateFailures, setSimulateFailures }),
    [data, loading, error, load, mutate, now, simulateFailures],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatform() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatform outside PlatformProvider');
  return v;
}

/** Dataset for screens that render only once loaded (the shell shows loading and error states). */
export function useData(): PlatformDataset {
  const { data } = usePlatform();
  if (!data) throw new Error('useData before data loaded');
  return data;
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const show = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/**
 * Run a mutation and report the outcome: a toast on success, the error text on failure.
 * Returns the result so callers can close drawers only on success.
 */
export function useAction() {
  const { mutate } = usePlatform();
  const toast = useToast();
  return useCallback(
    async (spec: MutationSpec, success?: string): Promise<MutationResult> => {
      const r = await mutate(spec);
      toast(r.ok ? (success ?? `${spec.label}: done`) : r.error);
      return r;
    },
    [mutate, toast],
  );
}
