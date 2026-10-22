import type { Relay } from './client';

/**
 * Connection state for the "Demo connection" pill: every relay call records whether it reached the
 * relay. `offline` means the last call failed (wrong address, relay stopped, phone on another network).
 */
export type RelayConnection = 'off' | 'connecting' | 'online' | 'offline';

export interface RelayStatus {
  get(): { state: RelayConnection; host: string | null; lastOkAt: number | null; error: string | null };
  subscribe(fn: () => void): () => void;
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/** Wrap a relay so each call updates a shared status (null relay → "off": the app runs on its own). */
export function withRelayStatus(relay: Relay | null): { relay: Relay | null; status: RelayStatus } {
  let snap: ReturnType<RelayStatus['get']> = { state: relay ? 'connecting' : 'off', host: relay ? hostOf(relay.url) : null, lastOkAt: null, error: null };
  const subs = new Set<() => void>();
  const set = (next: Partial<typeof snap>) => {
    const merged = { ...snap, ...next };
    if (merged.state === snap.state && merged.error === snap.error && merged.lastOkAt === snap.lastOkAt) return;
    snap = merged;
    subs.forEach((f) => f());
  };
  const status: RelayStatus = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
  if (!relay) return { relay: null, status };
  const track =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        const r = await fn(...a);
        // Throttle "last ok" updates to whole seconds so polling doesn't re-render every call.
        const t = Math.floor(Date.now() / 5000) * 5000;
        set({ state: 'online', error: null, lastOkAt: t });
        return r;
      } catch (e) {
        set({ state: 'offline', error: e instanceof Error ? e.message : 'Relay error' });
        throw e;
      }
    };
  const wrapped: Relay = {
    url: relay.url,
    select: track(relay.select.bind(relay)) as Relay['select'],
    insert: track(relay.insert.bind(relay)) as Relay['insert'],
    upsert: track(relay.upsert.bind(relay)) as Relay['upsert'],
    update: track(relay.update.bind(relay)) as Relay['update'],
  };
  return { relay: wrapped, status };
}
