import type { Kobo, PaymentMethodType } from '../types';
import type { StaffRole } from './permissions';

/**
 * Shared management records (owner brief 2026-10-21 §9): every workspace reads the same records by the
 * same ids. A trip opened from Support is the trip Operations and Finance see; access differs, not data.
 */

export type CityId = 'lagos' | 'abuja';
export const CITY_LABELS: Record<CityId, string> = { lagos: 'Lagos', abuja: 'Abuja' };

/** Who did something, for audit trails and timelines. `system` = automated job; `provider` = webhook. */
export type Actor = { kind: 'staff'; id: string; name: string } | { kind: 'system'; name: string } | { kind: 'provider'; name: string } | { kind: 'passenger' | 'driver'; id: string; name: string };

export interface AuditEvent {
  id: string;
  at: number;
  actor: Actor;
  /** e.g. "driver.approved", "config.published", "refund.approved" */
  action: string;
  /** Shared record reference, e.g. { type: 'driver', id: 'drv-…' } */
  target: { type: RecordType; id: string; label: string };
  summary: string;
  /** Before/after for changes to settings or records (masked for secrets). */
  diff?: { field: string; from: string; to: string }[];
  reason?: string;
}

export type RecordType =
  | 'passenger'
  | 'driver'
  | 'trip'
  | 'case'
  | 'ledger_entry'
  | 'withdrawal'
  | 'refund'
  | 'collection'
  | 'config'
  | 'package'
  | 'campaign'
  | 'announcement'
  | 'integration'
  | 'staff'
  | 'approval'
  | 'event'
  | 'fee_schedule'
  | 'automation'
  | 'automation_run';

export interface PassengerRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city: CityId;
  joinedAt: number;
  status: 'active' | 'restricted' | 'closed';
  restriction?: { reason: string; until?: number; by: string };
  trips: number;
  lastTripAt?: number;
  rating: number;
}

export type DriverVerification = 'applied' | 'documents_pending' | 'in_review' | 'approved' | 'rejected' | 'suspended';
export type DocumentKind = 'licence' | 'vehicle_registration' | 'insurance' | 'roadworthiness' | 'id_card' | 'photo';
export interface DriverDocument {
  kind: DocumentKind;
  status: 'missing' | 'submitted' | 'accepted' | 'rejected' | 'expired';
  expiresAt?: number;
  note?: string;
}

export interface DriverRecord {
  id: string;
  name: string;
  phone: string;
  city: CityId;
  appliedAt: number;
  verification: DriverVerification;
  rejectionReason?: string;
  documents: DriverDocument[];
  vehicle: { make: string; model: string; colour: string; year: number; plate: string; category: string };
  /** Driver access package (D-024); access is what lets a verified driver go online. */
  access: { packageId: 'daily' | 'monthly'; expiresAt: number } | null;
  online: boolean;
  rating: number;
  trips: number;
  acceptanceRate: number;
  bankAccount?: { bankName: string; accountNumberMasked: string; accountName: string; verified: boolean };
}

export type TripStatus = 'searching' | 'matched' | 'en_route' | 'arrived' | 'in_progress' | 'payment_pending' | 'completed' | 'cancelled' | 'no_driver';
export type TripPaymentState = 'not_due' | 'pending' | 'processing' | 'paid' | 'failed' | 'refunded' | 'partly_refunded';

export interface TripRecord {
  id: string;
  /** Short reference shown to passengers, e.g. "#K3F9A2". */
  ref: string;
  city: CityId;
  passengerId: string;
  driverId?: string;
  pickup: string;
  destination: string;
  requestedAt: number;
  completedAt?: number;
  status: TripStatus;
  mode: 'quick_match' | 'negotiate';
  suggestedFare: Kobo;
  agreedFare?: Kobo;
  paymentMethod: PaymentMethodType;
  payment: TripPaymentState;
  /** Direct transfer to a driver's own account: recorded, never credited to withdrawable earnings. */
  directToDriver?: boolean;
  cancellation?: { by: 'passenger' | 'driver' | 'system'; reason: string; fee: Kobo };
  /** Pickup delay beyond the first estimate, in seconds (operations "delayed pickup"). */
  pickupDelaySeconds?: number;
  timeline: { at: number; label: string }[];
}

