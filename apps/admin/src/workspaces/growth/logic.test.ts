import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type AudienceFilter, type PromoCampaign } from '@gobye/core';
import {
  activationTarget,
  announcementNeedsApproval,
  carouselFor,
  channelState,
  copyIssues,
  countAudience,
  deliveryOutcome,
  editedSinceSent,
  eventResults,
  isAllUsers,
  moveInOrder,
  retryQueue,
  simulateDelivery,
  simulateRetry,
  smsSegments,
  validateAnnouncement,
  validateEvent,
  validateInterval,
  validatePromo,
} from './logic';

const d = createPlatformDataset();
const now = d.generatedAt;
const DAY = 86_400_000;

describe('audience', () => {
  it('counts passengers by city and status', () => {
    const all: AudienceFilter = { type: 'passenger', cities: ['lagos', 'abuja'] };
    const a = countAudience(d, all, now);
    expect(a.total).toBe(d.passengers.filter((p) => p.status !== 'closed').length);
    expect(a.reach.email).toBe(d.passengers.filter((p) => p.email).length);
    const lagos = countAudience(d, { ...all, cities: ['lagos'] }, now).total;
    const abuja = countAudience(d, { ...all, cities: ['abuja'] }, now).total;
    expect(lagos + abuja).toBe(a.total);
    expect(countAudience(d, { ...all, statuses: ['restricted'] }, now).total).toBe(2);
  });
  it('counts drivers by verification and active package; email reaches no drivers', () => {
    const f: AudienceFilter = { type: 'driver', cities: ['lagos', 'abuja'], statuses: ['approved'] };
    const c = countAudience(d, f, now);
    expect(c.total).toBe(d.drivers.filter((x) => x.verification === 'approved').length);
    expect(c.reach.email).toBe(0);
    const monthly = countAudience(d, { ...f, packages: ['monthly'] }, now).total;
    expect(monthly).toBe(d.drivers.filter((x) => x.verification === 'approved' && x.access?.packageId === 'monthly' && x.access.expiresAt > now).length);
  });
  it('event participation narrows to trips in the event window', () => {
    const e = d.events.find((x) => x.id === 'evt-0002')!;
    const c = countAudience(d, { type: 'passenger', cities: ['abuja'], eventId: e.id }, now).total;
    const expected = new Set(d.trips.filter((t) => t.city === 'abuja' && t.requestedAt >= e.startsAt && t.requestedAt <= e.endsAt).map((t) => t.passengerId)).size;
    expect(c).toBe(expected);
  });
  it('needs approval for all users or any SMS', () => {
    expect(isAllUsers({ type: 'passenger', cities: ['lagos', 'abuja'] })).toBe(true);
    expect(isAllUsers({ type: 'passenger', cities: ['lagos'] })).toBe(false);
    expect(announcementNeedsApproval({ channels: ['inbox'], audience: { type: 'passenger', cities: ['lagos', 'abuja'] } })).toBe(true);
    expect(announcementNeedsApproval({ channels: ['inbox', 'sms'], audience: { type: 'passenger', cities: ['lagos'] } })).toBe(true);
    expect(announcementNeedsApproval({ channels: ['inbox', 'push'], audience: { type: 'passenger', cities: ['lagos'] } })).toBe(false);
  });
});

