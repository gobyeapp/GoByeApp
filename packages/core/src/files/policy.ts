import type { AccessClass, DeployEnvironment, FileClass } from './types';

/**
 * Per-class storage rules: what may be uploaded, how big, where it lives and how long it is kept.
 * Retention periods are PROPOSALS (OPEN_QUESTIONS / BACKUP_DISASTER_RECOVERY.md) until legal and
 * business sign-off; nothing deletes production data on these numbers yet.
 */

export type MimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'application/pdf' | 'video/mp4' | 'video/quicktime';

export type BucketRole = 'public-media' | 'private-documents' | 'private-evidence' | 'private-uploads';

export interface FileClassRule {
  accessClass: AccessClass;
  /** Final bucket once approved. Private uploads land in `private-uploads` (quarantine) first. */
  bucket: BucketRole;
  extensions: readonly string[];
  mimes: readonly MimeType[];
  maxBytes: number;
  minBytes: number;
  /** Must pass a malware scan before anyone but the scanner can read it. */
  requiresScan: boolean;
  /** Proposed retention label (see R2_STORAGE_ARCHITECTURE.md §Retention). */
  retention: string;
}

const MB = 1024 * 1024;
const IMAGES: MimeType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const DOCS: MimeType[] = [...IMAGES, 'application/pdf'];
const DOC_EXT = [...IMAGE_EXT, 'pdf'];

export const FILE_RULES: Record<FileClass, FileClassRule> = {
  profile_photo: { accessClass: 'private', bucket: 'private-documents', extensions: IMAGE_EXT, mimes: IMAGES, maxBytes: 5 * MB, minBytes: 1_000, requiresScan: true, retention: 'account-lifetime' },
  driver_licence: { accessClass: 'private', bucket: 'private-documents', extensions: DOC_EXT, mimes: DOCS, maxBytes: 10 * MB, minBytes: 10_000, requiresScan: true, retention: 'driver-account-plus-proposed-6y' },
  identity_document: { accessClass: 'private', bucket: 'private-documents', extensions: DOC_EXT, mimes: DOCS, maxBytes: 10 * MB, minBytes: 10_000, requiresScan: true, retention: 'driver-account-plus-proposed-6y' },
  vehicle_document: { accessClass: 'private', bucket: 'private-documents', extensions: DOC_EXT, mimes: DOCS, maxBytes: 10 * MB, minBytes: 10_000, requiresScan: true, retention: 'driver-account-plus-proposed-6y' },
  incident_photo: { accessClass: 'private', bucket: 'private-evidence', extensions: IMAGE_EXT, mimes: IMAGES, maxBytes: 15 * MB, minBytes: 1_000, requiresScan: true, retention: 'incident-proposed-7y-or-legal-hold' },
  incident_video: { accessClass: 'private', bucket: 'private-evidence', extensions: ['mp4', 'mov'], mimes: ['video/mp4', 'video/quicktime'], maxBytes: 200 * MB, minBytes: 10_000, requiresScan: true, retention: 'incident-proposed-7y-or-legal-hold' },
  public_media: { accessClass: 'public', bucket: 'public-media', extensions: [...IMAGE_EXT, 'mp4'], mimes: [...IMAGES, 'video/mp4'], maxBytes: 50 * MB, minBytes: 100, requiresScan: true, retention: 'until-unpublished' },
};

/** Who may upload each class (the gateway resolves roles from the session). Staff publish public media. */
export const UPLOADERS: Record<FileClass, readonly string[]> = {
  profile_photo: ['rider', 'driver'],
  driver_licence: ['driver'],
  identity_document: ['driver'],
  vehicle_document: ['driver'],
  incident_photo: ['rider', 'driver', 'staff_safety'],
  incident_video: ['rider', 'driver', 'staff_safety'],
  public_media: ['admin'],
};

/** Staff roles that may read another person's private file of this class (always with a reason, audited). */
export const STAFF_READERS: Record<FileClass, readonly string[]> = {
  profile_photo: ['staff_support', 'staff_safety', 'admin'],
  driver_licence: ['staff_verification', 'admin'],
  identity_document: ['staff_verification', 'admin'],
  vehicle_document: ['staff_verification', 'admin'],
  incident_photo: ['staff_safety', 'admin'],
  incident_video: ['staff_safety', 'admin'],
  public_media: ['admin'],
};

/** Stored bytes per owner across private classes (excluding deleted). Placeholder until product sets it. */
export const USER_QUOTA_BYTES = 300 * MB;
/** Uploads a person may have waiting at once (abandoned uploads expire and free the slot). */
export const MAX_PENDING_UPLOADS = 10;

/** Short-lived access (seconds). Presigned URLs are reusable until they expire, so keep these short. */
export const UPLOAD_URL_TTL = 300;
export const PRIVATE_DOWNLOAD_TTL = 60;

/** Environment-specific bucket names so staging can never touch production objects. */
export function bucketName(env: DeployEnvironment, role: BucketRole): string {
  const e = env === 'production' ? 'prod' : env === 'staging' ? 'staging' : 'dev';
  return `gobye-${e}-${role}`;
}

/** Non-cryptographic 64-bit FNV-1a, hex: keeps phone numbers / ids out of object keys. Not a secret. */
export function ownerSegment(ownerId: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < ownerId.length; i++) {
    const c = ownerId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function extensionFor(mime: MimeType): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }[mime];
}

/**
 * Server-generated object key: `{class}/{owner-hash}/{yyyy}/{mm}/{fileId}.{ext}`. No part of the
 * client's filename is used, so keys can't be guessed from names, traverse paths or collide.
 */
export function objectKeyFor(p: { fileClass: FileClass; ownerId: string; fileId: string; mime: MimeType; at: number }): string {
  if (!/^[a-z0-9-]{8,64}$/.test(p.fileId)) throw new Error('Invalid file id');
  const d = new Date(p.at);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${p.fileClass}/${ownerSegment(p.ownerId)}/${d.getUTCFullYear()}/${mm}/${p.fileId}.${extensionFor(p.mime)}`;
}

/** Display-only filename (shown in the admin, never used in storage paths). */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Keep letters (any script), digits, space, dot, dash, underscore; drop control chars and the rest.
  const cleaned = base.replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 80);
}
