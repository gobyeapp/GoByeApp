import { canRetryOnAnotherOrigin, selectOrigin, type BackendOrigin, type TrafficPolicy } from '@gobye/core/src/traffic/index';
import { SECURITY_HEADERS, dataResponse, errorResponse } from './envelope';
import { clientIp, clientResponseHeaders, originRequestHeaders } from './headers';
import { signOriginRequest } from './originAuth';
import { MemoryRateLimiter, type RateLimiter } from './ratelimit';
import { OTP_LIMIT, matchRoute, type RouteRule } from './routes';

/**
 * GoBye API gateway Worker for https://api.gobye.app (D-051). Status: Implemented and tested locally;
 * NOT deployed. With no backend chosen there are no origins, so every /v1 route answers an honest
 * 503 `backend_not_configured`. The gateway is one layer: the backend must still authenticate and
 * authorise every request, check ownership and enforce business rules.
 */

export interface GatewayEnv {
  /** JSON array of BackendOrigin. Empty or missing until a backend exists. Secret-free, but treat as internal. */
  ORIGINS_JSON?: string;
  /** JSON TrafficPolicy, or just a policy kind such as "primary_only". */
  TRAFFIC_POLICY?: string;
  /** Wrangler secret. Signs X-Gobye-Origin-Auth. */
  ORIGIN_AUTH_SECRET?: string;
  ENVIRONMENT?: 'development' | 'staging' | 'production';
  /** Comma-separated web origins allowed to call the API from a browser (e.g. https://admin.gobye.app). CORS is not authentication. */
  ALLOWED_ORIGINS?: string;
  PUBLIC_HOST?: string;
}

export interface GatewayDeps {
  rateLimiter?: RateLimiter;
  fetchOrigin?: (req: Request) => Promise<Response>;
  now?: () => number;
  rand?: () => number;
  log?: (line: Record<string, unknown>) => void;
  newRequestId?: () => string;
}

export function parseOrigins(raw: string | undefined): BackendOrigin[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((o) => o && typeof o.id === 'string' && typeof o.endpoint === 'string' && o.endpoint.startsWith('https://'));
  } catch {
    return [];
  }
}

export function parsePolicy(raw: string | undefined, now: number): TrafficPolicy {
  const fallback: TrafficPolicy = { kind: 'primary_only', version: 0, updatedAt: now, updatedBy: 'config' };
  if (!raw) return fallback;
  const kinds = ['primary_only', 'weighted', 'secondary_only', 'maintenance', 'emergency'];
  if (kinds.includes(raw)) return { ...fallback, kind: raw as TrafficPolicy['kind'] };
  try {
    const p = JSON.parse(raw);
    return p && kinds.includes(p.kind) ? { ...fallback, ...p } : fallback;
  } catch {
    return fallback;
  }
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const hasBearer = (req: Request) => /^Bearer [A-Za-z0-9._~+/-]{16,}=*$/.test(req.headers.get('authorization') ?? '');

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(req: Request, env: GatewayEnv): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After' };
}

