import { Controller, Get, Header, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { parseWebhook } from '@gobye/core';
import { Public } from '../auth/decorators';
import { RawResponse } from '../common/envelope.interceptor';
import { Errors } from '../common/errors';
import type { AppConfig } from '../config/config';
import type { Database } from '../database/database';
import type { Providers } from '../providers/ports';
import { CONFIG, DATABASE, PROVIDERS } from '../tokens';
import { acceptInbound, safeEqual, verifyMetaSignature } from './whatsapp.service';

/**
 * /v1/webhooks/whatsapp (D-064). Meta calls it through the Cloudflare gateway (route class `webhooks`,
 * no user token; the gateway's origin signature still applies). Answers 404 when WhatsApp is off.
 *
 * GET  — Meta's subscription check: echo hub.challenge when hub.verify_token matches ours.
 * POST — message events: verify X-Hub-Signature-256 over the raw body, de-duplicate by message id, queue.
 *        Answers 200 fast; the conversation runs in the job worker.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PROVIDERS) private readonly providers: Providers,
  ) {}

  private enabled(): void {
    if (!this.providers.whatsapp) throw Errors.notFound();
  }

  @Get()
  @Public()
  @RawResponse()
  @Header('content-type', 'text/plain; charset=utf-8')
  verify(@Query() q: Record<string, string | undefined>): string {
    this.enabled();
    const challenge = q['hub.challenge'];
    const token = q['hub.verify_token'];
    if (q['hub.mode'] === 'subscribe' && token && safeEqual(token, this.config.WHATSAPP_VERIFY_TOKEN!) && challenge && /^[A-Za-z0-9_-]{1,128}$/.test(challenge)) return challenge;
    throw Errors.forbidden('Verification failed.');
  }

  @Post()
  @Public()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ received: number; queued: number }> {
    this.enabled();
    const header = req.headers['x-hub-signature-256'];
    if (!req.rawBody || !verifyMetaSignature(this.config.WHATSAPP_APP_SECRET!, req.rawBody, Array.isArray(header) ? header[0] : header)) {
      throw Errors.unauthenticated('Invalid signature.');
    }
    const messages = parseWebhook(req.body, this.config.WHATSAPP_PHONE_NUMBER_ID);
    const queued = await acceptInbound(this.db, messages);
    return { received: messages.length, queued };
  }
}
