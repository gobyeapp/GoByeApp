import type { AudienceFilter, Announcement, CampaignStatus, Channel, CityId, ConnectionState, EventPartnership, IntegrationRecord, PlatformDataset, PromoCampaign } from '@gobye/core';

/**
 * Pure logic for the growth workspace: audience counting, message checks, delivery simulation,
 * promotional card rules and event results. No React here; everything is unit tested.
 */

export const ALL_CITIES: CityId[] = ['lagos', 'abuja'];
export const CHANNELS: Channel[] = ['inbox', 'push', 'email', 'sms'];
export const CHANNEL_LABEL: Record<Channel, string> = { inbox: 'In app inbox', push: 'Push', email: 'Email', sms: 'SMS' };

/* ---------- Audience ---------- */

export const PASSENGER_STATUSES = ['active', 'restricted'] as const;
export const DRIVER_STATUSES = ['approved', 'in_review', 'documents_pending', 'applied', 'suspended', 'rejected'] as const;

/**
 * Event participation, derived from trips: someone took (or drove) a trip in the event's city
 * during the event window. There is no explicit event attendance record in the dataset yet.
 */
export function eventParticipants(d: Pick<PlatformDataset, 'trips' | 'events'>, eventId: string): { passengers: Set<string>; drivers: Set<string> } {
  const e = d.events.find((x) => x.id === eventId);
  const passengers = new Set<string>();
  const drivers = new Set<string>();
  if (!e) return { passengers, drivers };
  for (const t of d.trips) {
    if (t.city !== e.city || t.requestedAt < e.startsAt || t.requestedAt > e.endsAt) continue;
    passengers.add(t.passengerId);
    if (t.driverId) drivers.add(t.driverId);
  }
  return { passengers, drivers };
}

export interface AudienceCount {
  total: number;
  /** People each channel can reach before personal preferences (email needs an address). */
  reach: Record<Channel, number>;
}

export function countAudience(d: Pick<PlatformDataset, 'passengers' | 'drivers' | 'trips' | 'events'>, f: AudienceFilter, now: number): AudienceCount {
  const cities = new Set(f.cities);
  const statuses = f.statuses?.length ? new Set(f.statuses) : null;
  const ev = f.eventId ? eventParticipants(d, f.eventId) : null;
  if (f.type === 'passenger') {
    const xs = d.passengers.filter((p) => cities.has(p.city) && p.status !== 'closed' && (!statuses || statuses.has(p.status)) && (!ev || ev.passengers.has(p.id)));
    return { total: xs.length, reach: { inbox: xs.length, push: xs.length, sms: xs.filter((p) => !!p.phone).length, email: xs.filter((p) => !!p.email).length } };
  }
  const pk = f.packages?.length ? new Set(f.packages) : null;
  const xs = d.drivers.filter(
    (x) => cities.has(x.city) && (!statuses || statuses.has(x.verification)) && (!pk || (x.access && x.access.expiresAt > now && pk.has(x.access.packageId))) && (!ev || ev.drivers.has(x.id)),
  );
  // Driver records hold no email address, so email reaches nobody.
  return { total: xs.length, reach: { inbox: xs.length, push: xs.length, sms: xs.filter((x) => !!x.phone).length, email: 0 } };
}

/** "All users" of a type: every city and no narrowing filter. */
export function isAllUsers(f: AudienceFilter): boolean {
  return ALL_CITIES.every((c) => f.cities.includes(c)) && !f.statuses?.length && !f.packages?.length && !f.eventId;
}

/** APPROVAL_RULES.announcement: messages to all users, or any SMS. */
export function announcementNeedsApproval(a: Pick<Announcement, 'channels' | 'audience'>): boolean {
  return a.channels.includes('sms') || isAllUsers(a.audience);
}

