import { CHAT_MAX_LENGTH, cleanChatText, createMemoryRelay, createRideChat, logRelayEvent, type ChatMessage } from '../index';

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
});
