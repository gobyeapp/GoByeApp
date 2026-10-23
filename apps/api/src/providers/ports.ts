/**
 * Provider-independent interfaces (BACKEND_ARCHITECTURE.md §8). Business code depends on these only; a
 * provider is a configuration choice. Each port has:
 * - a "not configured" implementation that fails closed with NOT_CONFIGURED (the default everywhere);
 * - a fake for development and tests (refused in production by config validation);
 * - real adapters added later, each behind the same contract tests.
 *
 * Payments reuse the existing contract in packages/core/src/gateway/adapter.ts (PaymentGatewayAdapter,
 * D-054) and storage reuses packages/core/src/files ObjectStore, so the apps' rules and the server's
 * cannot drift.
 */
import type { LatLng, ObjectStore, PaymentGatewayAdapter } from '@gobye/core';

export type { ObjectStore, PaymentGatewayAdapter };

/* ---------- Maps (D-025: Google Maps Platform proposed, not decided) ---------- */

export interface PlaceResult {
  id: string;
  label: string;
  secondary: string | null;
  location: LatLng;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Encoded polyline for drawing; never trusted for pricing without server recomputation. */
  polyline: string | null;
}

export interface MapsProvider {
  readonly name: string;
  searchPlaces(query: string, near: LatLng | null, sessionToken: string): Promise<PlaceResult[]>;
  reverseGeocode(at: LatLng): Promise<PlaceResult | null>;
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
}

/* ---------- Notifications (SMS/OTP via Supabase Auth; these are product messages) ---------- */

export type NotificationChannel = 'push' | 'sms' | 'email';

export interface NotificationMessage {
  /** Stable id: the same message is never sent twice (provider idempotency where supported). */
  id: string;
  channel: NotificationChannel;
  to: { userId: string; address: string };
  template: string;
  /** Template variables. Never put one-time codes or full card/bank numbers here. */
  data: Record<string, string>;
}

export interface NotificationResult {
  accepted: boolean;
  providerMessageId: string | null;
}

export interface NotificationSender {
  readonly name: string;
  send(m: NotificationMessage): Promise<NotificationResult>;
}

/* ---------- Bundle ---------- */

export interface Providers {
  payments: PaymentGatewayAdapter | null;
  maps: MapsProvider;
  notifications: NotificationSender;
  storage: ObjectStore;
}
