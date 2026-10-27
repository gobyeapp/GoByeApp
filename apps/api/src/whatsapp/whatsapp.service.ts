import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createQuote,
  isOfferedOption,
  MOCK_PRICING_CONFIG,
  newSession,
  step,
  toCloudApiMessage,
  VEHICLE_CATEGORIES,
  waIdToE164,
  type WaAccount,
  type WaContext,
  type WaEffect,
  type WaInbound,
  type WaInput,
  type WaReply,
  type WaRideOption,
  type WaSession,
} from '@gobye/core';
import type { AppConfig } from '../config/config';
import type { Database, Querier } from '../database/database';
import { enqueue } from '../jobs/queue';
import type { JobHandler } from '../jobs/worker';
import type { Providers } from '../providers/ports';

/**
 * WhatsApp quick booking on the server (D-064, docs/WHATSAPP_BOOKING.md).
 *
 * Webhook (controller) → verify Meta's signature → record the message id (de-duplication) → enqueue
 * `whatsapp.inbound`. The job runs the @gobye/core conversation under a row lock per number, performs its
 * effects (price, book, cancel) in the same transaction, saves the session and enqueues the reply as a
 * separate `whatsapp.send` job, so a failed send is retried without re-running the booking.
 */

/** A message older than this is not acted on (Meta retries deliveries for hours): no surprise bookings. */
export const STALE_MESSAGE_MS = 10 * 60_000;
const OPEN_STATUSES = ['searching', 'negotiating', 'matched', 'driver_en_route', 'driver_arrived', 'in_progress'];
const CANCELLABLE_STATUSES = ['searching', 'negotiating'];

