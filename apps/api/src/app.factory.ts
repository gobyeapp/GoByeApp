import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { ConsoleLogger, type LogLevel, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule, type AppDeps } from './app.module';
import type { AppConfig } from './config/config';
import { Database } from './database/database';
import { loadMigrations } from './database/migrations';
import { verifierFromConfig } from './auth/jwt';
import { sqlPrincipalRepository } from './auth/principal';
import { providersFromConfig } from './providers/providers';
import { requestIdFrom } from './common/request-id';

/** Compiled code lives in apps/api/dist/apps/api/src (dist-test in tests); migrations in apps/api/migrations. */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'migrations');

const LEVELS: Record<AppConfig['LOG_LEVEL'], LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
  silent: [],
};

/** Real dependencies from configuration (main.ts). Tests pass their own. */
export function depsFromConfig(config: AppConfig): AppDeps {
  const db = Database.fromConfig(config);
  return {
    config,
    db,
    migrations: loadMigrations(MIGRATIONS_DIR),
    verifier: verifierFromConfig(config),
    principals: db.configured ? sqlPrincipalRepository(db) : null,
    providers: providersFromConfig(config),
  };
}

export async function createApp(deps: AppDeps): Promise<NestFastifyApplication> {
  const c = deps.config;
  const adapter = new FastifyAdapter({
    bodyLimit: c.BODY_LIMIT_BYTES,
    // Hop count (gateway + host load balancer); Fastify accepts a number though Nest's type lists fewer forms.
    trustProxy: (c.TRUST_PROXY_HOPS > 0 ? c.TRUST_PROXY_HOPS : false) as unknown as boolean,
    genReqId: (req: IncomingMessage) => requestIdFrom(req),
    // Structured JSON request logs. Never bodies, tokens, signatures or query strings (may hold personal data).
    logger:
      c.LOG_LEVEL === 'silent'
        ? false
        : {
            level: c.LOG_LEVEL,
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-gobye-origin-auth"]', 'req.headers["idempotency-key"]'], censor: '[redacted]' },
            serializers: {
              req: (r: { id: string; method: string; url: string }) => ({ id: r.id, method: r.method, path: r.url.split('?')[0] }),
              res: (r: { statusCode: number }) => ({ status: r.statusCode }),
            },
            base: { service: 'gobye-api', env: c.APP_ENV, version: c.APP_VERSION },
          },
    return503OnClosing: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(deps), adapter, {
    logger: c.LOG_LEVEL === 'silent' ? false : new ConsoleLogger({ json: c.isProductionLike, logLevels: LEVELS[c.LOG_LEVEL] }),
    bufferLogs: false,
  });

  const fastify = app.getHttpAdapter().getInstance();
  // Every response carries the request id and baseline security headers (the gateway adds its own too).
  fastify.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.removeHeader('x-powered-by');
    return payload;
  });
  // Body errors (bad JSON, too large, wrong media type) reach EnvelopeExceptionFilter through Nest's handler.

  if (c.corsOrigins.length) {
    app.enableCors({
      origin: c.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Client'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    });
  }
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
