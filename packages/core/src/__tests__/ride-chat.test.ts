import { CHAT_MAX_LENGTH, CHAT_PHOTO_MAX_LENGTH, QUICK_REPLIES, cleanChatText, isChatPhoto, quickRepliesFor, createMemoryRelay, createRideChat, logRelayEvent, type ChatMessage } from '../index';

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe('ride chat over the demo connection (D-108)', () => {
  it('cleans a message and refuses empty or over-long ones', () => {
    expect(cleanChatText('  I’m   at the\n gate ')).toEqual({ ok: true, value: 'I’m at the gate' });
    expect(cleanChatText('   ').ok).toBe(false);
    expect(cleanChatText('x'.repeat(CHAT_MAX_LENGTH + 1)).ok).toBe(false);
    expect(cleanChatText('x'.repeat(CHAT_MAX_LENGTH)).ok).toBe(true);
  });

  it('both sides see the same conversation, in order, for their ride only', async () => {
    const relay = createMemoryRelay();
    let t = 1000;
    const now = () => (t += 10);
    const rider = createRideChat(relay, { rideId: 'ride-1', me: 'rider', pollMs: 10, now });
    const driver = createRideChat(relay, { rideId: 'ride-1', me: 'driver', pollMs: 10, now });
    const other = createRideChat(relay, { rideId: 'ride-2', me: 'rider', pollMs: 10, now });
    // Ordinary activity lines on the same ride are not messages.
    logRelayEvent(relay, { actor: 'driver', type: 'ride.accepted', summary: 'Tunde accepted the ride', ride_id: 'ride-1' });

    let seenByDriver: ChatMessage[] = [];
    let seenByOther: ChatMessage[] = [{ id: 'x', from: 'rider', text: 'x', at: 0 }];
    const stop1 = driver.watch((m) => (seenByDriver = m));
    const stop2 = other.watch((m) => (seenByOther = m));
    expect((await rider.send('I’m at the gate')).ok).toBe(true);
    expect((await driver.send('Two minutes away')).ok).toBe(true);
    expect((await rider.send('   ')).ok).toBe(false);
    await tick(60);
    stop1();
    stop2();
    expect(seenByDriver.map((m) => [m.from, m.text])).toEqual([['rider', 'I’m at the gate'], ['driver', 'Two minutes away']]);
    expect(seenByOther).toEqual([]);
    expect(JSON.stringify(relay.tables.demo_events)).not.toMatch(/\+234|080/);
  });

  it('says so when a message could not be sent', async () => {
    const relay = createMemoryRelay();
    relay.insert = async () => {
      throw new Error('offline');
    };
    const r = await createRideChat(relay, { rideId: 'r', me: 'rider' }).send('Hello');
    expect(r).toEqual({ ok: false, error: 'Not sent. Check your connection and try again.' });
  });

  it('offers answers when the other person asks where you are', () => {
    const m = (from: 'rider' | 'driver', text: string): ChatMessage => ({ id: text, from, text, at: 0 });
    expect(quickRepliesFor('rider', [])).toBe(QUICK_REPLIES.rider);
    expect(quickRepliesFor('rider', [m('driver', 'Where exactly are you?')])).toContain('I’m at the gate');
    expect(quickRepliesFor('driver', [m('rider', 'Where are you?')])).toContain('Two minutes away');
    // My own question doesn't change my buttons, and an answered question goes back to the usual set.
    expect(quickRepliesFor('driver', [m('driver', 'Where exactly are you?')])).toBe(QUICK_REPLIES.driver);
    expect(quickRepliesFor('rider', [m('driver', 'Where exactly are you?'), m('rider', 'I’m at the gate')])).toBe(QUICK_REPLIES.rider);
  });

  it('a photo message is a small JPEG and nothing else', async () => {
    const jpeg = `data:image/jpeg;base64,${'A'.repeat(400)}==`;
    expect(isChatPhoto(jpeg)).toBe(true);
    expect(isChatPhoto(`data:image/jpeg;base64,${'A'.repeat(CHAT_PHOTO_MAX_LENGTH)}`)).toBe(false);
    for (const bad of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,AAA"onerror="x', 'https://example.com/a.jpg', 'javascript:alert(1)']) expect(isChatPhoto(bad)).toBe(false);

    const relay = createMemoryRelay();
    const rider = createRideChat(relay, { rideId: 'r', me: 'rider', pollMs: 10 });
    const driver = createRideChat(relay, { rideId: 'r', me: 'driver', pollMs: 10 });
    expect((await rider.sendPhoto(jpeg)).ok).toBe(true);
    expect((await rider.sendPhoto('data:text/html;base64,PHNjcmlwdD4=')).ok).toBe(false);
    expect((await rider.send('data:text/html;base64,PHNjcmlwdD4=')).ok).toBe(false);
    // Something that got into the table another way is never shown as a picture.
    await relay.insert('demo_events', { id: 'bad', at: Date.now() + 5, actor: 'rider', type: 'chat', summary: 'data:image/svg+xml;base64,PHN2Zz4=', ride_id: 'r', person_id: null });
    let seen: ChatMessage[] = [];
    const stop = driver.watch((m) => (seen = m));
    await tick(50);
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ from: 'rider', text: '', image: jpeg });
  });
});