export function describeAudience(f: AudienceFilter, eventName?: string): string {
  const who = f.type === 'passenger' ? 'Passengers' : 'Drivers';
  const where = isAllCities(f.cities) ? 'all cities' : f.cities.map((c) => (c === 'lagos' ? 'Lagos' : 'Abuja')).join(' and ') || 'no city';
  const parts = [`${who} in ${where}`];
  if (f.statuses?.length) parts.push(f.statuses.map((s) => s.replace(/_/g, ' ')).join(' or '));
  if (f.packages?.length) parts.push(`${f.packages.join(' or ')} pass`);
  if (f.eventId) parts.push(`went to ${eventName ?? 'event'}`);
  return parts.join(' · ');
}
const isAllCities = (c: CityId[]) => ALL_CITIES.every((x) => c.includes(x));

/* ---------- Message checks ---------- */

export const TITLE_MAX = 60;
export const BODY_MAX = 480;

// GSM 03.38 basic set (plus the extension table, which costs two characters each).
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = '^{}\\[~]|€';

/** SMS segment estimate: GSM 7 bit (160, or 153 per part) unless any character needs Unicode (70, or 67). */
export function smsSegments(text: string): { encoding: 'GSM' | 'Unicode'; length: number; segments: number; perSegment: number } {
  const chars = [...text];
  const unicode = chars.some((c) => !GSM.includes(c) && !GSM_EXT.includes(c));
  const length = unicode ? chars.length : chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
  if (length === 0) return { encoding: unicode ? 'Unicode' : 'GSM', length, segments: 0, perSegment: unicode ? 70 : 160 };
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = length <= single ? 1 : Math.ceil(length / multi);
  return { encoding: unicode ? 'Unicode' : 'GSM', length, segments, perSegment: segments === 1 ? single : multi };
}

/** Visible copy must not use hyphens or dashes, or exclamation marks (house style). */
export function copyIssues(text: string): string[] {
  const out: string[] = [];
  if (/[-‐-―−]/.test(text)) out.push('Avoid hyphens and dashes.');
  if (text.includes('!')) out.push('Avoid exclamation marks.');
  return out;
}

export function validateAnnouncement(a: Pick<Announcement, 'title' | 'body' | 'channels' | 'audience'>): string[] {
  const e: string[] = [];
  if (!a.title.trim()) e.push('Add a title.');
  if (a.title.length > TITLE_MAX) e.push(`Title must be ${TITLE_MAX} characters or fewer.`);
  if (!a.body.trim()) e.push('Add a message.');
  if (a.body.length > BODY_MAX) e.push(`Message must be ${BODY_MAX} characters or fewer.`);
  if (!a.channels.length) e.push('Choose at least one channel.');
  if (!a.audience.cities.length) e.push('Choose at least one city.');
  return e;
}

/* ---------- Channels and delivery ---------- */

const CHANNEL_AREA: Record<Exclude<Channel, 'inbox'>, IntegrationRecord['area']> = { push: 'push', email: 'email', sms: 'sms' };

/** A channel can send only when its provider has passed tests (tested, live or degraded). */
export function channelState(integrations: readonly IntegrationRecord[], ch: Channel): { connected: boolean; state: ConnectionState | 'internal'; provider: string } {
  if (ch === 'inbox') return { connected: true, state: 'internal', provider: 'GoBye app inbox' };
  const xs = integrations.filter((i) => i.area === CHANNEL_AREA[ch]);
  const rank: ConnectionState[] = ['live', 'degraded', 'tested', 'configured', 'prototype'];
  const best = xs.sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state))[0];
  if (!best) return { connected: false, state: 'prototype', provider: 'Not chosen' };
  return { connected: best.state === 'live' || best.state === 'tested' || best.state === 'degraded', state: best.state, provider: best.provider };
}

export type ChannelResult = { attempted: number; delivered: number; failed: number };

/**
 * SIMULATED delivery. Inbox records are created directly. A channel whose provider isn't connected
 * queues jobs that fail with "provider not connected" (they go to the retry queue); nothing is sent.
 * A connected test provider delivers all but a deterministic few; a degraded one fails half.
 */
