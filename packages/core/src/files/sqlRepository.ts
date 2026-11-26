import type { FileMetadataRepository } from './service';
import type { FileRecord } from './types';

/** Anything that runs a parameterised SQL query (node-postgres Client or Pool, or a Hyperdrive-backed client). */
export interface SqlQuerier {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface Row {
  id: string;
  owner_id: string;
  file_class: FileRecord['fileClass'];
  access_class: FileRecord['accessClass'];
  bucket: string;
  object_key: string;
  status: FileRecord['status'];
  scan_status: FileRecord['scanStatus'];
  claimed_mime: string;
  detected_mime: string | null;
  declared_size: string | number;
  verified_size: string | number | null;
  sha256: string;
  retention_policy: string;
  deletion_status: FileRecord['deletionStatus'];
  related: FileRecord['related'] | null;
  upload_expires_at: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, owner_id, file_class, access_class, bucket, object_key, status, scan_status, claimed_mime, detected_mime,
  declared_size, verified_size, sha256, retention_policy, deletion_status, related, upload_expires_at, completed_at, created_at, updated_at`;

const ms = (v: Date | string | null): number | null => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

function toRecord(r: Row): FileRecord {
  return {
    fileId: r.id,
    ownerId: r.owner_id,
    fileClass: r.file_class,
    accessClass: r.access_class,
    bucket: r.bucket,
    objectKey: r.object_key,
    status: r.status,
    scanStatus: r.scan_status,
    claimedMime: r.claimed_mime,
    detectedMime: r.detected_mime,
    declaredSize: Number(r.declared_size),
    verifiedSize: r.verified_size === null ? null : Number(r.verified_size),
    sha256: r.sha256.trim(),
    retentionPolicy: r.retention_policy,
    deletionStatus: r.deletion_status,
    related: r.related ?? {},
    uploadExpiresAt: ms(r.upload_expires_at)!,
    completedAt: ms(r.completed_at),
    createdAt: ms(r.created_at)!,
    updatedAt: ms(r.updated_at)!,
  };
}

/**
 * File metadata in PostgreSQL (`ops.files`, migration 0005) for the upload signer (WP3b, D-082). Same
 * contract as the in-memory repository, so the tested file service runs unchanged on the database.
 * `put` inserts or replaces the whole record; ids are UUIDs.
 */
export function createSqlFileRepository(sql: SqlQuerier): FileMetadataRepository {
  const db = { query: async <R>(text: string, params?: unknown[]) => (await sql.query(text, params)) as { rows: R[] } };
  return {
    async get(fileId) {
      if (!/^[0-9a-f-]{32,36}$/i.test(fileId)) return null;
      const r = await db.query<Row>(`select ${COLUMNS} from ops.files where id = $1::uuid`, [fileId]);
      return r.rows[0] ? toRecord(r.rows[0]) : null;
    },
    async put(f) {
      await db.query(
        `insert into ops.files (id, owner_id, file_class, access_class, bucket, object_key, status, scan_status, claimed_mime, detected_mime,
           declared_size, verified_size, sha256, retention_policy, deletion_status, related, upload_expires_at, completed_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19)
         on conflict (id) do update set
           bucket = excluded.bucket, object_key = excluded.object_key, status = excluded.status, scan_status = excluded.scan_status,
           detected_mime = excluded.detected_mime, verified_size = excluded.verified_size, deletion_status = excluded.deletion_status,
           related = excluded.related, completed_at = excluded.completed_at
         where ops.files.owner_id = excluded.owner_id`,
        [
          f.fileId,
          f.ownerId,
          f.fileClass,
          f.accessClass,
          f.bucket,
          f.objectKey,
          f.status,
          f.scanStatus,
          f.claimedMime,
          f.detectedMime,
          f.declaredSize,
          f.verifiedSize,
          f.sha256,
          f.retentionPolicy,
          f.deletionStatus,
          JSON.stringify(f.related ?? {}),
          new Date(f.uploadExpiresAt),
          f.completedAt === null ? null : new Date(f.completedAt),
          new Date(f.createdAt),
        ],
      );
    },
    async listByOwner(ownerId) {
      const r = await db.query<Row>(`select ${COLUMNS} from ops.files where owner_id = $1::uuid order by created_at desc limit 500`, [ownerId]);
      return r.rows.map(toRecord);
    },
    async listByStatus(status) {
      const r = await db.query<Row>(`select ${COLUMNS} from ops.files where status = $1 order by created_at limit 500`, [status]);
      return r.rows.map(toRecord);
    },
  };
}
