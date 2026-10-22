import type { R2BucketLike } from '../../r2/bindings';

/**
 * Public media gateway (media.gobye.app), D-051. Serves APPROVED PUBLIC media only, from the public
 * bucket, with long immutable caching. This Worker is bound to the public bucket alone, so it cannot
 * read private documents or evidence even if asked; it also refuses any key outside `public_media/`.
 * Private files are only ever reached through short-lived presigned URLs from the upload signer.
 *
 * Status: implemented and tested locally against an R2 fake. Not deployed (pending approval of
 * media.gobye.app and credentials).
 */

export interface MediaGatewayEnv {
  PUBLIC_MEDIA: R2BucketLike;
}

const KEY = /^public_media\/[a-f0-9]{16}\/\d{4}\/\d{2}\/[a-z0-9-]{8,64}\.(jpg|png|webp|heic|heif|mp4)$/;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4' };

const deny = (status: number) => new Response(status === 404 ? 'Not found' : 'Method not allowed', { status, headers: { 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });

export function isPublicKey(key: string): boolean {
  return KEY.test(key) && !key.includes('..');
}

export default {
  async fetch(request: Request, env: MediaGatewayEnv): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405);
    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    if (!isPublicKey(key)) return deny(404);
    const obj = request.method === 'HEAD' ? await env.PUBLIC_MEDIA.head(key) : await env.PUBLIC_MEDIA.get(key);
    if (!obj) return deny(404);
    if (request.headers.get('if-none-match') === obj.httpEtag) return new Response(null, { status: 304, headers: { etag: obj.httpEtag } });
    const headers = {
      'content-type': TYPES[key.split('.').pop()!],
      'cache-control': 'public, max-age=31536000, immutable',
      etag: obj.httpEtag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'",
      'cross-origin-resource-policy': 'cross-origin',
    };
    return new Response(request.method === 'HEAD' ? null : (obj as unknown as { body: ReadableStream }).body, { headers });
  },
};
