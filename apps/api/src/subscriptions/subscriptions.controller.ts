import { Controller, Get, Inject, Param } from '@nestjs/common';
import { subscriptionTimelineResponse } from '@gobye/core';
import { z } from 'zod';
import { CLOCK, DATABASE } from '../tokens';
import type { Database } from '../database/database';
import { CurrentPrincipal } from '../auth/decorators';
import { assertCityScope } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { readTimeline } from './subscriptions.repository';

const Params = z.object({ driverId: z.string().uuid('Must be a driver id.') }).strict();

/**
 * GET /v1/drivers/{driverId}/subscription → SubscriptionTimelineResponse (API_CONTRACTS.md, D-058).
 * The same body for the Driver App (its own id) and staff with drivers.view (within their cities).
 */
@Controller('drivers/:driverId/subscription')
export class SubscriptionsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  @Get()
  async get(@Param(validate(Params)) params: z.infer<typeof Params>, @CurrentPrincipal() p: Principal) {
    const driverId = params.driverId.toLowerCase();
    const self = p.userId === driverId && !!p.user?.isDriver;
    if (!self) {
      if (p.mfaPending) throw Errors.mfaRequired();
      if (!p.permissions.has('drivers.view')) throw Errors.notFound('Driver not found.');
      const d = await this.db.query<{ city: string }>(`select city from app.drivers where user_id = $1`, [driverId]);
      if (!d.rows[0]) throw Errors.notFound('Driver not found.');
      assertCityScope(p, d.rows[0].city);
    }
    const state = (await readTimeline(this.db, driverId)) ?? { driverId, version: 0, payments: [], voids: [], passes: [] };
    return subscriptionTimelineResponse(state, this.now());
  }
}
