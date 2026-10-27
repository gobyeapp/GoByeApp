import {
  CANCEL_CHOICE,
  SESSION_IDLE_MS,
  choiceIdFor,
  cityAt,
  isOfferedOption,
  kobo,
  LIMITS,
  parseWebhook,
  step,
  toCloudApiMessage,
  type WaContext,
  type WaInput,
  type WaRideOption,
  type WaSession,
  type WaStep,
} from '../index';

const T0 = 1_800_000_000_000;
const LEKKI = { latitude: 6.4474, longitude: 3.4723, label: 'Lekki Phase 1' };
const IKEJA = { latitude: 6.6018, longitude: 3.3515, label: 'Ikeja City Mall, Obafemi Awolowo Way' };
const IBADAN = { latitude: 7.3775, longitude: 3.947, label: 'Ibadan' };
const OPTIONS: WaRideOption[] = [
  { category: 'keke', quoteId: 'q-keke', fare: kobo(180_000), simulated: true },
  { category: 'go', quoteId: 'q-go', fare: kobo(420_000), simulated: true },
];

function ctx(over: Partial<WaContext> = {}): WaContext {
  return {
    now: T0,
    account: { kind: 'rider', userId: 'u1', firstName: 'Ada' },
    openRideId: null,
    links: { signUp: 'https://gobye.app/open/signup', openRide: (id) => `https://gobye.app/open/ride/${id}`, openApp: 'https://gobye.app/open' },
    quoteTtlMs: 5 * 60_000,
    ...over,
  };
}

/** Runs the rider's inputs, answering effects the way the server would. */
function run(inputs: WaInput[], c: WaContext = ctx(), start: WaSession | null = null) {
  let s = start;
  const steps: WaStep[] = [];
  for (const i of inputs) {
    const r = step(s, i, c);
    steps.push(r);
    s = r.session;
  }
  return { session: s!, steps, last: steps[steps.length - 1]! };
}

