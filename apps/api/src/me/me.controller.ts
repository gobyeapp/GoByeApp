import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';

/** GET /v1/me: who the server thinks you are. The apps use it after sign-in to pick their next screen. */
@Controller('me')
export class MeController {
  @Get()
  me(@CurrentPrincipal() p: Principal) {
    return {
      userId: p.userId,
      signupComplete: !!p.user,
      status: p.user?.status ?? null,
      rider: p.user?.isRider ?? false,
      driver: p.user?.isDriver ? { city: p.user.driverCity, verification: p.user.driverVerification } : null,
      staff: p.staff
        ? { roles: p.staff.roles, cities: p.staff.cities, status: p.staff.status, mfaRequired: p.mfaPending, permissions: [...p.permissions].sort() }
        : null,
      session: { aal: p.aal },
    };
  }
}
