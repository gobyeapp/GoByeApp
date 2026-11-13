/**
 * Driver identity checks (D-066: QoreID) and the "results come home" rule (D-067).
 *
 * Staff never sign in to the provider's own portal to verify a driver. The API calls the provider and
 * stores each result. The admin driver page shows it next to the documents, and staff make the decision
 * there. Until QoreID is connected, `simulatedIdentityChecks` gives a deterministic stand in that the UI
 * must label as simulated.
 */
import type { DriverRecord, IntegrationRecord } from './types';

export type IdentityCheckKind = 'nin' | 'licence' | 'face_match' | 'liveness' | 'plate';
/** `needs_review`: the provider answered but something did not match exactly (for example a name spelling). */
export type IdentityCheckOutcome = 'passed' | 'needs_review' | 'failed' | 'not_run';

export interface IdentityCheckResult {
  kind: IdentityCheckKind;
  outcome: IdentityCheckOutcome;
  provider: string;
  checkedAt?: number;
  /** The provider's reference for this lookup, so a dispute can be traced without opening their portal. */
  reference?: string;
  detail: string;
  /** Field by field comparison with what the driver entered. */
  fields?: { field: string; matched: boolean }[];
}

export const IDENTITY_PROVIDER = 'QoreID';

export const IDENTITY_CHECKS: { kind: IdentityCheckKind; label: string; what: string }[] = [
  { kind: 'nin', label: 'NIN', what: 'National identity number exists and the name and date of birth match' },
  { kind: 'licence', label: 'Driver’s licence', what: 'Licence number is valid, not expired, and belongs to this person' },
  { kind: 'face_match', label: 'Face match', what: 'The driver’s selfie matches the NIN or licence photo' },
  { kind: 'liveness', label: 'Liveness', what: 'The selfie was taken live, not a photo of a photo' },
  { kind: 'plate', label: 'Vehicle plate', what: 'The plate is registered and matches the make and colour given' },
];

const NOT_RUN: Record<IdentityCheckKind, string> = {
  nin: 'Runs when the driver submits their NIN',
  licence: 'Runs when the driver submits their licence',
  face_match: 'Runs after the selfie is taken',
  liveness: 'Runs after the selfie is taken',
  plate: 'Runs when the vehicle is added',
};

/** Deterministic stand in for QoreID results, derived from the driver's review state. Always label it simulated. */
export function simulatedIdentityChecks(driver: DriverRecord, now: number): IdentityCheckResult[] {
  const at = Math.min(now, driver.appliedAt + 60 * 60 * 1000);
  const ref = (k: IdentityCheckKind) => `SIM-${k.toUpperCase()}-${driver.id.replace(/\D/g, '')}`;
  return IDENTITY_CHECKS.map(({ kind }): IdentityCheckResult => {
    const base = { kind, provider: IDENTITY_PROVIDER };
    if (driver.verification === 'applied') return { ...base, outcome: 'not_run', detail: NOT_RUN[kind] };
    if (driver.verification === 'documents_pending' && kind === 'plate') return { ...base, outcome: 'not_run', detail: NOT_RUN[kind] };
    if (driver.verification === 'rejected' && kind === 'licence') {
      return { ...base, outcome: 'failed', checkedAt: at, reference: ref(kind), detail: 'Licence number not found', fields: [{ field: 'Licence number', matched: false }] };
    }
    if (driver.verification === 'in_review' && kind === 'nin') {
      return { ...base, outcome: 'needs_review', checkedAt: at, reference: ref(kind), detail: 'Middle name differs from the NIN record', fields: [{ field: 'First and last name', matched: true }, { field: 'Middle name', matched: false }, { field: 'Date of birth', matched: true }] };
    }
    const fields =
      kind === 'nin' ? [{ field: 'Name', matched: true }, { field: 'Date of birth', matched: true }]
      : kind === 'licence' ? [{ field: 'Licence number', matched: true }, { field: 'Name', matched: true }, { field: 'Not expired', matched: true }]
      : kind === 'plate' ? [{ field: 'Plate registered', matched: true }, { field: 'Make and colour', matched: true }]
      : undefined;
    const detail = kind === 'face_match' ? 'Selfie matches the NIN photo' : kind === 'liveness' ? 'Live selfie confirmed' : 'All details match';
    return { ...base, outcome: 'passed', checkedAt: at, reference: ref(kind), detail, fields };
  });
}

export function identityCheckSummary(results: IdentityCheckResult[]): { passed: number; attention: number; notRun: number; allPassed: boolean } {
  const passed = results.filter((r) => r.outcome === 'passed').length;
  const attention = results.filter((r) => r.outcome === 'failed' || r.outcome === 'needs_review').length;
  const notRun = results.filter((r) => r.outcome === 'not_run').length;
  return { passed, attention, notRun, allPassed: results.length > 0 && passed === results.length };
}

/**
 * D-067: every integration must say where its results show in our own dashboards. Returns the ones that
 * do not, so a test can fail when a new integration is added without a home for its results.
 */
export function integrationsWithoutDashboard(list: IntegrationRecord[]): IntegrationRecord[] {
  return list.filter((i) => !i.resultsShownIn?.length);
}
