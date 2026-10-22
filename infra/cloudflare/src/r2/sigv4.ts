/**
 * AWS Signature Version 4 query-string presigning (the scheme R2's S3-compatible API accepts).
 * WebCrypto only, so it runs in Workers and Node 20+. Server-side code only: it needs the R2 secret.
 *
 * Presigned URLs must use the S3 endpoint (`https://<accountId>.r2.cloudflarestorage.com`), not a custom
 * domain. A presigned URL can be used any number of times until it expires: keep expiry short and rely on
 * server-side completion (single use) for anything that matters.
 */

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 encoding as S3 expects (also encodes !'()*). `/` kept only for paths. */
export function uriEncode(s: string, keepSlash = false): string {
  return [...enc.encode(s)]
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) return c;
      return `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/** "20130524T000000Z" */
export const amzDate = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Full URL without query, e.g. https://<account>.r2.cloudflarestorage.com/<bucket>/<key> */
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** Seconds, 1..604800 (SigV4 limit). Callers should bound this much lower (see presignR2). */
  expiresIn: number;
  at: Date;
  /** Extra headers the client must send exactly (lowercase names). `host` is always signed. */
  signedHeaders?: Record<string, string>;
  /** Extra query parameters (e.g. response-content-disposition). */
  query?: Record<string, string>;
}

export async function presignSigV4(p: PresignInput): Promise<string> {
  if (!Number.isInteger(p.expiresIn) || p.expiresIn < 1 || p.expiresIn > 604_800) throw new Error('expiresIn must be 1..604800 seconds');
  const u = new URL(p.url);
  const service = p.service ?? 's3';
  const datetime = amzDate(p.at);
  const date = datetime.slice(0, 8);
  const scope = `${date}/${p.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: u.host };
  for (const [k, v] of Object.entries(p.signedHeaders ?? {})) headers[k.toLowerCase()] = String(v).trim();
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(';');

  const query: Record<string, string> = {
    ...(p.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${p.accessKeyId}/${scope}`,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(p.expiresIn),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&');
  const canonicalPath = uriEncode(decodeURIComponent(u.pathname), true) || '/';
  const canonicalRequest = [p.method, canonicalPath, canonicalQuery, headerNames.map((h) => `${h}:${headers[h]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', datetime, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(enc.encode(`AWS4${p.secretAccessKey}`), date);
  const kRegion = await hmac(kDate, p.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));
  return `${u.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Hex SHA-256 → base64, the form the `x-amz-checksum-sha256` header uses. */
export function hexToBase64(h: string): string {
  const bytes = h.match(/../g)!.map((x) => parseInt(x, 16));
  return btoa(String.fromCharCode(...bytes));
}

export const R2_MAX_PRESIGN_SECONDS = 3600;
export const R2_DEFAULT_PRESIGN_SECONDS = 300;

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Presign against R2's S3 endpoint (path style, region `auto`). Expiry is clamped to 1..3600 s
 * (default 300): R2 presigned URLs are reusable until they expire.
 */
export function presignR2(
  creds: R2Credentials,
  p: { method: 'GET' | 'PUT'; bucket: string; key: string; expiresIn?: number; at?: Date; signedHeaders?: Record<string, string>; query?: Record<string, string> },
): Promise<string> {
  if (!/^[a-f0-9]{32}$/.test(creds.accountId)) throw new Error('R2 account id is missing or malformed');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(p.bucket)) throw new Error('Invalid bucket name');
  if (!p.key || p.key.startsWith('/') || p.key.split('/').some((s) => s === '..' || s === '.')) throw new Error('Invalid object key');
  const expiresIn = Math.min(R2_MAX_PRESIGN_SECONDS, Math.max(1, Math.floor(p.expiresIn ?? R2_DEFAULT_PRESIGN_SECONDS)));
  return presignSigV4({
    method: p.method,
    url: `https://${creds.accountId}.r2.cloudflarestorage.com/${p.bucket}/${p.key}`,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    region: 'auto',
    expiresIn,
    at: p.at ?? new Date(),
    signedHeaders: p.signedHeaders,
    query: p.query,
  });
}
