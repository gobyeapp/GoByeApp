import type { Kobo, LatLng, VehicleCategoryId } from '../types';
import type { CityId } from '../platform/types';

/**
 * WhatsApp quick booking (D-064, docs/WHATSAPP_BOOKING.md). WhatsApp is only a fast way IN: the rider
 * sends a pickup pin and a destination pin, taps a Quick Match fare, and the ride is created on the
 * server. Everything after that (driver, tracking, chat, safety, payment, receipt) happens in the app.
 *
 * Channel-neutral types: the conversation never sees WhatsApp's JSON (cloudApi.ts converts both ways).
 */

export interface WaPlace extends LatLng {
  /** Name or address WhatsApp sent with the pin, or a coordinate label. Shown back to the rider only. */
  label: string;
}

/** One Quick Match option offered in the chat. The fare is computed on the server (createQuote). */
export interface WaRideOption {
  category: VehicleCategoryId;
  quoteId: string;
  fare: Kobo;
  /** True when the route came from the fake maps provider: the chat says "test fare". */
  simulated: boolean;
}

/** What the rider sent, after parsing. */
export type WaUserInput =
  | { kind: 'location'; place: WaPlace }
  | { kind: 'text'; text: string }
  /** Tap on a list row or reply button: the id we gave it. */
  | { kind: 'choice'; id: string }
  /** Images, voice notes, stickers, contacts…: not understood. */
  | { kind: 'unsupported' };

/** Results of server work the conversation asked for (effects), fed back in. */
export type WaSystemInput =
  | { kind: 'quoted'; options: WaRideOption[]; distanceMeters: number; durationSeconds: number }
  | { kind: 'quote_failed' }
  | { kind: 'booked'; rideId: string; option: WaRideOption }
  | { kind: 'book_failed'; reason: 'open_ride' | 'unavailable' | 'error'; openRideId?: string }
  | { kind: 'cancel_result'; ok: boolean; reason?: 'too_late' | 'not_found' };

export type WaInput = WaUserInput | WaSystemInput;

/** A message the rider receives. Converted to WhatsApp's format by cloudApi.ts. */
export type WaReply =
  | { type: 'text'; body: string }
  | { type: 'list'; body: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { type: 'buttons'; body: string; buttons: { id: string; title: string }[] }
  | { type: 'link'; body: string; buttonText: string; url: string };

/** Server work the conversation needs before it can answer. */
export type WaEffect =
  | { type: 'quote'; pickup: WaPlace; destination: WaPlace; city: CityId }
  | { type: 'book'; option: WaRideOption; pickup: WaPlace; destination: WaPlace; city: CityId }
  | { type: 'cancel'; rideId: string };

export type WaStage = 'idle' | 'awaiting_destination' | 'quoting' | 'choosing' | 'booking';

/** Stored per WhatsApp number (app.whatsapp_sessions.state). Small, and cleared after a booking. */
export interface WaSession {
  stage: WaStage;
  pickup?: WaPlace;
  destination?: WaPlace;
  city?: CityId;
  options?: WaRideOption[];
  route?: { distanceMeters: number; durationSeconds: number };
  quotedAt?: number;
  /** Set when fares were re-quoted because the rider waited too long. */
  requoted?: boolean;
  /** Last ride booked from this chat: "CANCEL" refers to it. */
  lastRideId?: string | null;
  updatedAt: number;
}

/** Who is writing, looked up by the WhatsApp number (E.164) on the server. Never from the message. */
export type WaAccount =
  | { kind: 'rider'; userId: string; firstName: string }
  | { kind: 'unknown' }
  /** Suspended or deleted account, or a number that isn't a rider. */
  | { kind: 'blocked' };

export interface WaContext {
  now: number;
  account: WaAccount;
  /** The rider's open ride (searching … in progress), if any. */
  openRideId: string | null;
  links: { signUp: string; openRide: (rideId: string) => string; openApp: string };
  /** Quick Match fares are valid this long (MOCK_PRICING_CONFIG.quoteTtlSeconds until the server owns pricing). */
  quoteTtlMs: number;
}

export interface WaStep {
  session: WaSession;
  reply: WaReply | null;
  effect: WaEffect | null;
}
