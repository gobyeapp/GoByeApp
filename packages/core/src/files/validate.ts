import { FILE_RULES, type MimeType } from './policy';
import type { FileClass } from './types';

/**
 * Layered file validation. The filename and the client's MIME type are claims only: the type that
 * counts is the one detected from the file's first bytes, and it must agree with both claims and
 * with what the class allows. Image decoding and malware scanning happen after upload (scanner).
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; code: 'invalid_type' | 'too_large' | 'too_small' | 'invalid_checksum' | 'type_mismatch'; message: string };

const fail = <T,>(code: Extract<ValidationResult<T>, { ok: false }>['code'], message: string): ValidationResult<T> => ({ ok: false, code, message });

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** File type from the magic number in the first bytes (pass at least 16). Null when unknown. */
export function detectMime(head: Uint8Array): MimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => head[i] === v)) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 5 && ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV'].includes(brand)) return 'video/mp4';
  }
  return null;
}

/** Equivalent claims (iPhones label HEIC files either way). */
const SAME: Partial<Record<MimeType, MimeType[]>> = { 'image/heic': ['image/heif'], 'image/heif': ['image/heic'] };
const compatible = (a: MimeType, b: MimeType) => a === b || (SAME[a] ?? []).includes(b);

export const isSha256Hex = (s: string) => /^[0-9a-f]{64}$/.test(s);

/** Checks at initialise time: the client's claims (name, type, size, checksum) against the class rules. */
export function validateClaims(fileClass: FileClass, claim: { filename: string; mime: string; size: number; sha256: string }): ValidationResult<{ mime: MimeType; ext: string }> {
  const rule = FILE_RULES[fileClass];
  const ext = (claim.filename.split('.').pop() ?? '').toLowerCase();
  if (!claim.filename.includes('.') || !rule.extensions.includes(ext)) return fail('invalid_type', `That file type isn’t accepted here. Use ${rule.extensions.join(', ').toUpperCase()}.`);
  const mime = claim.mime.toLowerCase() as MimeType;
  if (!rule.mimes.includes(mime)) return fail('invalid_type', 'That file type isn’t accepted here.');
  if (!Number.isInteger(claim.size) || claim.size < rule.minBytes) return fail('too_small', 'That file looks empty or damaged.');
  if (claim.size > rule.maxBytes) return fail('too_large', `Files must be ${Math.round(rule.maxBytes / (1024 * 1024))} MB or smaller.`);
  if (!isSha256Hex(claim.sha256.toLowerCase())) return fail('invalid_checksum', 'Missing or invalid file checksum.');
  return { ok: true, value: { mime, ext } };
}

/**
 * Checks on the stored object (server side, at completion): its real type from the first bytes must
 * be allowed for the class and agree with the claimed type.
 */
export function validateContent(fileClass: FileClass, claimedMime: MimeType, head: Uint8Array): ValidationResult<MimeType> {
  const detected = detectMime(head);
  if (!detected) return fail('invalid_type', 'The file content isn’t a supported type.');
  if (!FILE_RULES[fileClass].mimes.includes(detected)) return fail('invalid_type', 'The file content isn’t accepted here.');
  if (!compatible(claimedMime, detected)) return fail('type_mismatch', 'The file content doesn’t match its type.');
  return { ok: true, value: detected };
}
