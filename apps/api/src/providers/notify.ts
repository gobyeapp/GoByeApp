import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationChannel, NotificationMessage, NotificationResult, NotificationSender } from './ports';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Thrown when sending again can't help (bad address, token no longer valid): the job stops. */
export class NotifyPermanentError extends Error {
  readonly permanent = true;
  constructor(message: string, readonly invalidAddress = false) {
    super(message);
  }
}

/**
 * The words of each message (D-103). Kept short and free of personal data beyond a first name and a fare:
 * a push shows on a lock screen. One-time codes are never sent through here (those go from the sign-in
 * service through the SMS hook).
 */
export const TEMPLATES: Record<string, (d: Record<string, string>) => { title: string; body: string; html?: string }> = {
  'ride.request': (d) => ({ title: 'New ride request', body: `${d.pickup} to ${d.destination} · ${d.fare}` }),
  'ride.matched': (d) => ({ title: 'Your driver is on the way', body: `${d.driver} · ${d.vehicle} · ${d.plate}` }),
  'ride.driver_arrived': (d) => ({ title: 'Your driver has arrived', body: `Give the driver your PIN to start. ${d.plate}` }),
  'ride.trip_ended': (d) => ({ title: 'Trip complete', body: `${d.fare} to pay. Open GoBye to finish.` }),
  'ride.payment_claimed': (d) => ({ title: 'Rider says they have paid', body: `Check for ${d.fare} and confirm in GoBye Driver.` }),
  'ride.cancelled': () => ({ title: 'Ride cancelled', body: 'This ride was cancelled.' }),
  'ride.driver_cancelled': () => ({ title: 'Finding you another driver', body: 'Your driver had to cancel. We’re searching again.' }),
  'ride.booked_on_whatsapp': () => ({ title: 'Ride booked on WhatsApp', body: 'A ride was booked from your WhatsApp. Open GoBye to follow or cancel it.' }),
  'wallet.funded': (d) => ({ title: 'Money added', body: `${d.amount} is in your GoBye wallet.` }),
  'withdrawal.paid': (d) => ({ title: 'Withdrawal sent', body: `${d.amount} is on its way to your bank account.` }),
  'application.decided': (d) => ({ title: d.approved === 'yes' ? 'You’re approved to drive' : 'Your registration needs attention', body: 'Open GoBye Driver for details.' }),
  'ride.receipt': (d) => ({
    title: `Your GoBye receipt · ${d.fare}`,
    body: `Trip on ${d.date}\nFrom: ${d.pickup}\nTo: ${d.destination}\nFare: ${d.fare}\nPaid by: ${d.method}\nDriver: ${d.driver}\nRide: ${d.rideId}\n\nTurn receipts off in GoBye: Account, Notifications.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;color:#171717"><h2 style="margin:0 0 4px">Your GoBye receipt</h2><p style="color:#666;margin:0 0 16px">${esc(d.date)}</p><p style="font-size:28px;font-weight:700;margin:0 0 16px">${esc(d.fare)}</p><table style="width:100%;border-collapse:collapse;font-size:14px">${[['From', d.pickup], ['To', d.destination], ['Paid by', d.method], ['Driver', d.driver], ['Ride', d.rideId]].map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;border-top:1px solid #eee">${k}</td><td style="padding:8px 0;text-align:right;border-top:1px solid #eee">${esc(v ?? '')}</td></tr>`).join('')}</table><p style="color:#888;font-size:12px;margin-top:20px">You can turn receipts off in GoBye: Account, Notifications.</p></div>`,
  }),
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function render(m: Pick<NotificationMessage, 'template' | 'data'>) {
  const t = TEMPLATES[m.template];
  if (!t) throw new NotifyPermanentError(`Unknown template ${m.template}`);
  return t(m.data);
}

async function post(f: FetchLike, url: string, headers: Record<string, string>, body: object): Promise<{ status: number; json: unknown }> {
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Expo push (free). A token Expo calls "DeviceNotRegistered" is reported so the caller can forget it. */
export function expoPush(o: { accessToken?: string; fetch?: FetchLike }): NotificationSender {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  return {
    name: 'expo',
    async send(m): Promise<NotificationResult> {
      if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(m.to.address)) throw new NotifyPermanentError('Not an Expo push token', true);
      const t = render(m);
      const r = await post(f, 'https://exp.host/--/api/v2/push/send', o.accessToken ? { authorization: `Bearer ${o.accessToken}` } : {}, { to: m.to.address, title: t.title, body: t.body, sound: 'default', priority: 'high', channelId: 'rides', data: { template: m.template, ...(m.data.rideId ? { rideId: m.data.rideId } : {}) } });
      const ticket = (r.json as { data?: { status?: string; id?: string; details?: { error?: string } } } | null)?.data;
      if (r.status >= 500 || r.status === 429) throw new Error(`Expo push HTTP ${r.status}`);
      if (ticket?.status === 'ok') return { accepted: true, providerMessageId: ticket.id ?? null };
      throw new NotifyPermanentError(`Expo push refused (${ticket?.details?.error ?? r.status})`, ticket?.details?.error === 'DeviceNotRegistered');
    },
  };
}

/** Resend (email). The same message id is sent as the Idempotency-Key, so a retry never sends twice. */
export function resendEmail(o: { apiKey: string; from: string; fetch?: FetchLike }): NotificationSender {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  return {
    name: 'resend',
    async send(m) {
      const t = render(m);
      const r = await post(f, 'https://api.resend.com/emails', { authorization: `Bearer ${o.apiKey}`, 'idempotency-key': m.id.slice(0, 256) }, { from: o.from, to: [m.to.address], subject: t.title, text: t.body, ...(t.html ? { html: t.html } : {}) });
      if (r.status >= 200 && r.status < 300) return { accepted: true, providerMessageId: (r.json as { id?: string } | null)?.id ?? null };
      if (r.status === 429 || r.status >= 500) throw new Error(`Resend HTTP ${r.status}`);
      throw new NotifyPermanentError(`Resend refused (HTTP ${r.status})`, r.status === 422);
    },
  };
}

/** Termii (SMS, Nigeria). `dnd` is the route for codes and transactional messages; it must be enabled on the account. */
export function termiiSms(o: { apiKey: string; senderId: string; baseUrl: string; channel?: 'dnd' | 'generic'; fetch?: FetchLike }): NotificationSender & { sendText(to: string, text: string): Promise<NotificationResult> } {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const sendText = async (to: string, text: string): Promise<NotificationResult> => {
    const digits = to.replace(/^\+/, '');
    if (!/^234[789][01][0-9]{8}$/.test(digits)) throw new NotifyPermanentError('Not a Nigerian mobile number', true);
    const r = await post(f, `${o.baseUrl.replace(/\/+$/, '')}/api/sms/send`, {}, { api_key: o.apiKey, to: digits, from: o.senderId, sms: text, type: 'plain', channel: o.channel ?? 'dnd' });
    if (r.status >= 200 && r.status < 300) return { accepted: true, providerMessageId: String((r.json as { message_id?: string | number } | null)?.message_id ?? '') || null };
    if (r.status === 429 || r.status >= 500) throw new Error(`Termii HTTP ${r.status}`);
    throw new NotifyPermanentError(`Termii refused (HTTP ${r.status})`);
  };
  return {
    name: 'termii',
    sendText,
    async send(m) {
      const t = render(m);
      return sendText(m.to.address, `${t.title}. ${t.body}`.slice(0, 300));
    },
  };
}

/** One sender per channel; a channel with none fails closed ("not connected"). */
export function channelSender(by: Partial<Record<NotificationChannel, NotificationSender>>, fallback: NotificationSender): NotificationSender {
  return {
    name: `channels(${(['push', 'sms', 'email'] as const).map((c) => `${c}:${by[c]?.name ?? fallback.name}`).join(',')})`,
    send: (m) => (by[m.channel] ?? fallback).send(m),
  };
}

/**
 * Standard Webhooks signature (used by Supabase Auth hooks): header `webhook-signature` holds one or more
 * `v1,<base64>` values; the signed text is `${webhook-id}.${webhook-timestamp}.${body}`; the key is the
 * base64 part of the secret after `whsec_`. Messages older or newer than five minutes are refused.
 */
export function verifyStandardWebhook(secret: string, rawBody: string, headers: Record<string, string | undefined>, nowMs: number): boolean {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigs = headers['webhook-signature'];
  if (!id || !ts || !sigs || !/^\d{9,11}$/.test(ts)) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  } catch {
    return false;
  }
  if (key.length < 16) return false;
  const want = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
  return sigs.split(' ').some((s) => {
    const [v, b64] = s.split(',');
    if (v !== 'v1' || !b64) return false;
    const got = Buffer.from(b64, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