describe('messages', () => {
  it('estimates SMS segments for GSM and Unicode', () => {
    expect(smsSegments('')).toMatchObject({ segments: 0 });
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM', segments: 1 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ encoding: 'GSM', segments: 2, perSegment: 153 });
    expect(smsSegments('Daily access stays ₦1,500')).toMatchObject({ encoding: 'Unicode', segments: 1 });
    expect(smsSegments('₦'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(smsSegments('{}').length).toBe(4);
  });
  it('flags hyphens, dashes and exclamation marks', () => {
    expect(copyIssues('Top-up now!')).toEqual(['Avoid hyphens and dashes.', 'Avoid exclamation marks.']);
    expect(copyIssues('Add money')).toEqual([]);
  });
  it('validates announcements', () => {
    expect(validateAnnouncement({ title: '', body: '', channels: [], audience: { type: 'passenger', cities: [] } })).toHaveLength(4);
    expect(validateAnnouncement({ title: 'Hi', body: 'There', channels: ['inbox'], audience: { type: 'passenger', cities: ['lagos'] } })).toEqual([]);
  });
  it('knows when copy changed after sending', () => {
    const sent = d.announcements.find((a) => a.id === 'ann-0001')!;
    expect(editedSinceSent(sent)).toBe(false);
    expect(editedSinceSent({ ...sent, body: 'New' })).toBe(true);
  });
});

describe('delivery simulation', () => {
  it('reads channel state from integrations: nothing in test data can send email or SMS', () => {
    expect(channelState(d.integrations, 'inbox').connected).toBe(true);
    expect(channelState(d.integrations, 'email')).toMatchObject({ connected: false, state: 'prototype' });
    expect(channelState(d.integrations, 'sms')).toMatchObject({ connected: false, state: 'prototype' });
    expect(channelState(d.integrations, 'push')).toMatchObject({ connected: false, state: 'configured' });
  });
  it('fails jobs for unconnected providers and keeps them failed on retry', () => {
    const off = { connected: false, state: 'prototype' };
    const r = simulateDelivery(20, 'sms', off);
    expect(r).toEqual({ attempted: 20, delivered: 0, failed: 20 });
    expect(simulateRetry(r, 'sms', off)).toEqual({ attempted: 40, delivered: 0, failed: 20 });
    expect(simulateDelivery(20, 'inbox', { connected: true, state: 'internal' })).toEqual({ attempted: 20, delivered: 20, failed: 0 });
    const on = { connected: true, state: 'tested' };
    expect(simulateDelivery(40, 'email', on)).toEqual({ attempted: 40, delivered: 38, failed: 2 });
    expect(simulateRetry({ attempted: 40, delivered: 38, failed: 2 }, 'email', on)).toEqual({ attempted: 42, delivered: 40, failed: 0 });
  });
  it('builds the retry queue from failed email and SMS only', () => {
    const q = retryQueue(d.announcements);
    expect(q.map((x) => [x.announcement.id, x.channel, x.failed])).toEqual([['ann-0002', 'sms', 22]]);
    const ann = d.announcements.find((a) => a.id === 'ann-0002')!;
    expect(deliveryOutcome(ann.delivery, ann.channels)).toBe('partly_failed');
  });
});

describe('promotional cards', () => {
  const base: PromoCampaign = d.campaigns[0]!;
  it('validates copy limits, destination and dates', () => {
    expect(validatePromo(base)).toEqual([]);
    const bad = validatePromo({ ...base, title: 'x'.repeat(33), body: 'y'.repeat(65), ctaRoute: '/nowhere', placements: [], endsAt: base.startsAt - 1 });
    expect(bad).toEqual(expect.arrayContaining(['Title must be 32 characters or fewer.', 'Copy must be 64 characters or fewer.', 'Choose a destination that exists in the app.', 'Choose Home, Wallet or both.', 'End date must be after the start date.']));
    expect(validatePromo({ ...base, title: 'Top-up today!' })).toEqual(expect.arrayContaining(['Avoid hyphens and dashes.', 'Avoid exclamation marks.']));
  });
  it('shows active campaigns inside their dates, in order, per placement', () => {
    expect(carouselFor(d.campaigns, 'home', now).map((c) => c.id)).toEqual(['referral', 'wallet-topup', 'book-for-others']);
    expect(carouselFor(d.campaigns, 'wallet', now).map((c) => c.id)).toEqual(['referral', 'wallet-topup']);
    expect(carouselFor(d.campaigns, 'home', now, 'abuja').map((c) => c.id)).toEqual(['referral', 'wallet-topup']);
    const ended = d.campaigns.map((c) => (c.id === 'referral' ? { ...c, endsAt: now - 1 } : c));
    expect(carouselFor(ended, 'home', now).map((c) => c.id)).not.toContain('referral');
  });
  it('moves a campaign up or down', () => {
    expect(moveInOrder(d.campaigns, 'wallet-topup', -1)).toEqual({ 'wallet-topup': 1, referral: 2, 'book-for-others': 3, 'detty-december': 4 });
    expect(moveInOrder(d.campaigns, 'referral', -1)).toBeNull();
    expect(moveInOrder(d.campaigns, 'detty-december', 1)).toBeNull();
  });
  it('schedules future starts and checks the interval', () => {
    expect(activationTarget({ startsAt: now + DAY }, now)).toBe('scheduled');
    expect(activationTarget({ startsAt: now - DAY }, now)).toBe('active');
    expect(validateInterval(6)).toEqual([]);
    expect(validateInterval(2)).toHaveLength(1);
    expect(validateInterval(16)).toHaveLength(1);
    expect(validateInterval(4.5)).toHaveLength(1);
  });
});

describe('events', () => {
  it('validates and links results', () => {
    const e = d.events[0]!;
    expect(validateEvent(e)).toEqual([]);
    expect(validateEvent({ ...e, endsAt: e.startsAt, pickupZones: [] })).toEqual(['End must be after the start.', 'Add at least one pickup zone.']);
    const r = eventResults(d, e);
    expect(r.campaigns.map((c) => c.id)).toEqual(['detty-december']);
    const ended = eventResults(d, d.events[1]!);
    expect(ended.trips).toBeGreaterThanOrEqual(ended.completed);
  });
});