describe('WhatsApp quick booking conversation (D-064)', () => {
  it('pickup pin → destination pin → quote effect → fare list → choice → book effect → booked link', () => {
    const a = run([{ kind: 'location', place: LEKKI }]);
    expect(a.session.stage).toBe('awaiting_destination');
    expect(a.session.city).toBe('lagos');
    expect(a.last.reply).toMatchObject({ type: 'text' });
    expect((a.last.reply as { body: string }).body).toContain('destination');

    const b = run([{ kind: 'location', place: IKEJA }], ctx(), a.session);
    expect(b.session.stage).toBe('quoting');
    expect(b.last.reply).toBeNull();
    expect(b.last.effect).toEqual({ type: 'quote', pickup: LEKKI, destination: IKEJA, city: 'lagos' });

    const q = run([{ kind: 'quoted', options: OPTIONS, distanceMeters: 21_400, durationSeconds: 2_700 }], ctx(), b.session);
    expect(q.session.stage).toBe('choosing');
    const list = q.last.reply as Extract<WaStep['reply'], { type: 'list' }>;
    expect(list.type).toBe('list');
    expect(list.rows.map((r) => r.id)).toEqual(['ride:keke', 'ride:go', CANCEL_CHOICE]);
    expect(list.rows[1]!.description).toContain('₦4,200');
    expect(list.rows[1]!.description).toContain('test fare'); // simulated routes are labelled
    expect(list.body).toContain('pay after the trip');

    const c = run([{ kind: 'choice', id: choiceIdFor('go') }], ctx({ now: T0 + 60_000 }), q.session);
    expect(c.session.stage).toBe('booking');
    expect(c.last.effect).toMatchObject({ type: 'book', option: OPTIONS[1], city: 'lagos' });
    expect(isOfferedOption(c.session, OPTIONS[1]!)).toBe(true);
    expect(isOfferedOption(c.session, { ...OPTIONS[1]!, fare: kobo(100) })).toBe(false);

    const d = run([{ kind: 'booked', rideId: 'ride-1', option: OPTIONS[1]! }], ctx({ now: T0 + 61_000 }), c.session);
    expect(d.session).toMatchObject({ stage: 'idle', lastRideId: 'ride-1' });
    expect(d.last.reply).toMatchObject({ type: 'link', url: 'https://gobye.app/open/ride/ride-1', buttonText: 'Open GoBye' });
    expect((d.last.reply as { body: string }).body).toContain('in the GoBye app');
  });

  it('a number without a GoBye account gets the sign-up link and never a booking', () => {
    const r = run([{ kind: 'location', place: LEKKI }], ctx({ account: { kind: 'unknown' } }));
    expect(r.last.effect).toBeNull();
    expect(r.last.reply).toMatchObject({ type: 'link', url: 'https://gobye.app/open/signup' });
    expect(r.session.stage).toBe('idle');
  });

  it('a suspended account cannot book', () => {
    const r = run([{ kind: 'text', text: 'hi' }], ctx({ account: { kind: 'blocked' } }));
    expect(r.last.effect).toBeNull();
    expect((r.last.reply as { body: string }).body).toContain("can't book");
  });

  it('pickup outside the launch cities is refused with the cities named', () => {
    const r = run([{ kind: 'location', place: IBADAN }]);
    expect(r.session.stage).toBe('idle');
    expect((r.last.reply as { body: string }).body).toMatch(/Lagos and Abuja/);
    expect(cityAt(IBADAN)).toBeNull();
    expect(cityAt({ latitude: 9.0579, longitude: 7.4951 })).toBe('abuja');
  });

  it('a destination on top of the pickup, or over 100 km away, is refused', () => {
    const a = run([{ kind: 'location', place: LEKKI }, { kind: 'location', place: { ...LEKKI, latitude: LEKKI.latitude + 0.0005 } }]);
    expect(a.last.effect).toBeNull();
    expect(a.session.stage).toBe('awaiting_destination');
    const b = run([{ kind: 'location', place: LEKKI }, { kind: 'location', place: IBADAN }]);
    expect(b.last.effect).toBeNull();
    expect((b.last.reply as { body: string }).body).toContain('100 km');
  });

  it('an expired quote is priced again before booking (prices are honoured only while valid)', () => {
    const q = run([{ kind: 'location', place: LEKKI }, { kind: 'location', place: IKEJA }, { kind: 'quoted', options: OPTIONS, distanceMeters: 21_400, durationSeconds: 2_700 }]);
    const late = run([{ kind: 'choice', id: choiceIdFor('keke') }], ctx({ now: T0 + 6 * 60_000 }), q.session);
    expect(late.last.effect).toMatchObject({ type: 'quote' });
    expect(late.session).toMatchObject({ stage: 'quoting', requoted: true });
    const again = run([{ kind: 'quoted', options: OPTIONS, distanceMeters: 21_400, durationSeconds: 2_700 }], ctx({ now: T0 + 6 * 60_000 }), late.session);
    expect((again.last.reply as { body: string }).body).toContain('Fares were updated');
  });

  it('only offered rides can be chosen; a stale choice after a reset restarts', () => {
    const q = run([{ kind: 'location', place: LEKKI }, { kind: 'location', place: IKEJA }, { kind: 'quoted', options: OPTIONS, distanceMeters: 21_400, durationSeconds: 2_700 }]);
    const xl = run([{ kind: 'choice', id: choiceIdFor('xl') }], ctx(), q.session);
    expect(xl.last.effect).toBeNull();
    expect(xl.last.reply).toMatchObject({ type: 'list' });
    const stale = run([{ kind: 'choice', id: choiceIdFor('go') }], ctx(), { stage: 'idle', updatedAt: T0 });
    expect(stale.last.effect).toBeNull();
    expect((stale.last.reply as { body: string }).body).toContain('expired');
  });

  it('CANCEL before booking resets; after booking it cancels only the ride booked here', () => {
    const a = run([{ kind: 'location', place: LEKKI }, { kind: 'text', text: ' Cancel ' }]);
    expect(a.session.stage).toBe('idle');
    expect(a.last.effect).toBeNull();

    const booked: WaSession = { stage: 'idle', lastRideId: 'ride-1', updatedAt: T0 };
    const b = run([{ kind: 'text', text: 'CANCEL' }], ctx({ openRideId: 'ride-1' }), booked);
    expect(b.last.effect).toEqual({ type: 'cancel', rideId: 'ride-1' });
    const done = run([{ kind: 'cancel_result', ok: true }], ctx(), b.session);
    expect((done.last.reply as { body: string }).body).toContain('No fee');
    expect(done.session.lastRideId).toBeNull();

    const late = run([{ kind: 'cancel_result', ok: false, reason: 'too_late' }], ctx(), b.session);
    expect(late.last.reply).toMatchObject({ type: 'link' });

    // A ride booked in the app is not cancelled from WhatsApp.
    const app = run([{ kind: 'text', text: 'cancel' }], ctx({ openRideId: 'ride-app' }), { stage: 'idle', lastRideId: null, updatedAt: T0 });
    expect(app.last.effect).toBeNull();
    expect(app.last.reply).toMatchObject({ type: 'link', url: 'https://gobye.app/open/ride/ride-app' });
  });

  it('with a ride already open, a new pin sends the rider to the app instead of booking again', () => {
    const r = run([{ kind: 'location', place: LEKKI }], ctx({ openRideId: 'ride-9' }));
    expect(r.last.effect).toBeNull();
    expect(r.last.reply).toMatchObject({ type: 'link', url: 'https://gobye.app/open/ride/ride-9' });
    const failed = run([{ kind: 'book_failed', reason: 'open_ride', openRideId: 'ride-9' }]);
    expect(failed.last.reply).toMatchObject({ type: 'link' });
  });

  it('a conversation idle for 15 minutes starts again; one in flight waits', () => {
    const a = run([{ kind: 'location', place: LEKKI }]);
    const b = run([{ kind: 'location', place: IKEJA }], ctx({ now: T0 + SESSION_IDLE_MS + 1 }), a.session);
    expect(b.session.stage).toBe('awaiting_destination'); // Ikeja became the new pickup
    expect(b.session.pickup).toEqual(IKEJA);
    const busy = run([{ kind: 'text', text: 'hello?' }], ctx(), { stage: 'booking', updatedAt: T0 });
    expect((busy.last.reply as { body: string }).body).toBe('One moment…');
  });

  it('greets, explains, and handles unsupported messages', () => {
    const r = run([{ kind: 'text', text: 'Hi' }]);
    expect((r.last.reply as { body: string }).body).toContain('Hi Ada');
    const u = run([{ kind: 'unsupported' }]);
    expect((u.last.reply as { body: string }).body).toContain('location pins');
    const d = run([{ kind: 'location', place: LEKKI }, { kind: 'text', text: 'Ikeja mall' }]);
    expect((d.last.reply as { body: string }).body).toContain('location pin');
  });
});

