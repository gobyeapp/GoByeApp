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
  async me(@CurrentPrincipal() p: Principal) {
    // The token carries an email only once the sign-in service has confirmed it: that is the only way an
    // address becomes "confirmed" here, and receipts go nowhere else (D-103).
    if (p.user && p.email) {
      await this.db.query(`update app.users set email = lower($2), email_verified_at = coalesce(email_verified_at, now()) where id = $1 and status = 'active' and (email is distinct from lower($2) or email_verified_at is null)`, [p.userId, p.email]).catch(() => undefined);
    }
    return meView(this.db, p);
  }
}
