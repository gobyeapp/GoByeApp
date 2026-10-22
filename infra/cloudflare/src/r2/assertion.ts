import type { FileCaller } from '@gobye/core';

/**
 * Gateway assertion: after the API gateway has authenticated the session, it forwards the caller's
 * identity to internal Workers in `x-gobye-assertion`, HMAC-signed with a secret only the gateway and
 * the Worker hold. The Worker trusts this header, never the client's own claims (the gateway strips any
 * incoming copy). Format: `v1.<base64url(json)>.<hex hmac-sha256>`, valid for at most 60 s.
 */

export const ASSERTION_HEADER = 'x-gobye-assertion';
const MAX_AGE_MS = 60_000;
const enc = new TextEncoder();

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const hexToBytes = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

interface Payload {
  sub: string;
  roles: FileCaller['roles'];
  /** Issued at (ms). */
  iat: number;
  /** Request id, so logs on both sides line up. */
  rid?: string;
}

export async function signAssertion(p: Payload, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(p));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`v1.${body}`));
  return `v1.${body}.${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The caller, or null when the header is missing, forged, malformed or stale. Constant-time verify. */
export async function verifyAssertion(header: string | null, secret: string | undefined, now: number): Promise<FileCaller | null> {
  if (!header || !secret || secret.length < 32) return null;
  const parts = header.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), hexToBytes(parts[2]), enc.encode(`v1.${parts[1]}`));
  if (!ok) return null;
  let p: Payload;
  try {
    p = JSON.parse(fromB64url(parts[1]));
  } catch {
    return null;
  }
  if (typeof p.sub !== 'string' || !p.sub || !Array.isArray(p.roles) || typeof p.iat !== 'number') return null;
  if (Math.abs(now - p.iat) > MAX_AGE_MS) return null;
  return { userId: p.sub, roles: p.roles };
}
