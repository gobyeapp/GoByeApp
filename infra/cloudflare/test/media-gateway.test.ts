import { describe, expect, it } from 'vitest';
import worker, { isPublicKey } from '../src/workers/media-gateway';
import { fakeBucket } from './r2-fake';

const KEY = 'public_media/0123456789abcdef/2026/10/file00000001.jpg';

describe('public media gateway', () => {
  it('serves approved public media with long immutable caching', async () => {
    const PUBLIC_MEDIA = fakeBucket();
    await PUBLIC_MEDIA.put(KEY, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    const res = await worker.fetch(new Request(`https://media.gobye.app/${KEY}`), { PUBLIC_MEDIA });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const etag = res.headers.get('etag')!;
    expect((await worker.fetch(new Request(`https://media.gobye.app/${KEY}`, { headers: { 'if-none-match': etag } }), { PUBLIC_MEDIA })).status).toBe(304);
  });

  it('never serves private classes, traversal, listings or other methods', async () => {
    const PUBLIC_MEDIA = fakeBucket();
    // Even if a private-looking object were in the public bucket by mistake, its key is refused.
    await PUBLIC_MEDIA.put('driver_licence/0123456789abcdef/2026/10/file00000001.jpg', new Uint8Array([1]));
    for (const path of ['driver_licence/0123456789abcdef/2026/10/file00000001.jpg', 'identity_document/x.jpg', 'incident_video/a/2026/10/b.mp4', 'public_media/../driver_licence/a.jpg', '', 'public_media/', `${KEY}.php`]) {
      expect((await worker.fetch(new Request(`https://media.gobye.app/${path}`), { PUBLIC_MEDIA })).status).toBe(404);
    }
    expect((await worker.fetch(new Request(`https://media.gobye.app/${KEY}`, { method: 'PUT' }), { PUBLIC_MEDIA })).status).toBe(405);
    expect(isPublicKey('public_media/0123456789abcdef/2026/10/file00000001.mp4')).toBe(true);
    expect((await worker.fetch(new Request(`https://media.gobye.app/${KEY}`), { PUBLIC_MEDIA })).status).toBe(404);
  });
});
