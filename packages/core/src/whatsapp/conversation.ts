import { haversineMeters, formatDistance } from '../geo';
import { formatNaira } from '../money';
import { getCategory } from '../pricing/config';
import type { VehicleCategoryId } from '../types';
import { cityAt, SERVICE_AREAS } from './serviceArea';
import type { WaContext, WaInput, WaPlace, WaReply, WaRideOption, WaSession, WaStep } from './types';

/**
 * The WhatsApp quick-booking conversation (D-064) as a pure function: (session, input, context) → new
 * session, at most one reply, at most one effect. The server runs the effect (quote, book, cancel) and
 * feeds the result back in as a system input, so every rule here is tested without WhatsApp or a database.
 *
 * Rules:
 * - Only a rider whose GoBye account has this WhatsApp number can book (the server looks it up).
 * - Pickup and destination are WhatsApp location pins (WhatsApp's picker can search places, so no
 *   geocoding is needed). Pickup must be inside a launch city.
 * - Quick Match only. Negotiate, payment and everything after booking happen in the app.
 * - Fares come from the server; an option is bookable only while its quote is valid.
 * - One open ride per rider (the database enforces it too).
 */

export const SESSION_IDLE_MS = 15 * 60_000;
const MIN_TRIP_METERS = 200;
const MAX_TRIP_METERS = 100_000;
const CANCEL_WORDS = new Set(['cancel', 'stop', 'cancel ride', 'cancel booking']);
const HELP_WORDS = new Set(['help', 'menu', '?']);
const PIN_HOW = 'Tap 📎 (or +) → Location';

export const choiceIdFor = (category: VehicleCategoryId) => `ride:${category}`;
export const CANCEL_CHOICE = 'cancel';

export function newSession(now: number): WaSession {
  return { stage: 'idle', lastRideId: null, updatedAt: now };
}

function reset(s: WaSession, now: number, keepLastRide = true): WaSession {
  return { stage: 'idle', lastRideId: keepLastRide ? (s.lastRideId ?? null) : null, updatedAt: now };
}

const text = (body: string): WaReply => ({ type: 'text', body });

function placeName(p: WaPlace): string {
  return p.label.length > 60 ? `${p.label.slice(0, 57)}…` : p.label;
}

function optionsList(s: WaSession, prefix = ''): WaReply {
  const route = s.route;
  const trip = route ? ` · ${formatDistance(route.distanceMeters)}, about ${Math.max(1, Math.round(route.durationSeconds / 60))} min` : '';
  const anySimulated = (s.options ?? []).some((o) => o.simulated);
  return {
    type: 'list',
    body:
      `${prefix}From ${placeName(s.pickup!)} to ${placeName(s.destination!)}${trip}.\n\n` +
      'Choose a ride. You pay after the trip, in the app.' +
      (anySimulated ? '\n\nTest fares: routes are simulated on this server.' : ''),
    button: 'Choose ride',
    rows: [
      ...(s.options ?? []).map((o) => {
        const c = getCategory(o.category);
        return { id: choiceIdFor(o.category), title: c.name, description: `${formatNaira(o.fare)} · ${c.seats} seats${o.simulated ? ' · test fare' : ''}` };
      }),
      { id: CANCEL_CHOICE, title: 'Cancel', description: 'Start again' },
    ],
  };
}

function greeting(ctx: WaContext): WaReply {
  const name = ctx.account.kind === 'rider' ? ` ${ctx.account.firstName}` : '';
  return text(`Hi${name}! Book a GoBye ride here in seconds.\n\n1. Send your *pickup* location: ${PIN_HOW} → Send your current location (or search a place).\n2. Send your *destination* the same way.\n3. Tap a fare.\n\nEverything else happens in the GoBye app. Reply CANCEL at any time.`);
}

