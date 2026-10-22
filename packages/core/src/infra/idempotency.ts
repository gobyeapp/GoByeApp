import type { FareQuote, Kobo, Result } from '../types';

/**
 * Idempotency and fare integrity rules for clients (D-051, brief §12). Status: implemented and tested.
 *
 * - Every create that moves money or commits a driver (booking, offer, counter, payment, top-up,
 *   withdrawal) carries an Idempotency-Key that is generated once per user intent and reused on any
 *   retry of that same intent. The backend stores the key with the result and returns the stored
 *   result for a repeat; a different body with the same key is rejected (409 idempotency_conflict).
 * - After a timeout the client does NOT resend; it asks for the authoritative state by that key
 *   (see resolveAmbiguous in http.ts).
 * - The agreed fare is fixed by the server at matching. The client never recalculates it afterwards;
 *   a material route change goes through a separate fare-adjustment request the rider must approve.
 */

export type IdempotencyScope = 'booking' | 'offer' | 'counter' | 'select_driver' | 'payment' | 'wallet_topup' | 'withdrawal' | 'cancel' | 'upload';

/** A fresh key for one user intent, e.g. "booking_lx3k2a_9f2c1d7e4b". Store it with the pending action. */
export function newIdempotencyKey(scope: IdempotencyScope, now = Date.now(), random: () => number = Math.random): string {
  const rnd = Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join('');
  return `${scope}_${now.toString(36)}_${rnd}`;
}

export const isIdempotencyKey = (k: string) => /^[a-z_]+_[a-z0-9]+_[a-z0-9]{8,}$/.test(k);

/**
 * Quote freshness before booking: a stale quote must be re-fetched from the server, never patched
 * locally. `version` is the server's quote id; any change means the price may differ.
 */
export function assertQuoteFresh(quote: Pick<FareQuote, 'id' | 'expiresAt'>, now: number, expectedVersion?: string): Result<true, 'quote_expired' | 'quote_changed'> {
  if (quote.expiresAt <= now) return { ok: false, error: 'quote_expired' };
  if (expectedVersion && expectedVersion !== quote.id) return { ok: false, error: 'quote_changed' };
  return { ok: true, value: true };
}

/** The fare shown after matching is the server's agreed fare, unchanged. Returns it or refuses a client-side change. */
export function lockedFare(serverAgreed: Kobo, clientComputed?: Kobo): Result<Kobo, 'fare_mismatch'> {
  if (clientComputed !== undefined && clientComputed !== serverAgreed) return { ok: false, error: 'fare_mismatch' };
  return { ok: true, value: serverAgreed };
}
