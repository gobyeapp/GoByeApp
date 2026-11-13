/**
 * Minimal types for the Workers runtime module that @cloudflare/containers builds on. The real module is
 * provided by the Workers runtime at deploy time; this package type-checks without @cloudflare/workers-types
 * (tsconfig "types": []), so only what the container Worker uses is declared here.
 */
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
  export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
    protected ctx: unknown;
    protected env: Env;
    protected props: Props;
  }
  export const env: Record<string, unknown>;
}

declare namespace Cloudflare {
  interface Env {
    [key: string]: unknown;
  }
}
