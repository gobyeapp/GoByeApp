import type { Result, VehicleCategoryId, VerificationStatus } from '../types';

/**
 * Driver registration (D03–D08). Pure rules shared by the driver app and, later, the backend.
 * Document checks here are format checks only: real verification (NIN lookup, licence check with the
 * FRSC, vehicle papers) is a backend/partner task and is simulated in the preview.
 */

export type OnboardingStepId = 'personal' | 'licence' | 'identity' | 'vehicle' | 'documents';

export const ONBOARDING_STEPS: readonly OnboardingStepId[] = ['personal', 'licence', 'identity', 'vehicle', 'documents'];

export type IdentityDocumentType = 'nin' | 'voters_card' | 'passport';

export type VehicleDocumentId = 'registration' | 'insurance' | 'roadworthiness';

export const VEHICLE_DOCUMENTS: readonly { id: VehicleDocumentId; title: string; hint: string }[] = [
  { id: 'registration', title: 'Vehicle licence', hint: 'The current vehicle licence (registration) for this car.' },
  { id: 'insurance', title: 'Insurance certificate', hint: 'Third party insurance at minimum, not expired.' },
  { id: 'roadworthiness', title: 'Roadworthiness certificate', hint: 'Issued by your state’s vehicle inspection office.' },
];

export interface DriverPersonalDetails {
  firstName: string;
  lastName: string;
  email?: string;
  /** Launch city the driver will work in (Q-007). */
  city: 'Lagos' | 'Abuja';
}

export interface DriverLicenceDetails {
  number: string;
  /** ISO date YYYY-MM-DD. */
  expiry: string;
  photoUri?: string;
}

export interface DriverIdentityDetails {
  type: IdentityDocumentType;
  number: string;
  selfieUri?: string;
}

export interface DriverVehicleDetails {
  category: VehicleCategoryId;
  make: string;
  model: string;
  year: number;
  colour: string;
  plate: string;
}

export interface DriverApplication {
  personal?: DriverPersonalDetails;
  licence?: DriverLicenceDetails;
  identity?: DriverIdentityDetails;
  vehicle?: DriverVehicleDetails;
  documents: Partial<Record<VehicleDocumentId, string>>;
  status: VerificationStatus;
  submittedAt?: number;
  /** Reason shown when status is `rejected`. */
  rejectionReason?: string;
}

export const emptyApplication: DriverApplication = { documents: {}, status: 'not_started' };

/** Oldest model year accepted (placeholder until operations confirm, Q-OPEN). */
export const MIN_VEHICLE_YEAR = 2008;

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/** Nigerian driver's licence numbers are 3 letters followed by 9 to 11 letters/digits (format check only). */
export function validateLicenceNumber(input: string): Result<string> {
  const v = input.replace(/[\s-]/g, '').toUpperCase();
  if (!v) return fail('Enter your licence number.');
  if (!/^[A-Z]{3}[A-Z0-9]{9,11}$/.test(v)) return fail('Check the number. It’s on the front of your licence, for example ABC12345AA12.');
  return ok(v);
}

/** Expiry must be a real date in the future (a licence expiring today is already invalid for trips). */
export function validateExpiry(input: string, now: number): Result<string> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return fail('Enter the date as YYYY-MM-DD.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return fail('That date doesn’t exist.');
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() <= todayUtc) return fail('This licence has expired. Renew it before you apply.');
  return ok(`${m[1]}-${m[2]}-${m[3]}`);
}

/** Identity numbers: NIN = 11 digits; voter's card = 19 characters; passport = 1 letter + 8 digits. */
export function validateIdentityNumber(type: IdentityDocumentType, input: string): Result<string> {
  const v = input.replace(/\s/g, '').toUpperCase();
  if (!v) return fail('Enter the number on your document.');
  switch (type) {
    case 'nin':
      return /^\d{11}$/.test(v) ? ok(v) : fail('Your NIN is 11 digits.');
    case 'voters_card':
      return /^[A-Z0-9]{19}$/.test(v) ? ok(v) : fail('Your voter’s card number (VIN) is 19 letters and digits.');
    case 'passport':
      return /^[A-Z]\d{8}$/.test(v) ? ok(v) : fail('Passport numbers are one letter followed by 8 digits.');
  }
}

