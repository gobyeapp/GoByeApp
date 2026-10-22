import type { Result } from './types';

/**
 * Nigerian mobile numbers. Accepts 0803 123 4567, 803 123 4567, +234 803 123 4567, 2348031234567.
 * Returns E.164 (+234XXXXXXXXXX). Network-prefix validation is intentionally loose (7/8/9 + 0/1)
 * because prefixes change; the OTP step proves ownership.
 */
export function validateNigerianPhone(input: string): Result<string> {
  const digits = input.replace(/[\s\-().]/g, '');
  let national: string;
  if (/^\+234\d{10}$/.test(digits)) national = digits.slice(4);
  else if (/^234\d{10}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{10}$/.test(digits)) national = digits;
  else return { ok: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567.' };
  if (!/^[789][01]\d{8}$/.test(national)) {
    return { ok: false, error: 'That doesn’t look like a Nigerian mobile number.' };
  }
  return { ok: true, value: `+234${national}` };
}

/** Display format: +234 803 123 4567 */
export function formatPhone(e164: string | null | undefined): string {
  // Null-safe: a profile restored from older stored data may have no number yet.
  if (!e164) return '';
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function validateOtp(input: string): Result<string> {
  const code = input.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6 digit code.' };
  return { ok: true, value: code };
}

export function validateName(input: string, field = 'Name'): Result<string> {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 2) return { ok: false, error: `${field} must be at least 2 characters.` };
  if (value.length > 40) return { ok: false, error: `${field} must be 40 characters or fewer.` };
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(value)) return { ok: false, error: `${field} can only contain letters, spaces, hyphens and apostrophes.` };
  return { ok: true, value };
}

export function validateEmail(input: string): Result<string | undefined> {
  const value = input.trim();
  if (!value) return { ok: true, value: undefined };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, value: value.toLowerCase() };
}

export function validateRatingComment(input: string): Result<string | undefined> {
  const value = input.trim();
  if (value.length > 300) return { ok: false, error: 'Comments can be up to 300 characters.' };
  return { ok: true, value: value || undefined };
}

/** Passwords: 8 to 128 characters with at least one letter and one number. */
export function validatePassword(input: string): Result<string> {
  if (input.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (input.length > 128) return { ok: false, error: 'Use 128 characters or fewer.' };
  if (!/[A-Za-z]/.test(input) || !/\d/.test(input)) return { ok: false, error: 'Include at least one letter and one number.' };
  return { ok: true, value: input };
}

/** "Ada Okafor" → first and last name. Both are needed (drivers see the first name only). */
export function validateFullName(input: string): Result<{ firstName: string; lastName: string }> {
  if (!input.trim()) return { ok: false, error: 'Enter your first and last name.' };
  const v = validateName(input, 'Name');
  if (!v.ok) return v;
  const parts = v.value.split(' ');
  if (parts.length < 2) return { ok: false, error: 'Enter your first and last name.' };
  return { ok: true, value: { firstName: parts[0], lastName: parts.slice(1).join(' ') } };
}

/** Sign-in identifier: an email address or a Nigerian mobile number. */
export function parseIdentifier(input: string): Result<{ kind: 'email'; value: string } | { kind: 'phone'; value: string }> {
  const v = input.trim();
  if (!v) return { ok: false, error: 'Enter your email or phone number.' };
  if (v.includes('@')) {
    const e = validateEmail(v);
    return e.ok && e.value ? { ok: true, value: { kind: 'email', value: e.value } } : { ok: false, error: 'Enter a valid email address.' };
  }
  const p = validateNigerianPhone(v);
  return p.ok ? { ok: true, value: { kind: 'phone', value: p.value } } : { ok: false, error: 'Enter a valid email or Nigerian phone number.' };
}

/** States other than Lagos and the FCT (those two are GoBye's launch cities). Same list as the website waitlist. */
export const OTHER_NIGERIAN_STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'] as const;

export type PasswordStrength = 'empty' | 'weak' | 'okay' | 'strong';

/** Live feedback while typing. "okay" meets the rule (validatePassword); "strong" is 12+ or mixes in a symbol/case. */
export function passwordStrength(input: string): PasswordStrength {
  if (!input) return 'empty';
  if (!validatePassword(input).ok) return 'weak';
  const extra = (/[^A-Za-z0-9]/.test(input) ? 1 : 0) + (/[a-z]/.test(input) && /[A-Z]/.test(input) ? 1 : 0);
  return input.length >= 12 || extra >= 1 ? 'strong' : 'okay';
}
