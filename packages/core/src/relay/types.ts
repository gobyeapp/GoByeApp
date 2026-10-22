import type { DriverSummary, Kobo, LatLng, PaymentMethodType, Place, VehicleCategoryId, VerificationStatus } from '../types';
import type { IdentityDocumentType, VehicleDocumentId } from '../driver/onboarding';
import type { VerificationCheck, VerificationIssue } from '../driver/verification';

/**
 * Demo relay (D-049): the shared records that connect the rider app, the driver app and the admin while
 * there is no real backend. The relay is a tiny REST store with the same query shape as Supabase
 * (PostgREST), so the same client talks to the local demo server (`npm run demo:relay`) or to the
 * `demo_*` tables in Supabase. Everything in it is TEST DATA: no real money, no real verification.
 *
 * Times are epoch milliseconds. Money is integer kobo. Column names are snake_case (Postgres style).
 */

export type RelayTable = 'demo_people' | 'demo_driver_applications' | 'demo_rides' | 'demo_ride_responses' | 'demo_events';

export type RelayRole = 'rider' | 'driver';

/** Someone who signed up in one of the apps. `id` is the account's phone number (E.164). */
export interface RelayPerson {
  id: string;
  role: RelayRole;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
}

/**
 * What staff see of a driver's registration. Photos stay on the driver's phone in the demo, so only
 * whether each one was provided is shared; ID and licence numbers are masked to the last four.
 */
export interface SharedApplication {
  personal: { firstName: string; lastName: string; email?: string; city: 'Lagos' | 'Abuja' } | null;
  licence: { number: string; expiry: string; hasPhoto: boolean } | null;
  identity: { type: IdentityDocumentType; number: string; hasSelfie: boolean } | null;
  vehicle: { category: VehicleCategoryId; make: string; model: string; year: number; colour: string; plate: string } | null;
  documents: Record<VehicleDocumentId, boolean>;
}

/** A driver's application as shared with staff. `id` is the driver's phone (same as RelayPerson.id). */
export interface RelayApplication {
  id: string;
  driver_name: string;
  phone: string;
  city: string | null;
  status: VerificationStatus;
  application: SharedApplication;
  checks: VerificationCheck[];
  issues: VerificationIssue[];
  review_note: string | null;
  submitted_at: number | null;
  decided_at: number | null;
  decided_by: string | null;
  updated_at: number;
}

export type RelayRideStatus = 'searching' | 'negotiating' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'expired';

export type RelayPaymentStatus = 'not_due' | 'pending' | 'processing' | 'paid' | 'failed';

export interface RelayRide {
  id: string;
  kind: 'quick_match' | 'negotiate';
  status: RelayRideStatus;
  rider_id: string;
  rider: { name: string; phone: string; rating: number };
  pickup: Place;
  destination: Place;
  /** Downsampled polyline (at most 40 points) so rows stay small. */
  route: { distance_meters: number; duration_seconds: number; polyline: LatLng[] };
  category: VehicleCategoryId;
  /** Platform fare for Quick Match; the platform suggestion for a negotiated ride. */
  fare: Kobo;
  max_counter: Kobo;
  offer: { id: string; amount: Kobo; round: number; expires_at: number } | null;
  pickup_note: string | null;
  payment_method: PaymentMethodType;
  driver_id: string | null;
  driver: DriverSummary | null;
  agreed_fare: Kobo | null;
  driver_location: { coordinate: LatLng; eta_seconds: number; at: number } | null;
  /** Shown to the rider; the driver checks it at pickup. Demo only: real PINs never travel like this. */
  pickup_pin: string | null;
  payment_status: RelayPaymentStatus;
  cancelled_by: 'rider' | 'driver' | 'admin' | null;
  cancel_reason: string | null;
  created_at: number;
  matched_at: number | null;
  arrived_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

/** A driver's answer to a rider's offer (insert only, so drivers never overwrite each other). */
export interface RelayResponse {
  id: string;
  ride_id: string;
  offer_id: string;
  driver_id: string;
  driver: DriverSummary;
  kind: 'accept' | 'counter';
  amount: Kobo;
  eta_seconds: number;
  created_at: number;
  expires_at: number;
}

export interface RelayEvent {
  id: string;
  at: number;
  actor: 'rider' | 'driver' | 'admin';
  type: string;
  summary: string;
  ride_id: string | null;
  person_id: string | null;
}
