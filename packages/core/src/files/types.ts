/**
 * File and media storage model (D-051, R2_STORAGE_ARCHITECTURE.md). Provider-neutral: the same records
 * work with Cloudflare R2 today and any S3-compatible store later. Status: implemented in code and
 * tested with a mock object store; real R2 pending credentials, metadata pending database selection.
 */

export type FileClass =
  | 'profile_photo'
  | 'driver_licence'
  | 'identity_document'
  | 'vehicle_document'
  | 'incident_photo'
  | 'incident_video'
  | 'public_media';

export type AccessClass = 'public' | 'private';

export type DeployEnvironment = 'development' | 'staging' | 'production';

export type FileStatus = 'pending_upload' | 'uploaded' | 'scanning' | 'quarantined' | 'approved' | 'rejected' | 'deleted' | 'expired';

export type ScanStatus = 'not_scanned' | 'pending' | 'clean' | 'infected' | 'error';

export type DeletionStatus = 'none' | 'requested' | 'deleted';

/** Metadata the backend database keeps for every object. R2 object names are never the database. */
export interface FileRecord {
  fileId: string;
  ownerId: string;
  fileClass: FileClass;
  accessClass: AccessClass;
  /** Bucket the object lives in now (quarantine bucket until approved, then the final bucket). */
  bucket: string;
  objectKey: string;
  status: FileStatus;
  claimedMime: string;
  /** From the file's first bytes (magic number), set at completion. */
  detectedMime: string | null;
  /** Declared by the client at initialise; verified against the stored object at completion. */
  declaredSize: number;
  verifiedSize: number | null;
  /** Lowercase hex SHA-256 declared by the client; verified against the stored object's checksum. */
  sha256: string;
  createdAt: number;
  updatedAt: number;
  /** When the upload authorisation stops working (pending uploads expire after this). */
  uploadExpiresAt: number;
  completedAt: number | null;
  scanStatus: ScanStatus;
  retentionPolicy: string;
  deletionStatus: DeletionStatus;
  related: { userId?: string; vehicleId?: string; tripId?: string };
}

/** Who is asking. Comes from the authenticated session (via the gateway), never from the request body. */
export interface FileCaller {
  userId: string;
  roles: ReadonlyArray<'rider' | 'driver' | 'staff_verification' | 'staff_safety' | 'staff_support' | 'admin'>;
}

export interface FileAuditEvent {
  at: number;
  actor: string;
  action: 'file.upload_initialised' | 'file.upload_completed' | 'file.quarantined' | 'file.rejected' | 'file.approved' | 'file.download_issued' | 'file.download_denied' | 'file.deleted';
  fileId: string;
  fileClass: FileClass;
  /** Required when staff open someone else's private file. */
  reason?: string;
}

export type FileErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_type'
  | 'too_large'
  | 'too_small'
  | 'quota_exceeded'
  | 'invalid_checksum'
  | 'expired'
  | 'not_uploaded'
  | 'verification_failed'
  | 'already_completed'
  | 'not_available'
  | 'reason_required'
  | 'invalid_state';

export class FileError extends Error {
  constructor(
    readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FileError';
  }
}
