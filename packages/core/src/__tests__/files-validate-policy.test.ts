import { FILE_RULES, bucketName, detectMime, objectKeyFor, ownerSegment, safeDisplayName, validateClaims, validateContent, canMove, afterScan } from '../index';

const bytes = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF', 0, 1, 1, 0);
const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 'IHDR');
const PDF = bytes('%PDF-1.7', 0x0a, '%');
const HEIC = bytes(0, 0, 0, 0x18, 'ftyp', 'heic', 0, 0, 0, 0);
const MP4 = bytes(0, 0, 0, 0x20, 'ftyp', 'isom', 0, 0, 2, 0);
const MOV = bytes(0, 0, 0, 0x14, 'ftyp', 'qt  ', 0, 0, 2, 0);
const WEBP = bytes('RIFF', 0, 0, 0, 0, 'WEBP', 'VP8 ');
const EXE = bytes('MZ', 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff);
const SHA = 'a'.repeat(64);

describe('file validation', () => {
  it('detects types from the first bytes, not the name', () => {
    expect([JPEG, PNG, PDF, HEIC, MP4, MOV, WEBP].map(detectMime)).toEqual(['image/jpeg', 'image/png', 'application/pdf', 'image/heic', 'video/mp4', 'video/quicktime', 'image/webp']);
    expect(detectMime(EXE)).toBeNull();
    expect(detectMime(new Uint8Array())).toBeNull();
  });

  it('checks the claims: extension, MIME, size and checksum', () => {
    expect(validateClaims('driver_licence', { filename: 'licence.jpg', mime: 'image/jpeg', size: 200_000, sha256: SHA })).toEqual({ ok: true, value: { mime: 'image/jpeg', ext: 'jpg' } });
    expect(validateClaims('driver_licence', { filename: 'licence.exe', mime: 'image/jpeg', size: 200_000, sha256: SHA }).ok).toBe(false);
    expect(validateClaims('driver_licence', { filename: 'licence', mime: 'image/jpeg', size: 200_000, sha256: SHA }).ok).toBe(false);
    expect(validateClaims('driver_licence', { filename: 'a.jpg', mime: 'application/x-msdownload', size: 200_000, sha256: SHA }).ok).toBe(false);
    expect(validateClaims('driver_licence', { filename: 'a.jpg', mime: 'image/jpeg', size: 50 * 1024 * 1024, sha256: SHA })).toMatchObject({ ok: false, code: 'too_large' });
    expect(validateClaims('driver_licence', { filename: 'a.jpg', mime: 'image/jpeg', size: 10, sha256: SHA })).toMatchObject({ ok: false, code: 'too_small' });
    expect(validateClaims('driver_licence', { filename: 'a.jpg', mime: 'image/jpeg', size: 200_000, sha256: 'nope' })).toMatchObject({ ok: false, code: 'invalid_checksum' });
    expect(validateClaims('profile_photo', { filename: 'a.pdf', mime: 'application/pdf', size: 200_000, sha256: SHA }).ok).toBe(false);
    expect(validateClaims('incident_video', { filename: 'clip.mov', mime: 'video/quicktime', size: 5_000_000, sha256: SHA }).ok).toBe(true);
  });

  it('checks the stored content against the claim and the class', () => {
    expect(validateContent('driver_licence', 'image/jpeg', JPEG)).toEqual({ ok: true, value: 'image/jpeg' });
    expect(validateContent('driver_licence', 'image/jpeg', PNG)).toMatchObject({ ok: false, code: 'type_mismatch' });
    expect(validateContent('driver_licence', 'image/jpeg', EXE)).toMatchObject({ ok: false, code: 'invalid_type' });
    expect(validateContent('profile_photo', 'application/pdf' as never, PDF)).toMatchObject({ ok: false, code: 'invalid_type' });
    expect(validateContent('identity_document', 'image/heif', HEIC).ok).toBe(true);
  });
});

describe('storage policy', () => {
  it('keeps every class but approved public media private, in environment-specific buckets', () => {
    expect(Object.entries(FILE_RULES).filter(([, r]) => r.accessClass === 'public').map(([k]) => k)).toEqual(['public_media']);
    expect(Object.values(FILE_RULES).every((r) => r.requiresScan)).toBe(true);
    expect(bucketName('production', 'private-documents')).toBe('gobye-prod-private-documents');
    expect(bucketName('staging', 'private-documents')).not.toBe(bucketName('production', 'private-documents'));
  });

  it('builds object keys on the server with no part of the user’s filename or id', () => {
    const key = objectKeyFor({ fileClass: 'driver_licence', ownerId: '+2348030000001', fileId: '0123456789abcdef', mime: 'image/jpeg', at: Date.UTC(2026, 9, 22) });
    expect(key).toBe(`driver_licence/${ownerSegment('+2348030000001')}/2026/10/0123456789abcdef.jpg`);
    expect(key).not.toContain('2348030000001');
    expect(() => objectKeyFor({ fileClass: 'driver_licence', ownerId: 'x', fileId: '../../etc', mime: 'image/jpeg', at: 0 })).toThrow();
  });

  it('cleans display names (never used in storage paths)', () => {
    expect(safeDisplayName('../../My Licence (front)?.jpg')).toBe('My Licence front.jpg');
    expect(safeDisplayName('...')).toBe('file');
  });

  it('only moves files along allowed paths; only a clean scan approves', () => {
    expect(canMove('pending_upload', 'approved')).toBe(false);
    expect(canMove('scanning', 'approved')).toBe(true);
    expect(canMove('deleted', 'approved')).toBe(false);
    expect(afterScan({ status: 'clean' })).toBe('approved');
    expect(afterScan({ status: 'infected' })).toBe('quarantined');
    expect(afterScan({ status: 'pending' })).toBe('scanning');
    expect(afterScan({ status: 'error' })).toBe('scanning');
  });
});