export function simulateDelivery(reach: number, ch: Channel, state: { connected: boolean; state: string }): ChannelResult {
  if (reach <= 0) return { attempted: 0, delivered: 0, failed: 0 };
  if (ch === 'inbox') return { attempted: reach, delivered: reach, failed: 0 };
  if (!state.connected) return { attempted: reach, delivered: 0, failed: reach };
  const failed = state.state === 'degraded' ? Math.ceil(reach / 2) : Math.floor(reach * 0.05);
  return { attempted: reach, delivered: reach - failed, failed };
}

/** Retrying failed jobs: same rules, applied only to the failed ones. */
export function simulateRetry(prev: ChannelResult, ch: Channel, state: { connected: boolean; state: string }): ChannelResult {
  const r = simulateDelivery(prev.failed, ch, state);
  return { attempted: prev.attempted + r.attempted, delivered: prev.delivered + r.delivered, failed: r.failed };
}

export function deliveryOutcome(delivery: Record<Channel, ChannelResult>, channels: Channel[]): 'sent' | 'partly_failed' {
  return channels.some((c) => delivery[c].failed > 0) ? 'partly_failed' : 'sent';
}

export type RetryItem = { announcement: Announcement; channel: 'email' | 'sms'; failed: number };
/** Failed email and SMS deliveries waiting for a retry. */
export function retryQueue(xs: readonly Announcement[]): RetryItem[] {
  return xs.flatMap((a) => (['email', 'sms'] as const).filter((c) => a.channels.includes(c) && a.delivery[c].failed > 0).map((channel) => ({ announcement: a, channel, failed: a.delivery[channel].failed })));
}

/** Copy edits after sending: the sent snapshot is what people received. */
export function editedSinceSent(a: Pick<Announcement, 'title' | 'body' | 'sentVersion'>): boolean {
  return !!a.sentVersion && (a.sentVersion.title !== a.title || a.sentVersion.body !== a.body);
}

/* ---------- Promotional cards ---------- */

export const PROMO_TITLE_MAX = 32;
export const PROMO_BODY_MAX = 64;
export const CTA_MAX = 20;
export const ART_KEYS: PromoCampaign['art'][] = ['sedan', 'gift', 'wallet', 'destination'];
/** Destinations that exist in the passenger app. */
export const CTA_ROUTES: { value: string; label: string }[] = [
  { value: '/(tabs)', label: 'Home (book a ride)' },
  { value: '/(tabs)/wallet', label: 'Wallet' },
  { value: '/(tabs)/wallet?add=1', label: 'Wallet: add money' },
  { value: '/account/rewards', label: 'Rewards and referrals' },
  { value: '/(tabs)/activity', label: 'Activities' },
  { value: '/booking/search', label: 'Where to (search)' },
];
export const INTERVAL_MIN = 3;
export const INTERVAL_MAX = 15;

export function validatePromo(c: Pick<PromoCampaign, 'title' | 'body' | 'ctaLabel' | 'ctaRoute' | 'placements' | 'startsAt' | 'endsAt' | 'art' | 'budget' | 'audience'>): string[] {
  const e: string[] = [];
  if (!c.title.trim()) e.push('Add a title.');
  if (c.title.length > PROMO_TITLE_MAX) e.push(`Title must be ${PROMO_TITLE_MAX} characters or fewer.`);
  if (!c.body.trim()) e.push('Add a short line of copy.');
  if (c.body.length > PROMO_BODY_MAX) e.push(`Copy must be ${PROMO_BODY_MAX} characters or fewer.`);
  if (!c.ctaLabel.trim()) e.push('Add a button label.');
  if (c.ctaLabel.length > CTA_MAX) e.push(`Button label must be ${CTA_MAX} characters or fewer.`);
  if (!CTA_ROUTES.some((r) => r.value === c.ctaRoute)) e.push('Choose a destination that exists in the app.');
  if (!c.placements.length) e.push('Choose Home, Wallet or both.');
  if (!ART_KEYS.includes(c.art)) e.push('Choose artwork.');
  if (!Number.isFinite(c.startsAt)) e.push('Set a start date.');
  if (c.endsAt !== undefined && !(c.endsAt > c.startsAt)) e.push('End date must be after the start date.');
  if (c.budget !== undefined && (!Number.isInteger(c.budget) || c.budget < 0)) e.push('Budget must be a whole amount of 0 or more.');
  if (!c.audience.cities.length) e.push('Choose at least one city.');
  for (const t of [c.title, c.body, c.ctaLabel]) for (const i of copyIssues(t)) if (!e.includes(i)) e.push(i);
  return e;
}