describe('WhatsApp Cloud API formats', () => {
  const webhook = (messages: unknown[], phoneNumberId = 'PNID') => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: '2348030000001' }], messages } }] }],
  });

  it('parses location, text, list and button replies; ignores statuses, other numbers and junk', () => {
    const body = webhook([
      { from: '2348030000001', id: 'wamid.AAA111', timestamp: '1800000000', type: 'location', location: { latitude: 6.4474, longitude: 3.4723, name: 'Lekki Phase 1', address: 'Admiralty Way' } },
      { from: '2348030000001', id: 'wamid.AAA112', timestamp: '1800000001', type: 'text', text: { body: 'cancel' } },
      { from: '2348030000001', id: 'wamid.AAA113', timestamp: '1800000002', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'ride:go', title: 'GoBye Car' } } },
      { from: '2348030000001', id: 'wamid.AAA114', timestamp: '1800000003', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'cancel', title: 'Cancel' } } },
      { from: '2348030000001', id: 'wamid.AAA115', timestamp: '1800000004', type: 'image', image: { id: 'x' } },
      { from: '2348030000001', id: 'wamid.AAA116', timestamp: '1800000005', type: 'location', location: { latitude: 6.6, longitude: 3.35 } },
      { from: 'not-a-number', id: 'wamid.BAD', timestamp: '1', type: 'text', text: { body: 'x' } },
      { from: '2348030000001', type: 'text', text: { body: 'no id' } },
    ]);
    const m = parseWebhook(body, 'PNID');
    expect(m.map((x) => x.input.kind)).toEqual(['location', 'text', 'choice', 'choice', 'unsupported', 'location']);
    expect(m[0]).toMatchObject({ messageId: 'wamid.AAA111', waId: '2348030000001', timestamp: 1_800_000_000, input: { place: { label: 'Lekki Phase 1, Admiralty Way' } } });
    expect(m[5]!.input).toMatchObject({ place: { label: 'Pinned location (6.6000, 3.3500)' } });
    expect(parseWebhook(body, 'OTHER')).toEqual([]);
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook(webhook([]))).toEqual([]);
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.S', status: 'read' }] } }] }] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });

  it('builds messages within WhatsApp limits', () => {
    const long = 'x'.repeat(2000);
    const list = toCloudApiMessage('2348030000001', {
      type: 'list',
      body: long,
      button: 'Choose your ride please now',
      rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `A very long ride title ${i}`, description: long })),
    }) as { interactive: { body: { text: string }; action: { button: string; sections: { rows: { title: string; description: string }[] }[] } } };
    expect(list.interactive.body.text.length).toBe(LIMITS.body);
    expect(list.interactive.action.button.length).toBeLessThanOrEqual(LIMITS.listButton);
    expect(list.interactive.action.sections[0]!.rows).toHaveLength(LIMITS.rows);
    for (const r of list.interactive.action.sections[0]!.rows) {
      expect(r.title.length).toBeLessThanOrEqual(LIMITS.rowTitle);
      expect(r.description.length).toBeLessThanOrEqual(LIMITS.rowDescription);
    }
    expect(toCloudApiMessage('2348030000001', { type: 'link', body: 'Booked', buttonText: 'Open GoBye', url: 'https://gobye.app/open/ride/1' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '2348030000001',
      type: 'interactive',
      interactive: { type: 'cta_url', body: { text: 'Booked' }, action: { name: 'cta_url', parameters: { display_text: 'Open GoBye', url: 'https://gobye.app/open/ride/1' } } },
    });
    expect(toCloudApiMessage('1', { type: 'text', body: 'hi' })).toMatchObject({ type: 'text', text: { body: 'hi', preview_url: false } });
  });
});
