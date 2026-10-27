import type { WaReply, WaUserInput } from './types';

/**
 * WhatsApp Business Platform (Cloud API) formats: inbound webhook → WaUserInput, WaReply → outbound
 * message body for POST /{phone-number-id}/messages. Limits are enforced here so a long place name can
 * never make Meta reject a reply.
 * Reference: developers.facebook.com/docs/whatsapp/cloud-api (webhooks "messages"; interactive list,
 * reply buttons and CTA URL messages).
 */

export interface WaInbound {
  /** Meta's message id (wamid…): the de-duplication key, because Meta may deliver a webhook twice. */
  messageId: string;
  /** Sender's WhatsApp id: their phone number in international format without "+". */
  waId: string;
  /** Seconds since epoch, as sent by Meta. */
  timestamp: number;
  input: WaUserInput;
}

const WA_ID = /^[1-9]\d{7,14}$/;
const MESSAGE_ID = /^[A-Za-z0-9._=:+/-]{8,256}$/;

export const LIMITS = { body: 1024, listButton: 20, rowTitle: 24, rowDescription: 72, rows: 10, buttonTitle: 20, buttons: 3, ctaText: 20 } as const;

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function inputOf(m: Json): WaUserInput {
  const type = str(m.type);
  if (type === 'location') {
    const l = obj(m.location);
    const lat = num(l?.latitude);
    const lng = num(l?.longitude);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { kind: 'unsupported' };
    const label = [str(l?.name), str(l?.address)].filter((x): x is string => !!x && x.trim() !== '').join(', ').trim();
    return { kind: 'location', place: { latitude: lat, longitude: lng, label: cut(label || `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, 120) } };
  }
  if (type === 'text') {
    const body = str(obj(m.text)?.body);
    return body ? { kind: 'text', text: cut(body, 500) } : { kind: 'unsupported' };
  }
  if (type === 'interactive') {
    const i = obj(m.interactive);
    const id = str(obj(i?.list_reply)?.id) ?? str(obj(i?.button_reply)?.id);
    return id ? { kind: 'choice', id: cut(id, 64) } : { kind: 'unsupported' };
  }
  if (type === 'button') {
    // Quick-reply button on a template message.
    const payload = str(obj(m.button)?.payload);
    return payload ? { kind: 'choice', id: cut(payload, 64) } : { kind: 'unsupported' };
  }
  return { kind: 'unsupported' };
}

/**
 * Messages from a webhook body (object "whatsapp_business_account", field "messages"). Delivery and read
 * statuses, and anything malformed, are ignored. `phoneNumberId` restricts to our own number.
 */
export function parseWebhook(body: unknown, phoneNumberId?: string): WaInbound[] {
  const root = obj(body);
  if (!root || root.object !== 'whatsapp_business_account') return [];
  const out: WaInbound[] = [];
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (c?.field !== 'messages') continue;
      const value = obj(c.value);
      if (!value) continue;
      if (phoneNumberId && str(obj(value.metadata)?.phone_number_id) !== phoneNumberId) continue;
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const messageId = str(m?.id);
        const waId = str(m?.from);
        const timestamp = num(m?.timestamp);
        if (!m || !messageId || !MESSAGE_ID.test(messageId) || !waId || !WA_ID.test(waId) || timestamp === null) continue;
        out.push({ messageId, waId, timestamp, input: inputOf(m) });
      }
    }
  }
  return out;
}

/** Body for POST https://graph.facebook.com/{version}/{phone-number-id}/messages. */
export function toCloudApiMessage(to: string, reply: WaReply): Json {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (reply.type) {
    case 'text':
      return { ...base, type: 'text', text: { preview_url: false, body: cut(reply.body, 4096) } };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: cut(reply.body, LIMITS.body) },
          action: {
            button: cut(reply.button, LIMITS.listButton),
            sections: [{ title: 'Rides', rows: reply.rows.slice(0, LIMITS.rows).map((r) => ({ id: r.id, title: cut(r.title, LIMITS.rowTitle), ...(r.description ? { description: cut(r.description, LIMITS.rowDescription) } : {}) })) }],
          },
        },
      };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: cut(reply.body, LIMITS.body) },
          action: { buttons: reply.buttons.slice(0, LIMITS.buttons).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, LIMITS.buttonTitle) } })) },
        },
      };
    case 'link':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: cut(reply.body, LIMITS.body) },
          action: { name: 'cta_url', parameters: { display_text: cut(reply.buttonText, LIMITS.ctaText), url: reply.url } },
        },
      };
  }
}

/** "+2348030000001" ⇄ "2348030000001". */
export const waIdToE164 = (waId: string) => `+${waId}`;