export function validateInterval(seconds: number): string[] {
  return Number.isInteger(seconds) && seconds >= INTERVAL_MIN && seconds <= INTERVAL_MAX ? [] : [`Interval must be ${INTERVAL_MIN} to ${INTERVAL_MAX} whole seconds.`];
}

/** Is a campaign on screen right now? Active and inside its dates. */
export function isShowing(c: Pick<PromoCampaign, 'status' | 'startsAt' | 'endsAt'>, now: number): boolean {
  return c.status === 'active' && c.startsAt <= now && (c.endsAt === undefined || c.endsAt > now);
}

/** What the passenger carousel shows now, in order. */
export function carouselFor(xs: readonly PromoCampaign[], placement: 'home' | 'wallet', now: number, city?: CityId): PromoCampaign[] {
  return xs.filter((c) => c.placements.includes(placement) && isShowing(c, now) && (!city || c.audience.cities.includes(city))).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Swap a campaign with its neighbour in carousel order. Returns new sort orders by id (1..n). */
export function moveInOrder(xs: readonly Pick<PromoCampaign, 'id' | 'sortOrder'>[], id: string, dir: -1 | 1): Record<string, number> | null {
  const sorted = [...xs].sort((a, b) => a.sortOrder - b.sortOrder);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return null;
  [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  return Object.fromEntries(sorted.map((c, k) => [c.id, k + 1]));
}

/** Status a campaign should get when switched on: future start → scheduled, otherwise active. */
export function activationTarget(c: Pick<PromoCampaign, 'startsAt'>, now: number): CampaignStatus {
  return c.startsAt > now ? 'scheduled' : 'active';
}

export const openRate = (c: Pick<PromoCampaign, 'impressions' | 'opens'>) => (c.impressions > 0 ? c.opens / c.impressions : 0);

/* ---------- Events ---------- */

export type EventStatus = EventPartnership['status'];
export const EVENT_FLOW: Record<EventStatus, readonly EventStatus[]> = { planned: ['live', 'ended'], live: ['ended'], ended: [] };

export function validateEvent(e: Pick<EventPartnership, 'name' | 'partner' | 'venue' | 'startsAt' | 'endsAt' | 'pickupZones' | 'sponsorship'>): string[] {
  const out: string[] = [];
  if (!e.name.trim()) out.push('Add an event name.');
  if (!e.partner.trim()) out.push('Add the partner.');
  if (!e.venue.trim()) out.push('Add the venue.');
  if (!Number.isFinite(e.startsAt) || !Number.isFinite(e.endsAt)) out.push('Set start and end times.');
  else if (e.endsAt <= e.startsAt) out.push('End must be after the start.');
  if (!e.pickupZones.length) out.push('Add at least one pickup zone.');
  if (e.sponsorship !== undefined && (!Number.isInteger(e.sponsorship) || e.sponsorship < 0)) out.push('Sponsorship must be a whole amount of 0 or more.');
  return out;
}

/** Trips in the event city during the event window, and campaigns linked by eventId. */
export function eventResults(d: Pick<PlatformDataset, 'trips' | 'campaigns' | 'announcements'>, e: EventPartnership) {
  const trips = d.trips.filter((t) => t.city === e.city && t.requestedAt >= e.startsAt && t.requestedAt <= e.endsAt);
  const completed = trips.filter((t) => t.status === 'completed');
  const campaigns = d.campaigns.filter((c) => c.audience.eventId === e.id);
  const announcements = d.announcements.filter((a) => a.audience.eventId === e.id);
  return {
    trips: trips.length,
    completed: completed.length,
    cancelled: trips.filter((t) => t.status === 'cancelled' || t.status === 'no_driver').length,
    campaigns,
    announcements,
    impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
    opens: campaigns.reduce((s, c) => s + c.opens, 0),
  };
}
