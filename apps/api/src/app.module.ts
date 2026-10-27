import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { AppConfig } from './config/config';
import type { Database } from './database/database';
import type { MigrationFile } from './database/migrations';
import type { TokenVerifier } from './auth/jwt';
import type { PrincipalRepository } from './auth/principal';
import type { Providers } from './providers/ports';
import { AuthGuard, OriginAuthGuard, PermissionGuard } from './auth/guards';
import { EnvelopeExceptionFilter } from './common/exception.filter';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { SubscriptionsController } from './subscriptions/subscriptions.controller';
import { CostsController } from './costs/costs.controller';
import { WhatsAppWebhookController } from './whatsapp/whatsapp.controller';
import { CLOCK, CONFIG, DATABASE, MIGRATIONS, PRINCIPALS, PROVIDERS, TOKEN_VERIFIER } from './tokens';

export interface AppDeps {
  config: AppConfig;
  db: Database;
  migrations: MigrationFile[];
  verifier: TokenVerifier | null;
  principals: PrincipalRepository | null;
  providers: Providers;
  now?: () => number;
}

@Module({})
export class AppModule {
  static forRoot(d: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, MeController, SubscriptionsController, CostsController, WhatsAppWebhookController],
      providers: [
        { provide: CONFIG, useValue: d.config },
        { provide: DATABASE, useValue: d.db },
        { provide: MIGRATIONS, useValue: d.migrations },
        { provide: TOKEN_VERIFIER, useValue: d.verifier },
        { provide: PRINCIPALS, useValue: d.principals },
        { provide: PROVIDERS, useValue: d.providers },
        { provide: CLOCK, useValue: d.now ?? Date.now },
        // Order matters: gateway signature → session → permissions.
        { provide: APP_GUARD, useClass: OriginAuthGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: EnvelopeExceptionFilter },
      ],
    };
  }
}
