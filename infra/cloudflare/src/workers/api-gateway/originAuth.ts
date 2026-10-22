/**
 * Origin authentication (D-051): the gateway signs each request it forwards, so an origin can refuse
 * anything that didn't come through the edge (origin-bypass protection). Header:
 *   X-Gobye-Origin-Auth: t=<unix ms>,sig=<hex HMAC-SHA256(secret, `${requestId}.${t}`)>
 * Origins verify the signature and reject timestamps older than 60 s. Pair with network controls
 * (Cloudflare Tunnel, allowlisted Cloudflare IPs or mTLS) where the provider supports them.
 */

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signOriginRequest(secret: string, requestId: string, now: number): Promise<string> {
  return `t=${now},sig=${await hmacHex(secret, `${requestId}.${now}`)}`;
}

/** For origins (and tests): constant-time check of the header with a freshness window. */
export async function verifyOriginRequest(secret: string, requestId: string, header: string | null, now: number, maxAgeMs = 60_000): Promise<boolean> {
  const m = header ? /^t=(\d+),sig=([0-9a-f]{64})$/.exec(header) : null;
  if (!m) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(now - t) > maxAgeMs) return false;
  const want = await hmacHex(secret, `${requestId}.${t}`);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