/** One step of the conversation. */
export function step(prev: WaSession | null, input: WaInput, ctx: WaContext): WaStep {
  const now = ctx.now;
  // A conversation left alone for 15 minutes starts again (the ride it booked, if any, is remembered).
  let s: WaSession = !prev ? newSession(now) : now - prev.updatedAt > SESSION_IDLE_MS && prev.stage !== 'quoting' && prev.stage !== 'booking' ? reset(prev, now) : prev;
  const out = (session: WaSession, reply: WaReply | null, effect: WaStep['effect'] = null): WaStep => ({ session: { ...session, updatedAt: now }, reply, effect });

  // Who is writing is decided on the server from the number, never from the message.
  if (ctx.account.kind === 'unknown') {
    return out(reset(s, now, false), {
      type: 'link',
      body: "This WhatsApp number isn't linked to a GoBye account yet. Create your account in the app with this number, then book here in seconds.",
      buttonText: 'Get GoBye',
      url: ctx.links.signUp,
    });
  }
  if (ctx.account.kind === 'blocked') return out(reset(s, now, false), text("This account can't book rides right now. Open the GoBye app and contact Support."));

  /* ---------- results of server work ---------- */
  switch (input.kind) {
    case 'quoted': {
      if (s.stage !== 'quoting' || !s.pickup || !s.destination) return out(s, null);
      s = { ...s, stage: 'choosing', options: input.options, route: { distanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds }, quotedAt: now };
      const prefix = s.requoted ? 'Fares were updated because a few minutes passed.\n\n' : '';
      return out({ ...s, requoted: false }, optionsList(s, prefix));
    }
    case 'quote_failed':
      return out(reset(s, now), text("Sorry, we couldn't price that trip right now. Please try again, or book in the GoBye app."));
    case 'booked': {
      const c = getCategory(input.option.category);
      return out({ ...reset(s, now), lastRideId: input.rideId }, {
        type: 'link',
        body: `Booked! We're finding a driver for your ${c.name} ride (${formatNaira(input.option.fare)}).\n\nFollow your driver, chat and pay in the GoBye app. Reply CANCEL to cancel before a driver is assigned.`,
        buttonText: 'Open GoBye',
        url: ctx.links.openRide(input.rideId),
      });
    }
    case 'book_failed':
      if (input.reason === 'open_ride' && input.openRideId)
        return out(reset(s, now), { type: 'link', body: 'You already have a ride in progress. You can follow it in the app.', buttonText: 'Open GoBye', url: ctx.links.openRide(input.openRideId) });
      if (input.reason === 'unavailable') return out(reset(s, now), text('Booking on WhatsApp is paused right now. Please book in the GoBye app.'));
      return out(reset(s, now), text('Something went wrong and the ride was not booked. Please try again.'));
    case 'cancel_result':
      if (input.ok) return out({ ...reset(s, now), lastRideId: null }, text('Your ride is cancelled. No fee was charged.'));
      if (input.reason === 'too_late' && s.lastRideId)
        return out(reset(s, now), { type: 'link', body: 'A driver is already assigned, so please cancel in the app (a cancellation fee may apply).', buttonText: 'Open GoBye', url: ctx.links.openRide(s.lastRideId) });
      return out(reset(s, now), text("There's no ride to cancel."));
  }

  /* ---------- the rider's messages ---------- */
  if (s.stage === 'quoting' || s.stage === 'booking') return out(s, text('One moment…'));

  const typed = input.kind === 'text' ? input.text.trim().toLowerCase() : null;
  if ((typed && CANCEL_WORDS.has(typed)) || (input.kind === 'choice' && input.id === CANCEL_CHOICE)) {
    if (s.stage !== 'idle') return out(reset(s, now), text('Okay, nothing was booked. Send your pickup location whenever you are ready.'));
    if (s.lastRideId && ctx.openRideId === s.lastRideId) return out(s, null, { type: 'cancel', rideId: s.lastRideId });
    if (ctx.openRideId) return out(s, { type: 'link', body: 'Your current ride was booked in the app. Cancel it there.', buttonText: 'Open GoBye', url: ctx.links.openRide(ctx.openRideId) });
    return out(s, text("There's no ride to cancel."));
  }
  if (typed && HELP_WORDS.has(typed)) return out(s, greeting(ctx));

  // One open ride at a time: send the rider to the app instead of starting a new booking.
  if (ctx.openRideId && s.stage === 'idle') {
    const fromHere = s.lastRideId === ctx.openRideId;
    return out(s, {
      type: 'link',
      body: `You have a ride in progress. Follow it in the GoBye app.${fromHere ? ' Reply CANCEL to cancel it before a driver is assigned.' : ''}`,
      buttonText: 'Open GoBye',
      url: ctx.links.openRide(ctx.openRideId),
    });
  }

  if (input.kind === 'location') {
    const place = input.place;
    // A new pin while choosing or after the pickup means: start again from this pickup.
    if (s.stage === 'awaiting_destination' && s.pickup) {
      const meters = haversineMeters(s.pickup, place);
      if (meters < MIN_TRIP_METERS) return out(s, text(`That's the same place as your pickup. Send your *destination*: ${PIN_HOW} → search the place.`));
      if (meters > MAX_TRIP_METERS) return out(s, text('That destination is too far for a GoBye ride. Send a destination within 100 km.'));
      const next: WaSession = { ...s, stage: 'quoting', destination: place };
      return out(next, null, { type: 'quote', pickup: s.pickup, destination: place, city: s.city! });
    }
    const city = cityAt(place);
    if (!city) {
      const names = Object.values(SERVICE_AREAS).map((a) => a.name).join(' and ');
      return out(reset(s, now), text(`GoBye isn't available there yet. We're starting in ${names}. Send a pickup location in one of them.`));
    }
    return out(
      { stage: 'awaiting_destination', pickup: place, city, lastRideId: s.lastRideId ?? null, updatedAt: now },
      text(`Pickup: ${placeName(place)} ✓\n\nNow send your *destination*: ${PIN_HOW} → search the place and send it.`),
    );
  }

  if (input.kind === 'choice' && input.id.startsWith('ride:')) {
    if (s.stage !== 'choosing' || !s.options || !s.pickup || !s.destination) return out(reset(s, now), text('That choice has expired. Send your pickup location to start again.'));
    const option = s.options.find((o) => choiceIdFor(o.category) === input.id);
    if (!option) return out(s, optionsList(s, 'Please choose one of these rides.\n\n'));
    if (now - (s.quotedAt ?? 0) > ctx.quoteTtlMs) {
      // Prices are only honoured while the quote is valid: price again, then let the rider choose.
      return out({ ...s, stage: 'quoting', options: undefined, requoted: true }, null, { type: 'quote', pickup: s.pickup, destination: s.destination, city: s.city! });
    }
    return out({ ...s, stage: 'booking' }, null, { type: 'book', option, pickup: s.pickup, destination: s.destination, city: s.city! });
  }

  if (s.stage === 'awaiting_destination') return out(s, text(`Please send your destination as a location pin: ${PIN_HOW} → search the place and send it.`));
  if (s.stage === 'choosing') return out(s, optionsList(s, 'Tap "Choose ride" to pick one, or reply CANCEL.\n\n'));
  if (input.kind === 'unsupported') return out(s, text(`I can read location pins and short replies. To book, send your pickup location: ${PIN_HOW}.`));
  return out(s, greeting(ctx));
}

/** For the server: is this option one the conversation offered (never trust a client-sent fare)? */
export function isOfferedOption(s: WaSession, o: WaRideOption): boolean {
  return (s.options ?? []).some((x) => x.quoteId === o.quoteId && x.fare === o.fare && x.category === o.category);
}