export type CaseCategory = 'payment' | 'fare' | 'driver_conduct' | 'passenger_conduct' | 'lost_item' | 'app_problem' | 'account' | 'safety';
export type CasePriority = 'urgent' | 'high' | 'normal' | 'low';
export type CaseStatus = 'new' | 'in_progress' | 'waiting' | 'escalated' | 'resolved' | 'closed';

export interface CaseMessage {
  id: string;
  at: number;
  /** `customer` messages are visible to the passenger or driver; `internal` notes never are. */
  channel: 'customer' | 'internal';
  author: Actor;
  body: string;
}

export interface CaseRecord {
  id: string;
  ref: string;
  team: 'care' | 'safety';
  category: CaseCategory;
  priority: CasePriority;
  status: CaseStatus;
  subject: string;
  ownerId?: string;
  openedAt: number;
  openedBy: Actor;
  city: CityId;
  links: { passengerId?: string; driverId?: string; tripId?: string; ledgerEntryId?: string; refundId?: string };
  messages: CaseMessage[];
  actions: { at: number; by: Actor; label: string }[];
  resolution?: { at: number; summary: string; followUpAt?: number };
  /** Safety: latest known location shared with the alert (restricted: safety.location). */
  safetyContext?: { lastLocation: string; sharedAt: number; responders: string[] };
}

/** Ledger accounts. Balances are derived from entries; nobody edits a balance directly. */
export type LedgerAccount =
  | { kind: 'passenger_wallet'; ownerId: string }
  | { kind: 'driver_earnings'; ownerId: string }
  | { kind: 'driver_withdrawal_reserve'; ownerId: string }
  | { kind: 'company_revenue' }
  | { kind: 'provider_clearing'; provider: string }
  | { kind: 'promotions_expense' }
  | { kind: 'processing_costs' }
  /** GoBye's own transaction fees (wallet funding, withdrawals), kept apart from package revenue (D-054). */
  | { kind: 'fee_income' }
  /** Unexplained differences found in reconciliation, held here until investigated and cleared. */
  | { kind: 'suspense' };

export type LedgerEntryKind =
  | 'wallet_funding'
  | 'trip_charge'
  | 'driver_trip_earning'
  | 'package_purchase'
  | 'refund'
  | 'withdrawal_reserve'
  | 'withdrawal_release'
  | 'withdrawal_payout'
  | 'referral_reward'
  | 'processing_fee'
  | 'adjustment'
  | 'reversal';

export interface LedgerEntry {
  id: string;
  /** Entries posted together (double entry): their amounts sum to zero. */
  journalId: string;
  at: number;
  account: LedgerAccount;
  /** Signed kobo: + increases the account, − decreases it. */
  amount: Kobo;
  kind: LedgerEntryKind;
  description: string;
  /** Provider or internal reference for reconciliation. */
  reference?: string;
  provider?: string;
  links?: { tripId?: string; withdrawalId?: string; refundId?: string; caseId?: string; collectionId?: string };
  createdBy: Actor;
  /** Corrections point at what they correct; required with a reason. */
  reverses?: string;
  reason?: string;
}

export type CollectionStatus = 'initiated' | 'pending' | 'successful' | 'failed' | 'abandoned' | 'reversed';
export interface CollectionRecord {
  id: string;
  purpose: 'wallet_funding' | 'package_purchase' | 'trip_payment';
  payerType: 'passenger' | 'driver';
  payerId: string;
  amount: Kobo;
  fee: Kobo;
  provider: string;
  reference: string;
  status: CollectionStatus;
  createdAt: number;
  verifiedAt?: number;
  /** Webhook deliveries seen for this reference; duplicates are recorded, never re-applied. */
  events: { at: number; event: string; duplicate?: boolean }[];
}

export type WithdrawalStatus = 'requested' | 'under_review' | 'processing' | 'successful' | 'failed' | 'reversed' | 'rejected';
export interface WithdrawalRecord {
  id: string;
  driverId: string;
  amount: Kobo;
  bankAccount: { bankName: string; accountNumberMasked: string; accountName: string };
  status: WithdrawalStatus;
  requestedAt: number;
  provider?: string;
  transferReference?: string;
  reviewNote?: string;
  history: { at: number; status: WithdrawalStatus; by: Actor; note?: string }[];
}

export type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
export interface RefundRecord {
  id: string;
  tripId?: string;
  caseId?: string;
  passengerId: string;
  amount: Kobo;
  reason: string;
  destination: 'wallet' | 'original_method';
  status: RefundStatus;
  requestedBy: Actor;
  approvedBy?: Actor;
  requestedAt: number;
  providerResult?: string;
}

