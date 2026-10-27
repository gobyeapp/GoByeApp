/**
 * Traffic model for the API gateway (D-051). Describes backend origins, the routing policy staff choose,
 * and which /v1 route classes stay available while traffic is restricted. Pure data: nothing here talks
 * to Cloudflare. Status: Implemented (simulated control plane); no live origins exist yet.
 */

export type OriginHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface BackendOrigin {
  id: string;
  /** Origin base URL (https). Never shown to clients or put in error bodies. */
  endpoint: string;
  region: string;
  /** Free label such as "Provider A (pending selection)". No provider is chosen yet. */
  provider: string;
  health: OriginHealth;
  /** Relative share under the weighted policy (0 to 100). */
  weight: number;
  /** Lower number = preferred under primary/secondary policies. */
  priority: number;
  /** Drained: takes no new traffic. */
  maintenance: boolean;
  version: string;
  lastHealthyAt: number | null;
  lastFailoverAt: number | null;
  /** When the origin last came back healthy; used to ramp its weight up gradually. */
  recoveredAt?: number | null;
}

export type PolicyKind = 'primary_only' | 'weighted' | 'secondary_only' | 'maintenance' | 'emergency';

export interface TrafficPolicy {
  kind: PolicyKind;
  /** Under emergency: the route classes that are switched off (safety, active trips and support never are). */
  disabled?: RouteClass[];
  /** Optional message shown to clients in the 503 envelope while restricted. */
  notice?: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export type RouteClass =
  | 'auth'
  | 'users'
  | 'drivers'
  | 'rides_create'
  | 'rides_active'
  | 'fares'
  | 'offers'
  | 'payments'
  | 'files'
  | 'notifications'
  | 'support'
  | 'safety'
  /** Provider callbacks (WhatsApp messages, D-064): no user token; the API checks the provider's signature. */
  | 'webhooks';

export const ROUTE_CLASSES: readonly RouteClass[] = ['auth', 'users', 'drivers', 'rides_create', 'rides_active', 'fares', 'offers', 'payments', 'files', 'notifications', 'support', 'safety', 'webhooks'];

/** Never switched off by maintenance or emergency: people in a car must keep their trip, safety and help. */
export const ALWAYS_ALLOWED: readonly RouteClass[] = ['rides_active', 'safety', 'support'];

/** Maintenance pauses new bookings and their negotiation; everything else keeps working. */
export const PAUSED_IN_MAINTENANCE: readonly RouteClass[] = ['rides_create', 'offers', 'fares'];

export function isRouteAllowed(policy: TrafficPolicy, routeClass: RouteClass): boolean {
  if (ALWAYS_ALLOWED.includes(routeClass)) return true;
  if (policy.kind === 'maintenance') return !PAUSED_IN_MAINTENANCE.includes(routeClass);
  if (policy.kind === 'emergency') return !(policy.disabled ?? []).includes(routeClass);
  return true;
}

export const POLICY_LABEL: Record<PolicyKind, string> = {
  primary_only: 'Primary only',
  weighted: 'Weighted',
  secondary_only: 'Secondary only',
  maintenance: 'Maintenance (new bookings paused)',
  emergency: 'Emergency restrictions',
};

export const ROUTE_CLASS_LABEL: Record<RouteClass, string> = {
  auth: 'Sign in and codes',
  users: 'Profiles',
  drivers: 'Driver profiles and documents',
  rides_create: 'New bookings',
  rides_active: 'Trips in progress',
  fares: 'Fare quotes',
  offers: 'Offers and counters',
  payments: 'Payments',
  files: 'File uploads and downloads',
  notifications: 'Notifications',
  support: 'Support',
  safety: 'Safety and emergency',
  webhooks: 'Provider callbacks (WhatsApp booking)',
};
