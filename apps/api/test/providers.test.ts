import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { missingCapabilities } from '@gobye/core';
import { testConfig } from '../src/config/config';
import { AppError } from '../src/common/errors';
import { fakeMaps, logNotifications, notConfiguredMaps, notConfiguredNotifications, notConfiguredStorage, providersFromConfig, r2Storage } from '../src/providers/providers';

const notConfigured = (e: unknown) => e instanceof AppError && e.code === 'NOT_CONFIGURED' && e.status === 503;

test('by default every provider fails closed with NOT_CONFIGURED', async () => {
  const p = providersFromConfig(testConfig());
  assert.equal(p.payments, null, 'no payment gateway unless configured');
  await assert.rejects(p.maps.route({ latitude: 6.5, longitude: 3.4 }, { latitude: 6.6, longitude: 3.3 }), notConfigured);
  await assert.rejects(p.notifications.send({ id: 'm1', channel: 'sms', to: { userId: 'u', address: '+2348000000000' }, template: 't', data: {} }), notConfigured);
  await assert.rejects(p.storage.presignGet({ bucket: 'b', key: 'k', expiresIn: 60 }), notConfigured);
  assert.equal(notConfiguredMaps.name, 'none');
  assert.equal(notConfiguredNotifications.name, 'none');
  await assert.rejects(notConfiguredStorage.head('b', 'k'), notConfigured);
});

test('the simulated payment gateway is the shared core adapter and says it is simulated', () => {
  const p = providersFromConfig(testConfig({ PAYMENTS_PROVIDER: 'simulated' }));
  assert.ok(p.payments);
  assert.equal(p.payments!.simulated, true);
  assert.deepEqual(missingCapabilities(p.payments!), []);
});

test('fake maps: straight-line route, place search; labelled fake', async () => {
  const m = fakeMaps([{ id: 'p1', label: 'Murtala Muhammed Airport', secondary: 'Ikeja', location: { latitude: 6.5774, longitude: 3.3212 } }]);
  assert.equal(m.name, 'fake');
  assert.equal((await m.searchPlaces('airport', null, 's1')).length, 1);
  assert.deepEqual(await m.searchPlaces('   ', null, 's1'), []);
  const r = await m.route({ latitude: 6.4281, longitude: 3.4219 }, { latitude: 6.5774, longitude: 3.3212 });
  assert.ok(r.distanceMeters > 20_000 && r.distanceMeters < 30_000);
  assert.equal(r.polyline, null);
});

test('log notifier never sends the same message twice and never logs addresses or data', async () => {
  const lines: string[] = [];
  const n = logNotifications((m, meta) => lines.push(JSON.stringify({ m, ...meta })));
  const msg = { id: 'trip-123:receipt', channel: 'email' as const, to: { userId: 'u1', address: 'ada@example.test' }, template: 'trip_receipt', data: { amount: '₦2,000' } };
  await n.send(msg);
  await n.send(msg);
  assert.deepEqual(n.sent, ['trip-123:receipt']);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes('ada@example.test') && !lines[0]!.includes('2,000'));
});

test('R2 presigning matches the edge Worker: signed checksum, size and type; short expiry; no other operations', async () => {
  const s = r2Storage({ accountId: 'a'.repeat(32), accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' }, () => Date.UTC(2026, 9, 23, 10));
  const sha = createHash('sha256').update('hello').digest('hex');
  const put = await s.presignPut({ bucket: 'gobye-staging-private-uploads', key: 'u/123/licence.jpg', contentType: 'image/jpeg', contentLength: 5, sha256: sha, expiresIn: 300 });
  const u = new URL(put.url);
  assert.equal(u.host, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
  assert.match(u.searchParams.get('X-Amz-SignedHeaders') ?? '', /content-length;content-type;host;x-amz-checksum-sha256/);
  assert.equal(put.headers['x-amz-checksum-sha256'], Buffer.from(sha, 'hex').toString('base64'));
  const get = await s.presignGet({ bucket: 'gobye-staging-private-documents', key: 'u/123/licence.jpg', expiresIn: 60 });
  assert.equal(new URL(get.url).searchParams.get('response-cache-control'), 'private, no-store');
  await assert.rejects(s.delete('b', 'k'), notConfigured);
  await assert.rejects(s.presignGet({ bucket: 'Bad_Bucket', key: 'k', expiresIn: 60 }), /Invalid bucket name/);
});
