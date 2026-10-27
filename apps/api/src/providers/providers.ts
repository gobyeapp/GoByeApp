import { createHash } from 'node:crypto';
import { createMockObjectStore, createSimulatedGateway, type LatLng, type ObjectStore, type PresignedRequest } from '@gobye/core';
import { hexToBase64, presignR2, type R2Credentials } from '@gobye/r2-sigv4';
import type { AppConfig } from '../config/config';
import { Errors } from '../common/errors';
import { WhatsAppPermanentError, type MapsProvider, type NotificationSender, type PlaceResult, type Providers, type WhatsAppSender } from './ports';

/* ---------- Not configured: fail closed ---------- */

export const notConfiguredMaps: MapsProvider = {
  name: 'none',
  searchPlaces: async () => { throw Errors.notConfigured('Place search'); },
  reverseGeocode: async () => { throw Errors.notConfigured('Address lookup'); },
  route: async () => { throw Errors.notConfigured('Routing'); },
};

export const notConfiguredNotifications: NotificationSender = {
  name: 'none',
  send: async () => { throw Errors.notConfigured('Notifications'); },
};

const refuse = (what: string) => async (): Promise<never> => { throw Errors.notConfigured(what); };
export const notConfiguredStorage: ObjectStore = {
  presignPut: refuse('File storage'),
  presignGet: refuse('File storage'),
  head: refuse('File storage'),
  readHead: refuse('File storage'),
  delete: refuse('File storage'),
  copy: refuse('File storage'),
};

/* ---------- Fakes (development and tests; refused in production by config) ---------- */

/** Straight-line distance at 30 km/h. Labelled fake: never used for real fares. */
export function fakeMaps(places: PlaceResult[] = []): MapsProvider {
  const haversine = (a: LatLng, b: LatLng) => {
    const r = 6_371_000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
  };
  return {
    name: 'fake',
    async searchPlaces(query) {
      const q = query.trim().toLowerCase();
      return q ? places.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8) : [];
    },
    async reverseGeocode(at) {
      return places.length ? [...places].sort((x, y) => haversine(at, x.location) - haversine(at, y.location))[0]! : null;
    },
    async route(from, to) {
      const d = Math.round(haversine(from, to) * 1.3);
      return { distanceMeters: d, durationSeconds: Math.round(d / (30_000 / 3600)), polyline: null };
    },
  };
}

/** Records messages instead of sending; logs only the template and channel (never addresses or data). */
export function logNotifications(log: (m: string, meta: object) => void = () => undefined): NotificationSender & { sent: string[] } {
  const sent: string[] = [];
  return {
    name: 'log',
    sent,
    async send(m) {
      if (sent.includes(m.id)) return { accepted: true, providerMessageId: `log-${m.id}` };
      sent.push(m.id);
      log('notification.simulated', { id: m.id, channel: m.channel, template: m.template });
      return { accepted: true, providerMessageId: `log-${m.id}` };
    },
  };
}

/* ---------- WhatsApp ---------- */

/** Records outgoing WhatsApp messages instead of sending (development, staging, tests). */
export function simulatedWhatsApp(log: (m: string, meta: object) => void = () => undefined): WhatsAppSender & { sent: { key: string; message: Record<string, unknown> }[] } {
  const sent: { key: string; message: Record<string, unknown> }[] = [];
  return {
    name: 'simulated',
    sent,
    async send(message, key) {
      if (!sent.some((m) => m.key === key)) {
        sent.push({ key, message });
        // Type only: never the number or the text (personal data).
        log('whatsapp.simulated', { key, type: message.type });
      }
      return { providerMessageId: `sim-${key}` };
    },
  };
}

/**
 * Meta Cloud API: POST https://graph.facebook.com/{version}/{phone-number-id}/messages with the system
 * user token. 4xx other than 429 is permanent (bad number, rejected message); 429 and 5xx are retried by
 * the job queue. The token is never logged.
 */
