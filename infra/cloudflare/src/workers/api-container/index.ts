import { Container } from '@cloudflare/containers';
import { KEEPALIVE_PATH, LOCATION_HINT, PRIMARY_INSTANCE, containerEnv } from './logic';

/**
 * GoBye API on Cloudflare Containers (D-065, docs/DEPLOYMENT_CLOUDFLARE.md). NOT DEPLOYED.
 *
 * The Worker runs the existing API image (apps/api/Dockerfile, digest-pinned base) as one container and
 * forwards every request to it. The public entry point stays the API gateway Worker (api.gobye.app), which
 * signs each request; the API refuses unsigned /v1 requests, so this Worker's own address grants nothing.
 * A cron trigger every 5 minutes keeps the container awake so the in-process job worker keeps running.
 */

interface Stub {
  fetch(request: Request): Promise<Response>;
}
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown, options?: { locationHint?: string }): Stub;
}
interface Env {
  API: Namespace;
  [key: string]: unknown;
}
interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

export class GobyeApi extends Container<Env> {
  defaultPort = 8080;
  /** Longer than the cron interval: the container stays up between keep-alive calls. */
  sleepAfter = '15m';
  /** Outbound internet: Supabase (database, sign-in keys), and later providers. */
  enableInternet = true;
  envVars = containerEnv(this.env as unknown as Record<string, unknown>);
}

function primary(env: Env): Stub {
  return env.API.get(env.API.idFromName(PRIMARY_INSTANCE), { locationHint: LOCATION_HINT });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return primary(env).fetch(request);
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(primary(env).fetch(new Request(`http://gobye-api${KEEPALIVE_PATH}`)));
  },
};
