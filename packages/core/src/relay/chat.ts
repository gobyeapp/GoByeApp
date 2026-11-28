import type { Result } from '../types';
import type { Relay } from './client';
import { eventId, poll } from './rides';
import type { RelayEvent } from './types';

/**
 * Messages between a rider and their driver during one ride (D-108), over the demo connection. Short
 * text only, tied to the ride, and it stops being offered when the ride ends. Neither side ever sees the
 * other's phone number. On the real server this becomes its own table with retention rules; here the
 * messages ride on the shared activity table as type "chat".
 */
export interface ChatMessage {
  id: string;
  from: 'rider' | 'driver';
  text: string;
  at: number;
}

export const CHAT_MAX_LENGTH = 300;
export const CHAT_TYPE = 'chat';

/** One-tap messages: most of what people need to say at pickup. */
export const QUICK_REPLIES: Record<'rider' | 'driver', readonly string[]> = {
  rider: ['I’m at the pickup point', 'I’m coming out now', 'Where are you?', 'Please wait a minute'],
  driver: ['I’ve arrived', 'I’m on my way', 'Where exactly are you?', 'I’m in traffic, a few minutes'],
};

/** Trims a message and refuses an empty or over-long one. Line breaks and odd spacing become single spaces. */
export function cleanChatText(text: string): Result<string> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, error: 'Type a message first.' };
  if (t.length > CHAT_MAX_LENGTH) return { ok: false, error: `Keep it under ${CHAT_MAX_LENGTH} characters.` };
  return { ok: true, value: t };
}

export interface RideChat {
  send(text: string): Promise<Result<ChatMessage>>;
  /** Calls back with the whole conversation, oldest first, whenever it changes. Returns "stop". */
  watch(listener: (messages: ChatMessage[]) => void): () => void;
}

export function createRideChat(relay: Relay, o: { rideId: string; me: 'rider' | 'driver'; pollMs?: number; now?: () => number }): RideChat {
  const now = o.now ?? Date.now;
  const read = async (): Promise<ChatMessage[]> => {
    const rows = await relay.select<RelayEvent>('demo_events', { where: { ride_id: o.rideId, type: CHAT_TYPE }, order: ['at', 'asc'], limit: 200 });
    return rows.filter((r) => r.actor === 'rider' || r.actor === 'driver').map((r) => ({ id: r.id, from: r.actor as 'rider' | 'driver', text: r.summary, at: r.at }));
  };
  return {
    async send(text) {
      const clean = cleanChatText(text);
      if (!clean.ok) return clean;
      const at = now();
      const row: RelayEvent = { id: eventId(at), at, actor: o.me, type: CHAT_TYPE, summary: clean.value, ride_id: o.rideId, person_id: null };
      try {
        await relay.insert<RelayEvent>('demo_events', row);
      } catch {
        return { ok: false, error: 'Not sent. Check your connection and try again.' };
      }
      return { ok: true, value: { id: row.id, from: o.me, text: clean.value, at } };
    },
    watch(listener) {
      let last = '';
      return poll(async () => {
        const all = await read();
        const key = `${all.length}:${all[all.length - 1]?.id ?? ''}`;
        if (key === last) return;
        last = key;
        listener(all);
      }, o.pollMs ?? 2500);
    },
  };
}
