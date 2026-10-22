import { bucketName, type DeployEnvironment, type ObjectStore, type PresignedRequest } from '@gobye/core';
import { hexToBase64, presignR2, type R2Credentials } from './sigv4';

/**
 * The slice of the Workers R2 binding API we use, typed here so the package needs no extra type
 * packages. Matches https://developers.cloudflare.com/r2/api/workers/workers-api-reference/.
 */
export interface R2Checksums {
  sha256?: ArrayBuffer;
}
export interface R2ObjectLike {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: R2Checksums;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  uploaded: Date;
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string }; sha256?: string }): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export type BucketBindings = Partial<Record<'private-uploads' | 'private-documents' | 'private-evidence' | 'public-media', R2BucketLike>>;

/**
 * ObjectStore backed by R2: Worker bindings for reads, deletes and copies; SigV4 presigned URLs (S3
 * endpoint) for the client's direct upload and short-lived downloads. Status: implemented and tested
 * against an in-memory R2 fake; real buckets pending credentials.
 */
export function createR2ObjectStore(p: { env: DeployEnvironment; creds: R2Credentials; buckets: BucketBindings; now?: () => number }): ObjectStore {
  const now = p.now ?? (() => Date.now());
  const byName = new Map<string, R2BucketLike>();
  for (const [role, b] of Object.entries(p.buckets)) if (b) byName.set(bucketName(p.env, role as keyof BucketBindings), b);
  const bucket = (name: string): R2BucketLike => {
    const b = byName.get(name);
    if (!b) throw new Error('Bucket not bound to this Worker');
    return b;
  };

  return {
    async presignPut(q): Promise<PresignedRequest> {
      bucket(q.bucket);
      const headers = { 'content-type': q.contentType, 'content-length': String(q.contentLength), 'x-amz-checksum-sha256': hexToBase64(q.sha256) };
      const url = await presignR2(p.creds, { method: 'PUT', bucket: q.bucket, key: q.key, expiresIn: q.expiresIn, at: new Date(now()), signedHeaders: headers });
      return { url, method: 'PUT', headers, expiresAt: now() + q.expiresIn * 1000 };
    },
    async presignGet(q): Promise<PresignedRequest> {
      bucket(q.bucket);
      const url = await presignR2(p.creds, { method: 'GET', bucket: q.bucket, key: q.key, expiresIn: q.expiresIn, at: new Date(now()), query: { 'response-cache-control': 'private, no-store' } });
      return { url, method: 'GET', headers: {}, expiresAt: now() + q.expiresIn * 1000 };
    },
    async head(name, key) {
      const o = await bucket(name).head(key);
      if (!o) return null;
      return { size: o.size, sha256: o.checksums?.sha256 ? toHex(o.checksums.sha256) : null, contentType: o.httpMetadata?.contentType ?? null };
    },
    async readHead(name, key, length) {
      const o = await bucket(name).get(key, { range: { offset: 0, length } });
      return o ? new Uint8Array(await o.arrayBuffer()).slice(0, length) : null;
    },
    async delete(name, key) {
      await bucket(name).delete(key);
    },
    async copy(from, to) {
      const src = await bucket(from.bucket).get(from.key);
      if (!src) throw new Error('Source object missing');
      const sha = src.checksums?.sha256 ? toHex(src.checksums.sha256) : undefined;
      await bucket(to.bucket).put(to.key, src.body, { httpMetadata: { contentType: src.httpMetadata?.contentType }, sha256: sha });
    },
  };
}
