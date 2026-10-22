import type { FileStatus, ScanStatus } from './types';

/**
 * Upload lifecycle:
 *   pending_upload ──complete (HEAD-verified)──▶ uploaded ──▶ scanning ──clean──▶ approved
 *                 └─expire─▶ expired                                  ├─infected─▶ quarantined ─▶ rejected
 *                                                                      └─error───▶ (stays scanning, retried; never approved)
 *   any non-deleted ──delete──▶ deleted
 * A private file is readable by people only when `approved` (scan clean). "Uploaded" on the client is
 * never authoritative: only a server-side completion that verified the stored object moves it on.
 */

export const FILE_TRANSITIONS: Record<FileStatus, readonly FileStatus[]> = {
  pending_upload: ['uploaded', 'expired', 'deleted'],
  uploaded: ['scanning', 'rejected', 'deleted'],
  scanning: ['approved', 'quarantined', 'scanning', 'deleted'],
  quarantined: ['rejected', 'deleted'],
  approved: ['deleted'],
  rejected: ['deleted'],
  expired: ['deleted'],
  deleted: [],
};

export function canMove(from: FileStatus, to: FileStatus): boolean {
  return FILE_TRANSITIONS[from].includes(to);
}

export interface ScanResult {
  status: Extract<ScanStatus, 'clean' | 'infected' | 'error' | 'pending'>;
  /** Engine and signature name for the audit log (never shown to the uploader). */
  detail?: string;
}

/** Where a scan result takes the file. Pending or error never approves. */
export function afterScan(result: ScanResult): FileStatus {
  if (result.status === 'clean') return 'approved';
  if (result.status === 'infected') return 'quarantined';
  return 'scanning';
}

/** Readable by people (owner, assigned staff) only once approved. */
export const isReadable = (status: FileStatus) => status === 'approved';