/** X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256 of the exact request body with the app secret. */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  const m = header ? /^sha256=([0-9a-f]{64})$/i.exec(header.trim()) : null;
  if (!m) return false;
  const want = createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(m[1]!.toLowerCase(), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Records new inbound messages and queues them. Returns how many were new. */
export async function acceptInbound(db: Database, messages: WaInbound[]): Promise<number> {
  if (!messages.length) return 0;
  return db.tx(async (q) => {
    let queued = 0;
    for (const m of messages) {
      const r = await q.query(`insert into ops.whatsapp_messages (message_id, direction, wa_id, kind) values ($1, 'in', $2, $3) on conflict (message_id) do nothing returning message_id`, [m.messageId, m.waId, m.input.kind]);
      if (!r.rowCount) continue;
      await enqueue(q, { kind: 'whatsapp.inbound', idempotencyKey: `wa:in:${m.messageId}`, payload: m as unknown as Record<string, unknown>, maxAttempts: 3 });
      queued++;
    }
    return queued;
  });
}

async function lookupAccount(q: Querier, waId: string): Promise<WaAccount> {
  // The number on the GoBye account must be the WhatsApp number (verified at sign-up, D-045 / D-062).
  const r = await q.query<{ id: string; full_name: string; status: string; is_rider: boolean }>(
    `select u.id, u.full_name, u.status, (r.user_id is not null) as is_rider
       from app.users u left join app.riders r on r.user_id = u.id
      where u.phone = $1 and u.deleted_at is null
      limit 1`,
    [waIdToE164(waId)],
  );
  const u = r.rows[0];
  if (!u) return { kind: 'unknown' };
  if (u.status !== 'active' || !u.is_rider) return { kind: 'blocked' };
  return { kind: 'rider', userId: u.id, firstName: u.full_name.trim().split(/\s+/)[0] ?? u.full_name };
}

async function openRideOf(q: Querier, userId: string): Promise<string | null> {
  const r = await q.query<{ id: string }>(`select id from app.rides where rider_id = $1 and status = any($2) order by created_at desc limit 1`, [userId, OPEN_STATUSES]);
  return r.rows[0]?.id ?? null;
}

export interface WhatsAppDeps {
  config: Pick<AppConfig, 'WHATSAPP_OPEN_LINK_BASE' | 'WHATSAPP_BOOKING_ENABLED'>;
  providers: Pick<Providers, 'maps' | 'notifications' | 'whatsapp'>;
  now?: () => number;
  log?: (event: string, meta: object) => void;
}

export function linksFor(base: string): WaContext['links'] {
  const b = base.replace(/\/+$/, '');
  return { signUp: `${b}/signup`, openApp: b, openRide: (id) => `${b}/ride/${encodeURIComponent(id)}` };
}

async function runEffect(q: Querier, d: WhatsAppDeps, e: WaEffect, s: WaSession, account: WaAccount, now: number, after: (() => Promise<void>)[]): Promise<WaInput> {
  if (e.type !== 'cancel' && !d.config.WHATSAPP_BOOKING_ENABLED) return { kind: 'book_failed', reason: 'unavailable' };
  if (account.kind !== 'rider') return { kind: 'book_failed', reason: 'error' };

  if (e.type === 'quote') {
    try {
      const route = await d.providers.maps.route(e.pickup, e.destination);
      const simulated = d.providers.maps.name === 'fake';
      // Fares from @gobye/core with the placeholder pricing (D-007) until the server owns pricing config.
      const options: WaRideOption[] = VEHICLE_CATEGORIES.map((c) => {
        const quote = createQuote({ id: `wa-${randomUUID()}`, route: { ...route, polyline: [], isSimulated: simulated }, category: c.id, config: MOCK_PRICING_CONFIG, now });
        return { category: c.id, quoteId: quote.id, fare: quote.suggested, simulated };
      });
      return { kind: 'quoted', options, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds };
    } catch {
      return { kind: 'quote_failed' };
    }
  }

  if (e.type === 'book') {
    // Never trust a fare from a message: only an option this server offered in this session is bookable.
    if (!isOfferedOption(s, e.option)) return { kind: 'book_failed', reason: 'error' };
    await q.query('savepoint wa_book');
    let rideId: string;
    try {
      const r = await q.query<{ id: string }>(
        `insert into app.rides (rider_id, mode, category, status, city, pickup_lat, pickup_lng, pickup_label,
                                destination_lat, destination_lng, destination_label, quote_id, quoted_fare_kobo,
                                agreed_fare_kobo, fare_locked_at, channel)
         values ($1, 'quick_match', $2, 'searching', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, now(), 'whatsapp')
         returning id`,
        [account.userId, e.option.category, e.city, e.pickup.latitude.toFixed(6), e.pickup.longitude.toFixed(6), e.pickup.label, e.destination.latitude.toFixed(6), e.destination.longitude.toFixed(6), e.destination.label, e.option.quoteId, e.option.fare],
      );
      rideId = r.rows[0]!.id;
    } catch (err) {
      await q.query('rollback to savepoint wa_book');
      if ((err as { code?: string }).code === '23505') {
        const open = await openRideOf(q, account.userId);
        return { kind: 'book_failed', reason: 'open_ride', openRideId: open ?? undefined };
      }
      throw err;
    }
    const data = { channel: 'whatsapp', category: e.option.category, quotedFareKobo: e.option.fare, simulatedRoute: e.option.simulated };
    await q.query(`insert into app.ride_events (ride_id, type, actor_kind, actor_id, data) values ($1, 'ride.requested', 'rider', $2, $3::jsonb)`, [rideId, account.userId, JSON.stringify(data)]);
    await q.query(
      `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data)
       values ('rider', $1, $2, 'ride.requested', 'ride', $3, 'Quick Match ride requested on WhatsApp', $4::jsonb)`,
      [account.userId, `${account.firstName} (WhatsApp)`, rideId, JSON.stringify(data)],
    );
    // In-app notice so the account holder sees a booking made from their WhatsApp (and can cancel it).
    after.push(async () => {
      await d.providers.notifications
        .send({ id: `wa-booked:${rideId}`, channel: 'push', to: { userId: account.userId, address: account.userId }, template: 'ride.booked_on_whatsapp', data: { rideId } })
        .catch((err) => d.log?.('whatsapp.notify_failed', { rideId, message: (err as Error).message }));
    });
    return { kind: 'booked', rideId, option: e.option };
  }

  // Cancel: only a ride booked on WhatsApp, by this rider, before a driver is assigned (no fee).
  const r = await q.query<{ id: string }>(
    `update app.rides set status = 'cancelled', cancelled_at = now(), cancelled_by = 'rider', version = version + 1
      where id = $1 and rider_id = $2 and channel = 'whatsapp' and status = any($3)
      returning id`,
    [e.rideId, account.userId, CANCELLABLE_STATUSES],
  );
  if (!r.rows[0]) {
    const exists = await q.query(`select 1 from app.rides where id = $1 and rider_id = $2 and status = any($3)`, [e.rideId, account.userId, OPEN_STATUSES]);
    return { kind: 'cancel_result', ok: false, reason: exists.rowCount ? 'too_late' : 'not_found' };
  }
  await q.query(`insert into app.ride_events (ride_id, type, actor_kind, actor_id, data) values ($1, 'ride.cancelled', 'rider', $2, '{"channel":"whatsapp","fee":0}'::jsonb)`, [e.rideId, account.userId]);
  await q.query(
    `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data)
     values ('rider', $1, $2, 'ride.cancelled', 'ride', $3, 'Ride cancelled on WhatsApp before a driver was assigned', '{"channel":"whatsapp","fee":0}'::jsonb)`,
    [account.userId, `${account.firstName} (WhatsApp)`, e.rideId],
  );
  return { kind: 'cancel_result', ok: true };
}

/** Job handlers: whatsapp.inbound, whatsapp.send, whatsapp.cleanup. */
export function whatsappHandlers(d: WhatsAppDeps): Record<string, JobHandler> {
  const clock = d.now ?? Date.now;
  return {
    'whatsapp.inbound': async (job, db) => {
      if (!d.providers.whatsapp) return { ok: false, error: 'WhatsApp is not configured on this server', permanent: true };
      const m = job.payload as unknown as WaInbound;
      const now = clock();
      if (now - m.timestamp * 1000 > STALE_MESSAGE_MS) return { ok: true, result: { skipped: 'stale' } };
      const after: (() => Promise<void>)[] = [];
      const result = await db.tx(async (q) => {
        await q.query(`insert into app.whatsapp_sessions (wa_id, state) values ($1, $2::jsonb) on conflict (wa_id) do nothing`, [m.waId, JSON.stringify(newSession(now))]);
        const row = await q.query<{ state: WaSession }>(`select state from app.whatsapp_sessions where wa_id = $1 for update`, [m.waId]);
        const account = await lookupAccount(q, m.waId);
        const ctx: WaContext = {
          now,
          account,
          openRideId: account.kind === 'rider' ? await openRideOf(q, account.userId) : null,
          links: linksFor(d.config.WHATSAPP_OPEN_LINK_BASE),
          quoteTtlMs: MOCK_PRICING_CONFIG.quoteTtlSeconds * 1000,
        };
        let session = row.rows[0]!.state;
        let input: WaInput = m.input;
        let reply: WaReply | null = null;
        for (let i = 0; i < 4; i++) {
          const out = step(session, input, ctx);
          session = out.session;
          if (out.reply) reply = out.reply;
          if (!out.effect) break;
          input = await runEffect(q, d, out.effect, session, account, now, after);
        }
        await q.query(`update app.whatsapp_sessions set state = $2::jsonb, user_id = $3 where wa_id = $1`, [m.waId, JSON.stringify(session), account.kind === 'rider' ? account.userId : null]);
        if (reply) {
          await enqueue(q, { kind: 'whatsapp.send', idempotencyKey: `wa:out:${m.messageId}`, payload: { to: m.waId, key: `reply-${m.messageId}`, message: toCloudApiMessage(m.waId, reply) }, maxAttempts: 5 });
        }
        return { stage: session.stage, replied: !!reply, account: account.kind };
      });
      for (const f of after) await f();
      return { ok: true, result };
    },

    'whatsapp.send': async (job, db) => {
      const w = d.providers.whatsapp;
      if (!w) return { ok: false, error: 'WhatsApp is not configured on this server', permanent: true };
      const p = job.payload as { to: string; key: string; message: Record<string, unknown> };
      try {
        const r = await w.send(p.message, p.key);
        await db.query(`insert into ops.whatsapp_messages (message_id, direction, wa_id, kind) values ($1, 'out', $2, $3) on conflict (message_id) do nothing`, [r.providerMessageId ?? p.key, p.to, String(p.message.type ?? 'unknown')]);
        return { ok: true, result: { providerMessageId: r.providerMessageId } };
      } catch (e) {
        return { ok: false, error: (e as Error).message, permanent: (e as { permanent?: boolean }).permanent === true };
      }
    },

    'whatsapp.cleanup': async (_job, db) => {
      const s = await db.query(`delete from app.whatsapp_sessions where updated_at < now() - interval '24 hours'`);
      const m = await db.query(`delete from ops.whatsapp_messages where created_at < now() - interval '30 days'`);
      return { ok: true, result: { sessions: s.rowCount ?? 0, messages: m.rowCount ?? 0 } };
    },
  };
}
