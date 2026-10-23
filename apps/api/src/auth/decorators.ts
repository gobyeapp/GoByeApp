import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@gobye/core';
import type { Principal } from './principal';

/** No sign-in needed (health probes). Everything else requires a valid Supabase session. */
export const PUBLIC_ROUTE = 'gobye:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Every listed permission is required (staff only; checked on the server against app.staff_members). */
export const REQUIRED_PERMISSIONS = 'gobye:permissions';
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Not reachable through the gateway signature check (platform health probes call these directly). */
export const SKIP_ORIGIN_AUTH = 'gobye:skip-origin-auth';
export const SkipOriginAuth = () => SetMetadata(SKIP_ORIGIN_AUTH, true);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return (ctx.switchToHttp().getRequest() as { principal: Principal }).principal;
});
