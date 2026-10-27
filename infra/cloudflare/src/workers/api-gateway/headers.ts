/**
 * Header hygiene (D-051). The gateway forwards only an allowlist of client headers, so spoofed
 * forwarding / identity / admin headers (X-Forwarded-For, X-Real-IP, X-User-Id, X-Gobye-*, X-Admin-*)
 * never reach an origin. The client IP comes from Cloudflare's CF-Connecting-IP only.
 */

const FORWARD_FROM_CLIENT = new Set(['authorization', 'content-type', 'accept', 'accept-language', 'user-agent', 'idempotency-key', 'if-match', 'if-none-match', 'x-app-version', 'x-platform',
  // Provider signature on webhooks (Meta). The API verifies it; it grants nothing by itself.
  'x-hub-signature-256']);

/** Response headers passed back from an origin; everything else (Server, X-Powered-By, Set-Cookie, …) is dropped. */
const FORWARD_FROM_ORIGIN = new Set(['content-type', 'etag', 'retry-after', 'location', 'content-language']);

const CLIENT_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function originRequestHeaders(incoming: Headers, extra: { requestId: string; clientIp: string | null; routeClass: string; originAuth: string; host: string }): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (FORWARD_FROM_CLIENT.has(key.toLowerCase())) out.set(key, value);
  });
  const clientId = incoming.get('x-request-id');
  if (clientId && CLIENT_REQUEST_ID.test(clientId)) out.set('X-Client-Request-Id', clientId);
  out.set('X-Request-Id', extra.requestId);
  if (extra.clientIp) out.set('X-Forwarded-For', extra.clientIp);
  out.set('X-Forwarded-Proto', 'https');
  out.set('X-Forwarded-Host', extra.host);
  out.set('X-Gobye-Route-Class', extra.routeClass);
  out.set('X-Gobye-Origin-Auth', extra.originAuth);
  return out;
}

export function clientResponseHeaders(origin: Headers, base: Record<string, string>): Headers {
  const out = new Headers(base);
  origin.forEach((value, key) => {
    if (FORWARD_FROM_ORIGIN.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

/** Client IP for rate limiting and the origin: CF-Connecting-IP only (set by Cloudflare, not spoofable through the edge). */
export function clientIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip');
}
