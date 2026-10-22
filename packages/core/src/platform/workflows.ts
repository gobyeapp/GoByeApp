import type {
  AnnouncementStatus,
  CampaignStatus,
  CaseStatus,
  CollectionStatus,
  ConfigVersion,
  ConnectionState,
  DriverVerification,
  RefundStatus,
  WithdrawalStatus,
} from './types';

/**
 * Status transitions for management records (brief §10 "status transitions"). One table per record;
 * the admin UI only offers actions whose target status is allowed here, and the backend must enforce
 * the same table.
 */
type Machine<S extends string> = Record<S, readonly S[]>;

export const WITHDRAWAL_FLOW: Machine<WithdrawalStatus> = {
  requested: ['under_review', 'processing', 'rejected'],
  under_review: ['processing', 'rejected'],
  // "Processing" = transfer submitted to the provider. Submitted is not paid: only the provider's
  // final event moves it on (successful / failed); a later reversal is its own event.
  processing: ['successful', 'failed'],
  successful: ['reversed'],
  failed: [],
  reversed: [],
  rejected: [],
};

export const REFUND_FLOW: Machine<RefundStatus> = {
  requested: ['approved', 'rejected'],
  approved: ['processing'],
  processing: ['completed', 'failed'],
  failed: ['processing'],
  completed: [],
  rejected: [],
};

export const CASE_FLOW: Machine<CaseStatus> = {
  new: ['in_progress', 'escalated', 'resolved'],
  in_progress: ['waiting', 'escalated', 'resolved'],
  waiting: ['in_progress', 'escalated', 'resolved'],
  escalated: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export const VERIFICATION_FLOW: Machine<DriverVerification> = {
  applied: ['documents_pending', 'in_review', 'rejected'],
  documents_pending: ['in_review', 'rejected'],
  in_review: ['approved', 'documents_pending', 'rejected'],
  approved: ['suspended'],
  rejected: ['in_review'],
  suspended: ['approved', 'rejected'],
};

export const COLLECTION_FLOW: Machine<CollectionStatus> = {
  initiated: ['pending', 'abandoned', 'failed'],
  pending: ['successful', 'failed', 'abandoned'],
  successful: ['reversed'],
  failed: [],
  abandoned: [],
  reversed: [],
};

export const ANNOUNCEMENT_FLOW: Machine<AnnouncementStatus> = {
  draft: ['pending_approval', 'scheduled', 'sending', 'cancelled'],
  pending_approval: ['draft', 'scheduled', 'sending', 'cancelled'],
  scheduled: ['sending', 'draft', 'cancelled'],
  sending: ['sent', 'partly_failed'],
  partly_failed: ['sending', 'sent'],
  sent: [],
  cancelled: [],
};

export const CAMPAIGN_FLOW: Machine<CampaignStatus> = {
  draft: ['pending_approval', 'scheduled', 'active'],
  pending_approval: ['draft', 'scheduled', 'active', 'rejected'],
  scheduled: ['active', 'draft', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
  rejected: ['draft'],
};

/**
 * Integration readiness: `live` only after every required check has passed in that environment
 * (brief §6). Any failing check while live is `degraded`, which dependent screens show honestly.
 */
export const CONNECTION_FLOW: Machine<ConnectionState> = {
  prototype: ['configured'],
  configured: ['tested', 'prototype'],
  tested: ['live', 'configured'],
  live: ['degraded', 'configured'],
  degraded: ['live', 'configured'],
};

export function canTransition<S extends string>(machine: Machine<S>, from: S, to: S): boolean {
  return machine[from]?.includes(to) ?? false;
}

export function nextStatuses<S extends string>(machine: Machine<S>, from: S): readonly S[] {
  return machine[from] ?? [];
}

export function canGoLive(checks: { passed: boolean }[]): boolean {
  return checks.length > 0 && checks.every((c) => c.passed);
}

/**
 * Configuration versions: the value in force at `at` is the latest active-or-scheduled version whose
 * effective date has passed. Bookings, purchased passes and earned rewards keep the version that was
 * in force when they were created (store its id on the record).
 */
export function versionInForce<T>(versions: readonly ConfigVersion<T>[], at: number): ConfigVersion<T> | undefined {
  return versions
    .filter((v) => (v.status === 'active' || v.status === 'scheduled' || v.status === 'superseded') && v.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.version - a.version)[0];
}