export function cloudApiWhatsApp(o: { accessToken: string; phoneNumberId: string; graphVersion: string; fetch?: typeof fetch; timeoutMs?: number }): WhatsAppSender {
  const f = o.fetch ?? fetch;
  return {
    name: 'cloud_api',
    async send(message) {
      const res = await f(`https://graph.facebook.com/${o.graphVersion}/${o.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${o.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
      });
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { code?: number; message?: string } } | null;
      if (res.ok) return { providerMessageId: body?.messages?.[0]?.id ?? null };
      const why = `WhatsApp Cloud API ${res.status}${body?.error?.code ? ` (code ${body.error.code})` : ''}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new WhatsAppPermanentError(why);
      throw new Error(why);
    },
  };
}

/* ---------- Cloudflare R2 (presigning only in Phase 1) ---------- */

/**
 * Presigned uploads and downloads against R2's S3 endpoint, reusing the edge's SigV4 presigner
 * (infra/cloudflare/src/r2/sigv4.ts) so headers and expiry rules are identical. Object inspection, moves
 * and deletes stay with the upload signer Worker (it has bucket bindings); calling them here fails closed.
 */
export function r2Storage(creds: R2Credentials, now: () => number = Date.now): ObjectStore {
  const notHere = (op: string) => async (): Promise<never> => { throw Errors.notConfigured(`R2 ${op} from the API (handled by the upload signer Worker)`); };
  return {
    async presignPut(q): Promise<PresignedRequest> {
      const headers = { 'content-type': q.contentType, 'content-length': String(q.contentLength), 'x-amz-checksum-sha256': hexToBase64(q.sha256) };
      const url = await presignR2(creds, { method: 'PUT', bucket: q.bucket, key: q.key, expiresIn: q.expiresIn, at: new Date(now()), signedHeaders: headers });
      return { url, method: 'PUT', headers, expiresAt: now() + q.expiresIn * 1000 };
    },
    async presignGet(q): Promise<PresignedRequest> {
      const url = await presignR2(creds, { method: 'GET', bucket: q.bucket, key: q.key, expiresIn: q.expiresIn, at: new Date(now()), query: { 'response-cache-control': 'private, no-store' } });
      return { url, method: 'GET', headers: {}, expiresAt: now() + q.expiresIn * 1000 };
    },
    head: notHere('head'),
    readHead: notHere('read'),
    delete: notHere('delete'),
    copy: notHere('copy'),
  };
}

/** Picks implementations from configuration. Production refusals live in config.ts. */
export function providersFromConfig(c: AppConfig, log?: (m: string, meta: object) => void): Providers {
  return {
    payments: c.PAYMENTS_PROVIDER === 'simulated' ? createSimulatedGateway() : null,
    maps: c.MAPS_PROVIDER === 'fake' ? fakeMaps() : notConfiguredMaps,
    notifications: c.NOTIFICATIONS_PROVIDER === 'log' ? logNotifications(log) : notConfiguredNotifications,
    storage:
      c.STORAGE_PROVIDER === 'r2'
        ? r2Storage({ accountId: c.R2_ACCOUNT_ID!, accessKeyId: c.R2_ACCESS_KEY_ID!, secretAccessKey: c.R2_SECRET_ACCESS_KEY! })
        : c.STORAGE_PROVIDER === 'memory'
          ? createMockObjectStore({ sha256: (b) => createHash('sha256').update(b).digest('hex') })
          : notConfiguredStorage,
    whatsapp:
      c.WHATSAPP_PROVIDER === 'cloud_api'
        ? cloudApiWhatsApp({ accessToken: c.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: c.WHATSAPP_PHONE_NUMBER_ID!, graphVersion: c.WHATSAPP_GRAPH_VERSION })
        : c.WHATSAPP_PROVIDER === 'simulated'
          ? simulatedWhatsApp(log)
          : null,
  };
}
