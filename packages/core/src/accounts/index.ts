/**
 * Accounts (Backend Phase 2, WP1): the rules shared by the API and the apps for creating a rider or
 * driver profile after sign-in, recording consent, registering devices and deleting an account.
 * Supabase Auth owns credentials and sessions; these rules own everything GoBye stores about a person.
 */

export type AccountRole = 'rider' | 'driver';
export type ConsentDocument = 'terms' | 'privacy';
export type DevicePlatform = 'ios' | 'android' | 'web';

/**
 * The document versions a person must have accepted. PLACEHOLDERS until legal supplies the final texts
 * and version ids (A-10, Q-063). Bumping a version makes `consentsNeeded` ask everyone again.
 */
export const CURRENT_CONSENTS: Record<ConsentDocument, string> = {
  terms: '2026-11-draft',
  privacy: '2026-11-draft',
};

export interface ConsentRecord {
  document: ConsentDocument;
  version: string;
}

/** Documents whose current version the person has not accepted yet. */
export function consentsNeeded(accepted: ConsentRecord[], current: Record<ConsentDocument, string> = CURRENT_CONSENTS): ConsentRecord[] {
  return (Object.keys(current) as ConsentDocument[])
    .filter((d) => !accepted.some((a) => a.document === d && a.version === current[d]))
    .map((d) => ({ document: d, version: current[d] }));
}

/** Consents in a request must be exactly the current versions (no old or unknown ones). */
export function invalidConsents(given: ConsentRecord[], current: Record<ConsentDocument, string> = CURRENT_CONSENTS): string[] {
  return given.filter((g) => current[g.document] !== g.version).map((g) => `${g.document}@${g.version}`);
}

/** Only Nigerian mobile numbers can hold a GoBye account (WP0 abuse control): +234, then 10 digits. */
export function isNigerianPhone(e164: string | null | undefined): boolean {
  return !!e164 && /^\+234[789][01]\d{8}$/.test(e164);
}

/** Supabase writes phone numbers without the "+"; the database stores E.164 with it. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const p = phone.trim().replace(/[\s-]/g, '');
  return p.startsWith('+') ? p : `+${p}`;
}

/** Days between asking to delete an account and the data being removed (time to change one's mind). */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;

export function deletionDueAt(requestedAt: number, graceDays: number = ACCOUNT_DELETION_GRACE_DAYS): number {
  return requestedAt + graceDays * 86_400_000;
}

/**
 * Device check under the proposed D-062 (A-3 option b): the phone is verified at sign-up, again on a new
 * device, and on sensitive changes. The device used at sign-up counts as verified because the phone code
 * was just confirmed on it.
 */
export function deviceVerificationRequired(device: { verifiedAt: number | null } | null): boolean {
  return !device || device.verifiedAt === null;
}

/** What an anonymised (deleted) person looks like in our records. Trips and audit keep the id only. */
export const DELETED_USER_NAME = 'Deleted user';
