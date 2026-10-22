import type { R2BucketLike, R2ObjectBodyLike, R2ObjectLike } from '../src/r2/bindings';

/** In-memory stand-in for an R2 bucket binding (checksums recorded like R2 does). */
export function fakeBucket(): R2BucketLike & { data: Map<string, { body: Uint8Array; sha256: ArrayBuffer; type?: string }> } {
  const data = new Map<string, { body: Uint8Array; sha256: ArrayBuffer; type?: string }>();
  const meta = (key: string): R2ObjectLike | null => {
    const o = data.get(key);
    if (!o) return null;
    const tag = `"${o.body.length}-${key.length}"`;
    return { key, size: o.body.length, etag: tag, httpEtag: tag, checksums: { sha256: o.sha256 }, httpMetadata: { contentType: o.type }, uploaded: new Date(0) };
  };
  const toBytes = async (v: ReadableStream | ArrayBuffer | Uint8Array | string) =>
    typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
  return {
    data,
    async head(key) {
      return meta(key);
    },
    async get(key, opts) {
      const m = meta(key);
      if (!m) return null;
      const all = data.get(key)!.body;
      const part = opts?.range ? all.slice(opts.range.offset, opts.range.offset + opts.range.length) : all;
      return { ...m, body: new Response(part as unknown as BodyInit).body!, arrayBuffer: async () => part.slice().buffer } as R2ObjectBodyLike;
    },
    async put(key, value, opts) {
      const body = await toBytes(value);
      const sha256 = await crypto.subtle.digest('SHA-256', body as BufferSource);
      data.set(key, { body, sha256, type: opts?.httpMetadata?.contentType });
      return meta(key);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

export const sha256Hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/**
 * Simulates the client's PUT to an R2 presigned URL: refuses an expired URL or changed signed headers,
 * verifies x-amz-checksum-sha256 like R2 (400 BadDigest), then stores the object in the fake bucket.
 */
export async function clientPut(buckets: Record<string, R2BucketLike>, url: string, headers: Record<string, string>, body: Uint8Array, now: number, opts: { interrupt?: boolean } = {}) {
  const u = new URL(url);
  const [, bucket, ...rest] = u.pathname.split('/');
  const date = u.searchParams.get('X-Amz-Date')!;
  const issued = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +date.slice(9, 11), +date.slice(11, 13), +date.slice(13, 15));
  if (now > issued + Number(u.searchParams.get('X-Amz-Expires')) * 1000) return 403;
  if (Number(headers['content-length']) !== body.length) return 403;
  if (opts.interrupt) return 0;
  const want = headers['x-amz-checksum-sha256'];
  if (want && want !== b64(await crypto.subtle.digest('SHA-256', body as BufferSource))) return 400;
  await buckets[bucket].put(decodeURIComponent(rest.join('/')), body, { httpMetadata: { contentType: headers['content-type'] } });
  return 200;
}