export function createGateway(deps: GatewayDeps = {}) {
  const limiter = deps.rateLimiter ?? new MemoryRateLimiter();
  const fetchOrigin = deps.fetchOrigin ?? ((r: Request) => fetch(r));
  const clock = deps.now ?? (() => Date.now());
  const rand = deps.rand ?? Math.random;
  const log = deps.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
  const newId = deps.newRequestId ?? (() => crypto.randomUUID());

  async function handle(req: Request, env: GatewayEnv): Promise<{ res: Response; meta: Record<string, unknown> }> {
    const requestId = newId();
    const now = clock();
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const cors = corsHeaders(req, env);
    const err = (status: number, code: Parameters<typeof errorResponse>[1], o: Parameters<typeof errorResponse>[3] = {}) =>
      errorResponse(status, code, requestId, { ...o, headers: { ...cors, ...(o.headers ?? {}) } });

    if (method === 'OPTIONS') {
      if (!cors['Access-Control-Allow-Origin']) return { res: new Response(null, { status: 204, headers: SECURITY_HEADERS }), meta: { outcome: 'preflight_refused' } };
      return {
        res: new Response(null, {
          status: 204,
          headers: { ...SECURITY_HEADERS, ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Request-Id, X-App-Version, X-Platform', 'Access-Control-Max-Age': '600' },
        }),
        meta: { outcome: 'preflight' },
      };
    }

    const match = matchRoute(method, url.pathname);
    const origins = parseOrigins(env.ORIGINS_JSON);
    const policy = parsePolicy(env.TRAFFIC_POLICY, now);

    if (match.kind === 'health') {
      if (match.which === 'live') return { res: dataResponse(200, { status: 'ok' }, requestId), meta: { outcome: 'health_live' } };
      // Readiness: is there at least one usable origin? No dependency details are exposed.
      const ready = origins.some((o) => !o.maintenance && (o.health === 'healthy' || o.health === 'degraded'));
      return { res: ready ? dataResponse(200, { status: 'ready' }, requestId) : err(503, 'service_unavailable', { message: 'Not ready.', retryAfterSeconds: 30 }), meta: { outcome: ready ? 'health_ready' : 'health_not_ready' } };
    }
    if (match.kind === 'unsupported_version') return { res: err(404, 'unsupported_api_version'), meta: { outcome: 'bad_version' } };
    if (match.kind === 'not_found') return { res: err(404, 'not_found'), meta: { outcome: 'not_found' } };

    const rule: RouteRule = match.rule;
    const meta: Record<string, unknown> = { routeClass: rule.routeClass };
    if (!rule.methods.includes(method)) return { res: err(405, 'method_not_allowed', { headers: { Allow: rule.methods.join(', ') } }), meta: { ...meta, outcome: 'method' } };
    if (rule.auth && !hasBearer(req)) return { res: err(401, 'unauthenticated'), meta: { ...meta, outcome: 'unauthenticated' } };

    // Rate limit per route class and per client (token hash when signed in, else IP). Safety routes are never limited here.
    const ip = clientIp(req);
    const who = rule.auth ? `t:${await sha256Hex(req.headers.get('authorization') ?? '')}` : `ip:${ip ?? 'unknown'}`;
    for (const [bucket, limit] of [[rule.routeClass, rule.limit], ...(match.isOtp ? [['otp', OTP_LIMIT] as const] : [])] as const) {
      if (!limit) continue;
      const d = await limiter.hit(`${bucket}:${who}`, limit, now);
      if (!d.allowed) return { res: err(429, 'rate_limited', { retryAfterSeconds: d.retryAfterSeconds }), meta: { ...meta, outcome: 'rate_limited' } };
    }

    // Body: size limit, and JSON only.
    let body: ArrayBuffer | undefined;
    if (BODY_METHODS.has(method)) {
      const declared = Number(req.headers.get('content-length') ?? '0');
      if (declared > rule.maxBodyBytes) return { res: err(413, 'payload_too_large'), meta: { ...meta, outcome: 'too_large' } };
      body = await req.arrayBuffer();
      if (body.byteLength > rule.maxBodyBytes) return { res: err(413, 'payload_too_large'), meta: { ...meta, outcome: 'too_large' } };
      if (body.byteLength > 0) {
        if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return { res: err(400, 'invalid_request', { message: 'Send JSON (Content-Type: application/json).' }), meta: { ...meta, outcome: 'bad_type' } };
        try {
          JSON.parse(new TextDecoder().decode(body));
        } catch {
          return { res: err(400, 'invalid_json'), meta: { ...meta, outcome: 'bad_json' } };
        }
      }
    }

    // Choose an origin; a failed safe request may move to one other origin once.
    const tried = new Set<string>();
    const idem = req.headers.get('idempotency-key');
    for (let attempt = 0; attempt < 2; attempt++) {
      const pick = selectOrigin(policy, origins.filter((o) => !tried.has(o.id)), rule.routeClass, rand, { now });
      if (!pick.ok) {
        const status = attempt > 0 ? 502 : 503;
        const code = attempt > 0 ? 'upstream_error' : pick.code;
        return { res: err(status, code, { retryAfterSeconds: pick.retryAfterSeconds, message: attempt > 0 ? undefined : pick.message }), meta: { ...meta, outcome: pick.code, attempts: attempt } };
      }
      const o = pick.origin;
      tried.add(o.id);
      meta.origin = o.id; // origin id only, never its address
      meta.selection = pick.reason;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), rule.timeoutMs);
      try {
        const target = new URL(match.path + url.search, o.endpoint);
        const headers = originRequestHeaders(req.headers, {
          requestId,
          clientIp: ip,
          routeClass: rule.routeClass,
          originAuth: env.ORIGIN_AUTH_SECRET ? await signOriginRequest(env.ORIGIN_AUTH_SECRET, requestId, now) : 'unsigned',
          host: env.PUBLIC_HOST ?? 'api.gobye.app',
        });
        const upstream = await fetchOrigin(new Request(target.toString(), { method, headers, body: body && body.byteLength ? body : undefined, signal: ctrl.signal, redirect: 'manual' }));
        clearTimeout(timer);
        if (upstream.status >= 500) {
          // Never pass an origin's 5xx body through (it may hold stack traces or internal addresses).
          const retryable = upstream.status === 502 || upstream.status === 503;
          if (retryable && canRetryOnAnotherOrigin(method, idem) && attempt === 0) continue;
          const ra = upstream.headers.get('retry-after');
          return {
            res: err(upstream.status === 503 ? 503 : upstream.status === 504 ? 504 : 502, upstream.status === 503 ? 'service_unavailable' : upstream.status === 504 ? 'gateway_timeout' : 'upstream_error', { retryAfterSeconds: ra && /^\d+$/.test(ra) ? Number(ra) : undefined }),
            meta: { ...meta, outcome: 'upstream_5xx', upstreamStatus: upstream.status },
          };
        }
        const headersOut = clientResponseHeaders(upstream.headers, { ...SECURITY_HEADERS, ...cors, 'X-Request-Id': requestId });
        return { res: new Response(upstream.body, { status: upstream.status, headers: headersOut }), meta: { ...meta, outcome: 'proxied', status: upstream.status } };
      } catch (e) {
        clearTimeout(timer);
        const timedOut = ctrl.signal.aborted;
        // A timeout on a write may have succeeded at the origin: never replay it; the client checks the authoritative status.
        if (!timedOut && canRetryOnAnotherOrigin(method, idem) && attempt === 0) continue;
        return timedOut
          ? { res: err(504, 'gateway_timeout'), meta: { ...meta, outcome: 'timeout' } }
          : { res: err(502, 'upstream_error'), meta: { ...meta, outcome: 'origin_unreachable' } };
      }
    }
    return { res: err(502, 'upstream_error'), meta: { ...meta, outcome: 'exhausted' } };
  }

  return {
    async fetch(req: Request, env: GatewayEnv): Promise<Response> {
      const started = clock();
      const { res, meta } = await handle(req, env);
      // One structured line per request. No query strings, tokens, bodies, IPs or origin addresses.
      log({
        ts: new Date(started).toISOString(),
        env: env.ENVIRONMENT ?? 'development',
        service: 'api-gateway',
        requestId: res.headers.get('x-request-id'),
        method: req.method,
        path: new URL(req.url).pathname.replace(/\/[0-9a-zA-Z_-]{16,}(?=\/|$)/g, '/:id'),
        status: res.status,
        durationMs: clock() - started,
        ...meta,
      });
      return res;
    },
  };
}
