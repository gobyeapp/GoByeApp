import { backoffDelay } from './http';
import type { Logger } from './observability';

/**
 * Provider-agnostic realtime client (D-051, brief §11). Trip events, driver location, incoming
 * requests, offers and counters arrive on channels. The server authorises every subscription (the
 * client only asks); trip state always lives in the backend, so after any gap the client re-reads it.
 * Status: implemented and tested locally with a mock transport. No realtime provider is selected.
 *
 * Reliability: reconnect with full-jitter exponential backoff (capped), fresh short-lived credentials
 * on every connect, pause in the background and when offline, events ordered by per-channel `seq`,
 * duplicates dropped, gaps recovered by `resync` (authoritative REST read), unknown versions refused.
 */

export type RealtimeState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline' | 'closed';

export interface RealtimeEnvelope<T = unknown> {
  channel: string;
  /** Per-channel sequence number assigned by the server, starting at 1. */
  seq: number;
  type: string;
  /** Schema version of `data`. */
  version: number;
  at: number;
  data: T;
}

export type ClientFrame =
  | { op: 'auth'; token: string }
  | { op: 'subscribe'; channel: string; sinceSeq?: number }
  | { op: 'unsubscribe'; channel: string }
  | { op: 'ping' };

export type ServerFrame =
  | { op: 'event'; event: RealtimeEnvelope }
  | { op: 'subscribed'; channel: string; seq: number }
  | { op: 'denied'; channel: string; reason: string }
  | { op: 'auth_expired' }
  | { op: 'pong' };

export interface TransportHandlers {
  onOpen(): void;
  onMessage(frame: ServerFrame): void;
  onClose(reason: string): void;
}

/** WebSocket today; anything that can carry frames tomorrow (SSE + POST, a provider SDK). */
export interface RealtimeTransport {
  connect(url: string, handlers: TransportHandlers): void;
  send(frame: ClientFrame): void;
  close(): void;
}

export interface RealtimeCredentials {
  url: string;
  /** Short-lived token scoped to this user; fetched again on every (re)connect. */
  token: string;
}

export interface ChannelHandlers<T = unknown> {
  onEvent(event: RealtimeEnvelope<T>): void;
  /** The server refused the subscription (not a participant of this trip, etc.). */
  onDenied?(reason: string): void;
  /** Called with the authoritative state after a gap / reconnect (from `resync`). */
  onResync?(state: unknown): void;
  /** Schema check; return false to drop the event. */
  validate?(event: RealtimeEnvelope): boolean;
}

export interface RealtimeClientOptions {
  transport: RealtimeTransport;
  getCredentials: () => Promise<RealtimeCredentials>;
  /**
   * Authoritative recovery: read the channel's current state from the API (e.g. GET /v1/rides/:id)
   * and return the seq it corresponds to. Called after gaps, reconnects and unsupported versions.
   */
  resync: (channel: string, lastSeq: number | undefined) => Promise<{ seq: number; state?: unknown }>;
  logger?: Logger;
  random?: () => number;
  /** Highest event schema version this build understands. */
  supportedVersion?: number;
  /** How long to wait for a missing event before resyncing. */
  gapWaitMs?: number;
  maxBackoffMs?: number;
}

export interface RealtimeClient {
  readonly state: RealtimeState;
  connect(): void;
  close(): void;
  subscribe<T = unknown>(channel: string, handlers: ChannelHandlers<T>): () => void;
  setNetworkAvailable(online: boolean): void;
  setAppActive(active: boolean): void;
  onStateChange(fn: (s: RealtimeState) => void): () => void;
}

interface Sub {
  handlers: ChannelHandlers;
  lastSeq?: number;
  buffer: Map<number, RealtimeEnvelope>;
  gapTimer?: ReturnType<typeof setTimeout>;
  resyncing?: boolean;
}

