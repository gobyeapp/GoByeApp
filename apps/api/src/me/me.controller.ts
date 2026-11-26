import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { DATABASE } from '../tokens';
import type { Database } from '../database/database';
import { meView } from './me.view';

/** GET /v1/me: who the server thinks you are. The apps use it after sign-in to pick their next screen. */
@Controller('me')
export class MeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  me(@CurrentPrincipal() p: Principal) {
    return meView(this.db, p);
  }
}
