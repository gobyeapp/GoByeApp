/**
 * Origin authentication (D-051): the gateway signs each request it forwards, so an origin can refuse
 * anything that didn't come through the edge (origin-bypass protection). Header:
 *   X-Gobye-Origin-Auth: t=<unix ms>,sig=<hex HMAC-SHA256(secret, `${requestId}.${t}.${METHOD}.${pathAndQuery}`)>
 * Binding the method and path (2026-10-23) means a captured header can't be reused for another route.
 * Origins verify the signature, reject timestamps older than 60 s and refuse a request id seen before
 * within that window (apps/api/src/auth/guards.ts). Pair with network controls
 * (Cloudflare Tunnel, allowlisted Cloudflare IPs or mTLS) where the provider supports them.
 */

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const originAuthMessage = (requestId: string, t: number, method: string, pathAndQuery: string) => `${requestId}.${t}.${method.toUpperCase()}.${pathAndQuery}`;

export async function signOriginRequest(secret: string, requestId: string, now: number, method: string, pathAndQuery: string): Promise<string> {
  return `t=${now},sig=${await hmacHex(secret, originAuthMessage(requestId, now, method, pathAndQuery))}`;
}

/** For origins (and tests): constant-time check of the header with a freshness window. */
export async function verifyOriginRequest(secret: string, requestId: string, header: string | null, now: number, method: string, pathAndQuery: string, maxAgeMs = 60_000): Promise<boolean> {
  const m = header ? /^t=(\d+),sig=([0-9a-f]{64})$/.exec(header) : null;
  if (!m) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(now - t) > maxAgeMs) return false;
  const want = await hmacHex(secret, originAuthMessage(requestId, t, method, pathAndQuery));
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
