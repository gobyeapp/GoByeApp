import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';

/** Handlers marked raw return their body as is (health probes, which load balancers read directly). */
export const RAW_RESPONSE = 'gobye:raw';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Wraps every handler result in `{ data, meta: { requestId } }` (ApiSuccessBody in @gobye/core). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    return next.handle().pipe(map((data) => ({ data: data ?? null, meta: { requestId: req.id } })));
  }
}