export function createRealtimeClient(opts: RealtimeClientOptions): RealtimeClient {
  const random = opts.random ?? Math.random;
  const supported = opts.supportedVersion ?? 1;
  const gapWait = opts.gapWaitMs ?? 1_500;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const subs = new Map<string, Sub>();
  const listeners = new Set<(s: RealtimeState) => void>();
  let state: RealtimeState = 'idle';
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let networkUp = true;
  let appActive = true;
  let wanted = false;
  let connectionId = 0;
  let live = false;

  const setState = (s: RealtimeState) => {
    if (s === state) return;
    state = s;
    opts.logger?.log('info', 'realtime.state', { state: s });
    listeners.forEach((f) => f(s));
  };

  const send = (f: ClientFrame) => {
    if (live) opts.transport.send(f);
  };

  async function recover(channel: string, sub: Sub, reason: string) {
    if (sub.resyncing) return;
    sub.resyncing = true;
    clearTimeout(sub.gapTimer);
    sub.gapTimer = undefined;
    opts.logger?.log('info', 'realtime.resync', { channel, reason, lastSeq: sub.lastSeq });
    try {
      const r = await opts.resync(channel, sub.lastSeq);
      if (subs.get(channel) !== sub) return;
      sub.lastSeq = r.seq;
      sub.handlers.onResync?.(r.state);
      // Deliver what we buffered beyond the authoritative point, in order.
      const later = [...sub.buffer.keys()].filter((s) => s > r.seq).sort((a, b) => a - b);
      const keep = new Map(later.map((s) => [s, sub.buffer.get(s)!] as const));
      sub.buffer = keep;
      flush(sub);
    } catch {
      opts.logger?.log('warn', 'realtime.resync_failed', { channel, outcome: 'failure' });
    } finally {
      sub.resyncing = false;
    }
  }

  function flush(sub: Sub) {
    while (sub.lastSeq !== undefined && sub.buffer.has(sub.lastSeq + 1)) {
      const e = sub.buffer.get(sub.lastSeq + 1)!;
      sub.buffer.delete(e.seq);
      sub.lastSeq = e.seq;
      sub.handlers.onEvent(e);
    }
  }

  function onEvent(e: RealtimeEnvelope) {
    const sub = subs.get(e.channel);
    if (!sub) return;
    if (typeof e.seq !== 'number' || typeof e.type !== 'string') return void opts.logger?.log('warn', 'realtime.malformed', { channel: e.channel });
    if (e.version > supported) {
      opts.logger?.log('warn', 'realtime.unsupported_version', { channel: e.channel, version: e.version });
      // Can't read it: skip past it via the authoritative state.
      sub.buffer.set(e.seq, e);
      void recover(e.channel, sub, 'unsupported_version');
      return;
    }
    if (sub.handlers.validate && !sub.handlers.validate(e)) return void opts.logger?.log('warn', 'realtime.invalid_event', { channel: e.channel, type: e.type });
    if (sub.lastSeq === undefined) sub.lastSeq = e.seq - 1;
    if (e.seq <= sub.lastSeq || sub.buffer.has(e.seq)) return; // duplicate
    sub.buffer.set(e.seq, e);
    flush(sub);
    if (sub.buffer.size && !sub.gapTimer && !sub.resyncing) {
      sub.gapTimer = setTimeout(() => {
        sub.gapTimer = undefined;
        if (sub.buffer.size) void recover(e.channel, sub, 'gap');
      }, gapWait);
    } else if (!sub.buffer.size && sub.gapTimer) {
      clearTimeout(sub.gapTimer);
      sub.gapTimer = undefined;
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (!wanted || !networkUp || !appActive) return;
    setState('reconnecting');
    const delay = Math.min(maxBackoff, backoffDelay(attempt, random, 500, maxBackoff));
    attempt += 1;
    reconnectTimer = setTimeout(open, delay);
  }

  async function open() {
    if (!wanted || !networkUp || !appActive) return;
    const id = ++connectionId;
    setState(attempt === 0 && state !== 'reconnecting' ? 'connecting' : 'reconnecting');
    let creds: RealtimeCredentials;
    try {
      creds = await opts.getCredentials();
    } catch {
      if (id === connectionId) scheduleReconnect();
      return;
    }
    if (id !== connectionId || !wanted) return;
    opts.transport.connect(creds.url, {
      onOpen: () => {
        if (id !== connectionId) return;
        live = true;
        attempt = 0;
        setState('open');
        send({ op: 'auth', token: creds.token });
        for (const [channel, sub] of subs) send({ op: 'subscribe', channel, sinceSeq: sub.lastSeq });
      },
      onMessage: (f) => {
        if (id !== connectionId) return;
        if (f.op === 'event') onEvent(f.event);
        else if (f.op === 'subscribed') {
          const sub = subs.get(f.channel);
          // Server is ahead of us (missed events while away): recover authoritatively.
          if (sub && sub.lastSeq !== undefined && f.seq > sub.lastSeq && !sub.buffer.size) void recover(f.channel, sub, 'behind_on_subscribe');
          else if (sub && sub.lastSeq === undefined) sub.lastSeq = f.seq;
        } else if (f.op === 'denied') {
          const sub = subs.get(f.channel);
          subs.delete(f.channel);
          sub?.handlers.onDenied?.(f.reason);
        } else if (f.op === 'auth_expired') {
          // Reconnect with fresh credentials.
          live = false;
          opts.transport.close();
          scheduleReconnect();
        }
      },
      onClose: (reason) => {
        if (id !== connectionId) return;
        live = false;
        opts.logger?.log('info', 'realtime.closed', { reason });
        if (!wanted) return setState('closed');
        if (!networkUp) return setState('offline');
        if (!appActive) return setState('idle');
        scheduleReconnect();
      },
    });
  }

  function pause(to: RealtimeState) {
    clearTimeout(reconnectTimer);
    connectionId++;
    if (live) opts.transport.close();
    live = false;
    setState(to);
  }

  function resume() {
    if (!wanted || !networkUp || !appActive) return;
    attempt = 0;
    void open();
    // Anything could have happened while we were away: re-read each channel's state.
    for (const [channel, sub] of subs) void recover(channel, sub, 'resume');
  }

  return {
    get state() {
      return state;
    },
    connect() {
      wanted = true;
      if (state === 'open' || state === 'connecting') return;
      attempt = 0;
      if (!networkUp) return setState('offline');
      if (!appActive) return setState('idle');
      void open();
    },
    close() {
      wanted = false;
      pause('closed');
    },
    subscribe(channel, handlers) {
      const sub: Sub = { handlers: handlers as ChannelHandlers, buffer: new Map() };
      subs.set(channel, sub);
      send({ op: 'subscribe', channel });
      return () => {
        if (subs.get(channel) !== sub) return;
        clearTimeout(sub.gapTimer);
        subs.delete(channel);
        send({ op: 'unsubscribe', channel });
      };
    },
    setNetworkAvailable(online) {
      if (online === networkUp) return;
      networkUp = online;
      if (!online) pause('offline');
      else resume();
    },
    setAppActive(active) {
      if (active === appActive) return;
      appActive = active;
      if (!active) pause('idle');
      else resume();
    },
    onStateChange(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/* ---------- Mock transport (tests and local simulation) ---------- */

export interface MockTransport extends RealtimeTransport {
  /** Frames the client sent. */
  sent: ClientFrame[];
  /** URLs of every connect attempt. */
  connects: string[];
  readonly connected: boolean;
  /** Make the next n connects fail (closed before open). */
  failNext(n: number): void;
  emit(frame: ServerFrame): void;
  event(channel: string, seq: number, data?: unknown, extra?: Partial<RealtimeEnvelope>): void;
  /** Drop the connection from the server side. */
  disconnect(reason?: string): void;
}

export function createMockTransport(): MockTransport {
  let handlers: TransportHandlers | null = null;
  let failing = 0;
  let connected = false;
  const t: MockTransport = {
    sent: [],
    connects: [],
    get connected() {
      return connected;
    },
    failNext: (n) => void (failing = n),
    connect(url, h) {
      t.connects.push(url);
      handlers = h;
      if (failing > 0) {
        failing -= 1;
        h.onClose('connect_failed');
        return;
      }
      connected = true;
      h.onOpen();
    },
    send: (f) => void t.sent.push(f),
    close() {
      connected = false;
      handlers = null;
    },
    emit: (f) => handlers?.onMessage(f),
    event: (channel, seq, data = {}, extra = {}) => handlers?.onMessage({ op: 'event', event: { channel, seq, type: 'trip.updated', version: 1, at: seq, data, ...extra } }),
    disconnect(reason = 'server_closed') {
      const h = handlers;
      connected = false;
      handlers = null;
      h?.onClose(reason);
    },
  };
  return t;
}

/** Channel names: one per trip / driver / user, so the server can authorise by ownership. */
export const realtimeChannels = {
  trip: (rideId: string) => `trip:${rideId}`,
  driverRequests: (driverId: string) => `driver:${driverId}:requests`,
  offers: (rideId: string) => `ride:${rideId}:offers`,
  user: (userId: string) => `user:${userId}`,
};
