import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors';

interface Shaped {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string>;
  retryAfterSeconds?: number;
}

const VERSIONED = /^\/v(\d+)(\/|$)/;
export const SUPPORTED_VERSIONS = ['1'];

/** Maps anything thrown (ours, Nest's, Fastify's) to the shared error envelope. Unknown errors become a generic 500. */
export function shapeError(err: unknown, path: string): Shaped {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message, ...err.extra };
  // PostgreSQL contention: tell the client to retry instead of reporting a server fault.
  const pg = (err as { code?: string; severity?: string })?.severity ? (err as { code?: string }).code : undefined;
  if (pg === '55P03' || pg === '40001' || pg === '40P01') return { status: 409, code: 'conflict', message: 'The same record is being changed right now. Try again shortly.', retryAfterSeconds: 2 };
  if (pg === '57014') return { status: 503, code: 'service_unavailable', message: 'That took too long. Try again shortly.', retryAfterSeconds: 5 };
  if (pg === '23505') return { status: 409, code: 'conflict', message: 'That already exists.' };
  const fastifyCode = (err as { code?: string })?.code;
  if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') return { status: 413, code: 'payload_too_large', message: 'The request is too large.' };
  if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return { status: 415, code: 'unsupported_media_type', message: 'Send JSON (Content-Type: application/json).' };
  if (fastifyCode === 'FST_ERR_CTP_EMPTY_JSON_BODY' || (err instanceof SyntaxError && /JSON/i.test(err.message)) || fastifyCode === 'FST_ERR_CTP_INVALID_JSON_BODY')
    return { status: 422, code: 'validation_failed', message: 'The request body is not valid JSON.', details: { _: 'Invalid JSON' } };
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status === 404) {
      const m = VERSIONED.exec(path);
      if (m && !SUPPORTED_VERSIONS.includes(m[1]!)) return { status: 400, code: 'unsupported_api_version', message: `API version v${m[1]} is not supported. Use /v1.` };
      return { status: 404, code: 'not_found', message: 'Not found.' };
    }
    // Nest re-throws Fastify's body errors as HttpException with the original message.
    if (status === 400 && /not valid JSON|Unexpected token|JSON/i.test(err.message)) return { status: 422, code: 'validation_failed', message: 'The request body is not valid JSON.', details: { _: 'Invalid JSON' } };
    if (status === 415) return { status, code: 'unsupported_media_type', message: 'Send JSON (Content-Type: application/json).' };
    if (status === 405) return { status, code: 'method_not_allowed', message: 'Method not allowed.' };
    if (status === 413) return { status, code: 'payload_too_large', message: 'The request is too large.' };
    if (status === 401) return { status, code: 'unauthenticated', message: 'Sign in to continue.' };
    if (status === 403) return { status, code: 'forbidden', message: 'You do not have access to this.' };
    if (status === 429) return { status, code: 'rate_limited', message: 'Too many requests. Try again shortly.' };
    if (status < 500) return { status, code: 'bad_request', message: 'The request could not be processed.' };
  }
  const status = (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) return { status, code: 'bad_request', message: 'The request could not be processed.' };
  return { status: 500, code: 'internal_error', message: 'Something went wrong on our side. Try again.' };
}

@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const path = (req.url ?? '/').split('?')[0]!;
    const s = shapeError(err, path);
    if (s.status >= 500) this.log.error({ requestId: req.id, path, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) }, 'Unhandled error');
    if (s.retryAfterSeconds) reply.header('retry-after', String(s.retryAfterSeconds));
    reply
      .status(s.status)
      .header('content-type', 'application/json; charset=utf-8')
      .send({ error: { code: s.code, message: s.message, requestId: req.id, ...(s.details ? { details: s.details } : {}), ...(s.retryAfterSeconds ? { retryAfterSeconds: s.retryAfterSeconds } : {}) } });
  }
}
