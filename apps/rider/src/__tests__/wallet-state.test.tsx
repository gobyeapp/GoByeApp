import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { createMockServices, naira, seededRandom, type GoByeServices } from '@gobye/core';
import { ServicesProvider } from '@/state/services';
import { WalletProvider, useWallet } from '@/state/wallet';

/** Brief §10: a deposit is Pending until confirmed — never credited because the passenger tapped. */
let wallet: ReturnType<typeof useWallet>;
function Probe() {
  wallet = useWallet();
  return null;
}

async function flush(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function mount(services: GoByeServices) {
  await render(
    <ServicesProvider services={services}>
      <WalletProvider>
        <Probe />
      </WalletProvider>
    </ServicesProvider>,
  );
  for (let i = 0; i < 10; i++) await flush(200);
}

async function run<T>(p: Promise<T>): Promise<T> {
  let out!: T;
  const done = p.then((v) => (out = v));
  for (let i = 0; i < 20; i++) await flush(200);
  await done;
  return out;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
});
afterEach(() => jest.useRealTimers());

test('deposit stays pending on an immediate check, then becomes available once confirmed', async () => {
  const services = createMockServices({ random: seededRandom(7), flags: { depositFailureRate: 0 } });
  await mount(services);
  expect(wallet.state).toBe('ready');
  const before = wallet.available;

  const ins = await run(wallet.startDeposit(naira(5000)));
  expect(ins.amount).toBe(naira(5000));
  expect(wallet.pendingIn).toBeGreaterThanOrEqual(naira(5000));
  expect(wallet.available).toBe(before);

  // "I've sent it" immediately: still pending, nothing credited.
  const first = await run(wallet.checkDeposit(ins.transactionId));
  expect(first).toBe('pending');
  expect(wallet.available).toBe(before);

  await flush(5000);
  const second = await run(wallet.checkDeposit(ins.transactionId));
  expect(second).toBe('successful');
  expect(wallet.available).toBe(before + naira(5000));
});

test('a failed deposit is never credited', async () => {
  const services = createMockServices({ random: seededRandom(7), flags: { depositFailureRate: 1 } });
  await mount(services);
  const before = wallet.available;
  const ins = await run(wallet.startDeposit(naira(2000)));
  await flush(5000);
  expect(await run(wallet.checkDeposit(ins.transactionId))).toBe('failed');
  expect(wallet.available).toBe(before);
});
