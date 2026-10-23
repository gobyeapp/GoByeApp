import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Request ids: the gateway always sets `x-request-id` (API_GATEWAY.md). A well-formed incoming id is kept so
 * gateway, origin and client logs line up; anything else is replaced. The id is echoed in the `x-request-id`
 * response header and in every envelope.
 */
const WELL_FORMED = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdFrom(req: Pick<IncomingMessage, 'headers'>): string {
  const h = req.headers['x-request-id'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && WELL_FORMED.test(v) ? v : randomUUID();
}

export const isWellFormedRequestId = (v: string) => WELL_FORMED.test(v);