export interface SettlementRecord {
  id: string;
  provider: string;
  periodStart: number;
  periodEnd: number;
  collected: Kobo;
  fees: Kobo;
  settled: Kobo;
  settledAt?: number;
  bankReference?: string;
  /** Difference between provider total and our ledger for the same period. */
  ledgerTotal: Kobo;
}

/** Integration connection state (brief §10): a finished-looking screen is never mistaken for a working one. */
export type ConnectionState = 'prototype' | 'configured' | 'tested' | 'live' | 'degraded';
export type IntegrationArea = 'payments' | 'email' | 'sms' | 'push' | 'maps' | 'auth' | 'database' | 'storage' | 'monitoring' | 'jobs' | 'identity';

export interface IntegrationRecord {
  id: string;
  area: IntegrationArea;
  provider: string;
  environment: 'test' | 'live';
  state: ConnectionState;
  owner: string;
  capabilities: string[];
  /** Masked: last 4 only. Secrets never leave protected server storage. */
  credentialHint?: string;
  credentialRotatedAt?: number;
  lastSuccessfulTestAt?: number;
  checks: { name: string; passed: boolean; at?: number; detail?: string }[];
  failures: { at: number; message: string; resolved: boolean }[];
  dependsOn: string[];
  usedBy: string[];
}

export interface ConfigVersion<T = unknown> {
  id: string;
  key: ConfigKey;
  version: number;
  value: T;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'active' | 'superseded' | 'rejected';
  effectiveFrom: number;
  createdBy: Actor;
  createdAt: number;
  approvedBy?: Actor;
  note: string;
}

export type ConfigKey = 'fares' | 'categories' | 'packages' | 'referrals' | 'cancellation' | 'service_areas' | 'payment_methods';

export type CampaignStatus = 'draft' | 'pending_approval' | 'scheduled' | 'active' | 'paused' | 'ended' | 'rejected';
export interface PromoCampaign {
  id: string;
  title: string;
  body: string;
  art: 'sedan' | 'gift' | 'wallet' | 'destination';
  ctaLabel: string;
  ctaRoute: string;
  placements: ('home' | 'wallet')[];
  audience: AudienceFilter;
  startsAt: number;
  endsAt?: number;
  sortOrder: number;
  status: CampaignStatus;
  budget?: Kobo;
  spent: Kobo;
  impressions: number;
  opens: number;
}

export interface AudienceFilter {
  type: 'passenger' | 'driver';
  cities: CityId[];
  statuses?: string[];
  packages?: ('daily' | 'monthly')[];
  eventId?: string;
}

export type AnnouncementStatus = 'draft' | 'pending_approval' | 'scheduled' | 'sending' | 'sent' | 'partly_failed' | 'cancelled';
export type Channel = 'inbox' | 'push' | 'email' | 'sms';
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: AudienceFilter;
  channels: Channel[];
  status: AnnouncementStatus;
  scheduledFor?: number;
  createdBy: Actor;
  approvedBy?: Actor;
  /** Snapshot of what was sent; editing the draft afterwards never changes sent messages. */
  sentVersion?: { title: string; body: string; at: number };
  audienceSize: number;
  delivery: Record<Channel, { attempted: number; delivered: number; failed: number }>;
}

export type ApprovalKind = 'config_publish' | 'refund' | 'ledger_adjustment' | 'withdrawal' | 'payments_activation' | 'announcement' | 'staff_role' | 'fee_schedule' | 'automation_config';
export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  requestedBy: Actor;
  requestedAt: number;
  target: { type: RecordType; id: string; label: string };
  amount?: Kobo;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: Actor;
  decidedAt?: number;
  note?: string;
  /** Who may decide (any one of these roles, and never the requester). */
  approverRoles: StaffRole[];
  /**
   * Ledger corrections only: exactly what posts when approved. Either reverse a whole journal, or post
   * these balanced lines as an `adjustment` journal. Posting is idempotent by approval id.
   */
  adjustment?: { description: string; reverseJournalId?: string; lines?: { account: LedgerAccount; amount: Kobo }[] };
}

export interface EventPartnership {
  id: string;
  name: string;
  partner: string;
  venue: string;
  city: CityId;
  startsAt: number;
  endsAt: number;
  pickupZones: string[];
  sponsorship?: Kobo;
  status: 'planned' | 'live' | 'ended';
  bookings: number;
}
