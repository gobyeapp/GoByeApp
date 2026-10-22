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
export function formatPhone(e164: string): string {
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