/** Nigerian plates: 3 letters, 3 digits, 2 letters (e.g. "KJA 123 AB"). Returned in the spaced form. */
export function validatePlate(input: string): Result<string> {
  const v = input.replace(/[\s-]/g, '').toUpperCase();
  const m = /^([A-Z]{3})(\d{3})([A-Z]{2})$/.exec(v);
  if (!m) return fail('Enter the plate as it appears, for example KJA 123 AB.');
  return ok(`${m[1]} ${m[2]} ${m[3]}`);
}

export function validateVehicleYear(input: string | number, now: number): Result<number> {
  const year = typeof input === 'number' ? input : Number(String(input).trim());
  const max = new Date(now).getUTCFullYear() + 1;
  if (!Number.isInteger(year) || String(year).length !== 4) return fail('Enter the 4 digit model year.');
  if (year > max) return fail('Check the year.');
  if (year < MIN_VEHICLE_YEAR) return fail(`Vehicles must be ${MIN_VEHICLE_YEAR} or newer.`);
  return ok(year);
}

/** Whether a step has everything it needs. */
export function isStepComplete(app: DriverApplication, step: OnboardingStepId): boolean {
  switch (step) {
    case 'personal':
      return !!app.personal?.firstName && !!app.personal.lastName;
    case 'licence':
      return !!app.licence?.number && !!app.licence.expiry && !!app.licence.photoUri;
    case 'identity':
      return !!app.identity?.number && !!app.identity.selfieUri;
    case 'vehicle':
      return !!app.vehicle?.plate && !!app.vehicle.make;
    case 'documents':
      return VEHICLE_DOCUMENTS.every((d) => !!app.documents[d.id]);
  }
}

/** First incomplete step, or null when the application can be submitted. */
export function nextOnboardingStep(app: DriverApplication): OnboardingStepId | null {
  return ONBOARDING_STEPS.find((s) => !isStepComplete(app, s)) ?? null;
}

export function onboardingProgress(app: DriverApplication): { done: number; total: number } {
  return { done: ONBOARDING_STEPS.filter((s) => isStepComplete(app, s)).length, total: ONBOARDING_STEPS.length };
}

/** Submit for review: only a complete application that isn't already approved or in review. */
export function submitApplication(app: DriverApplication, now: number): Result<DriverApplication> {
  if (app.status === 'approved') return fail('Your account is already approved.');
  if (app.status === 'pending_review') return fail('Your documents are already being reviewed.');
  const missing = nextOnboardingStep(app);
  if (missing) return fail('Finish every step before you submit.');
  return ok({ ...app, status: 'pending_review', submittedAt: now, rejectionReason: undefined });
}

/** Status for a partly filled application that hasn't been submitted. */
export function draftStatus(app: DriverApplication): VerificationStatus {
  if (app.status === 'pending_review' || app.status === 'approved' || app.status === 'rejected') return app.status;
  return onboardingProgress(app).done === 0 ? 'not_started' : 'in_progress';
}

/** Only approved drivers can go online (BR-070). */
export function canDrive(app: DriverApplication): boolean {
  return app.status === 'approved';
}

/** NUBAN account numbers are 10 digits (format check only; name lookup is a backend task). */
export function validateAccountNumber(input: string): Result<string> {
  const v = input.replace(/\s/g, '');
  return /^\d{10}$/.test(v) ? ok(v) : fail('Account numbers are 10 digits.');
}

/** Banks offered in the payout form (preview list; the backend will supply the CBN bank list). */
export const NIGERIAN_BANKS = ['Access Bank', 'First Bank', 'GTBank', 'Kuda', 'Moniepoint', 'OPay', 'PalmPay', 'Stanbic IBTC', 'UBA', 'Wema Bank', 'Zenith Bank'] as const;
