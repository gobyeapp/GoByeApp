import { createGateway, type GatewayEnv } from './gateway';

/** Worker entry (module syntax). Not deployed: see docs/API_GATEWAY.md before any `wrangler deploy`. */
const gateway = createGateway();

export default {
  fetch(request: Request, env: GatewayEnv): Promise<Response> {
    return gateway.fetch(request, env);
  },
};

export { createGateway } from './gateway';
export { MemoryRateLimiter } from './ratelimit';
export { signOriginRequest, verifyOriginRequest } from './originAuth';
