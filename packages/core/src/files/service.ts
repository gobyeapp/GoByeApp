import { afterScan, canMove, isReadable, type ScanResult } from './lifecycle';
import {
  FILE_RULES,
  MAX_PENDING_UPLOADS,
  PRIVATE_DOWNLOAD_TTL,
  STAFF_READERS,
  UPLOADERS,
  UPLOAD_URL_TTL,
  USER_QUOTA_BYTES,
  bucketName,
  objectKeyFor,
  type MimeType,
} from './policy';
import { FileError, type FileAuditEvent, type FileCaller, type DeployEnvironment, type FileClass, type FileRecord, type FileStatus } from './types';
import { validateClaims, validateContent } from './validate';

/* ---------- Ports (implemented by R2 adapters, a database, a scanner) ---------- */

export interface PresignedRequest {
  url: string;
  method: 'PUT' | 'GET';
  /** Headers the client must send exactly (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: number;
}

export interface StoredObjectInfo {
  size: number;
  /** Lowercase hex SHA-256 the store verified on write (null when the store didn't record one). */
  sha256: string | null;
  contentType: string | null;
}

/** The object storage operations the service needs (Cloudflare R2 today; any S3-compatible store later). */
export interface ObjectStore {
  presignPut(p: { bucket: string; key: string; contentType: string; contentLength: number; sha256: string; expiresIn: number }): Promise<PresignedRequest>;
  head(bucket: string, key: string): Promise<StoredObjectInfo | null>;
  /** First bytes of the object, for content-type detection. */
  readHead(bucket: string, key: string, length: number): Promise<Uint8Array | null>;
  presignGet(p: { bucket: string; key: string; expiresIn: number }): Promise<PresignedRequest>;
  delete(bucket: string, key: string): Promise<void>;
  copy(from: { bucket: string; key: string }, to: { bucket: string; key: string }): Promise<void>;
}

/** Where file metadata lives. In-memory now; a database table once the backend is chosen (pending). */
export interface FileMetadataRepository {
  get(fileId: string): Promise<FileRecord | null>;
  put(record: FileRecord): Promise<void>;
  listByOwner(ownerId: string): Promise<FileRecord[]>;
  listByStatus(status: FileStatus): Promise<FileRecord[]>;
}

export interface MalwareScanner {
  scan(p: { bucket: string; key: string; mime: MimeType; size: number }): Promise<ScanResult>;
}

/** No scanner connected yet: every file stays "scanning" and is never approved (fail closed). */
export const PendingScanner: MalwareScanner = { scan: async () => ({ status: 'pending', detail: 'No malware scanner connected (pending provider).' }) };

/** Tests and demos only: scripted results. */
export function createTestScanner(result: ScanResult['status'] | ((key: string) => ScanResult['status'])): MalwareScanner {
  return { scan: async ({ key }) => ({ status: typeof result === 'function' ? result(key) : result, detail: 'test scanner' }) };
}

export function createMemoryFileRepository(): FileMetadataRepository & { all(): FileRecord[] } {
  const rows = new Map<string, FileRecord>();
  const copy = (r: FileRecord): FileRecord => ({ ...r, related: { ...r.related } });
  return {
    async get(id) {
      const r = rows.get(id);
      return r ? copy(r) : null;
    },
    async put(r) {
      rows.set(r.fileId, copy(r));
    },
    async listByOwner(owner) {
      return [...rows.values()].filter((r) => r.ownerId === owner).map(copy);
    },
    async listByStatus(s) {
      return [...rows.values()].filter((r) => r.status === s).map(copy);
    },
    all: () => [...rows.values()].map(copy),
  };
}

/* ---------- Service ---------- */

export interface InitializeUploadRequest {
  fileClass: FileClass;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  related?: FileRecord['related'];
}

export interface FileService {
  initializeUpload(caller: FileCaller | null, req: InitializeUploadRequest): Promise<{ file: FileRecord; upload: PresignedRequest }>;
  /** Server-side verification of the stored object; the client's "upload finished" is never trusted. */
  completeUpload(caller: FileCaller | null, fileId: string): Promise<FileRecord>;
  getFileMetadata(caller: FileCaller | null, fileId: string): Promise<FileRecord>;
  getDownloadAccess(caller: FileCaller | null, fileId: string, reason?: string): Promise<PresignedRequest>;
  deleteFile(caller: FileCaller | null, fileId: string, reason?: string): Promise<void>;
  /** The caller's own files only (no enumeration of anyone else's). */
  listAuthorizedFiles(caller: FileCaller | null, filter?: { fileClass?: FileClass }): Promise<FileRecord[]>;
  /** Re-run scans for files still waiting (scanner was down or pending). */
  rescanPending(): Promise<number>;
  /** Cleanup job: pending uploads past their authorisation become expired (objects removed). */
  expireStale(): Promise<number>;
}

export interface FileServiceDeps {
  env: DeployEnvironment;
  store: ObjectStore;
  repo: FileMetadataRepository;
  scanner: MalwareScanner;
  audit: (e: FileAuditEvent) => void;
  now?: () => number;
  newId?: () => string;
  /** Base URL of approved public media (e.g. https://media.gobye.app). */
  publicMediaBaseUrl?: string;
}

const defaultId = () => {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
};

const isStaffFor = (caller: FileCaller, fileClass: FileClass) => caller.roles.some((r) => STAFF_READERS[fileClass].includes(r));

export function createFileService(deps: FileServiceDeps): FileService {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? defaultId;
  const quarantine = bucketName(deps.env, 'private-uploads');

  const authed = (c: FileCaller | null): FileCaller => {
    if (!c || !c.userId) throw new FileError('unauthenticated', 'Sign in to continue.');
    return c;
  };
  const load = async (id: string): Promise<FileRecord> => {
    const r = await deps.repo.get(id);
    if (!r || r.status === 'deleted') throw new FileError('not_found', 'File not found.');
    return r;
  };
  const save = async (r: FileRecord, to: FileStatus, patch: Partial<FileRecord> = {}): Promise<FileRecord> => {
    if (to !== r.status && !canMove(r.status, to)) throw new FileError('invalid_state', `Can’t move a file from ${r.status} to ${to}.`);
    const next = { ...r, ...patch, status: to, updatedAt: now() };
    await deps.repo.put(next);
    return next;
  };
  /** Owner, or staff assigned to this class (staff must give a reason; recorded). */
  const mayRead = (c: FileCaller, r: FileRecord, reason?: string): 'owner' | 'staff' => {
    if (r.ownerId === c.userId) return 'owner';
    if (isStaffFor(c, r.fileClass)) {
      if (!reason?.trim()) throw new FileError('reason_required', 'Give a reason to open this file.');
      return 'staff';
    }
    throw new FileError('forbidden', 'You can’t open this file.');
  };

  async function runScan(r: FileRecord): Promise<FileRecord> {
    const rule = FILE_RULES[r.fileClass];
    const result: ScanResult = rule.requiresScan
      ? await deps.scanner.scan({ bucket: r.bucket, key: r.objectKey, mime: r.detectedMime as MimeType, size: r.verifiedSize ?? r.declaredSize }).catch(() => ({ status: 'error' as const }))
      : { status: 'clean' };
    const to = afterScan(result);
    if (to === 'approved') {
      // Move out of quarantine into the final bucket for its class.
      const finalBucket = bucketName(deps.env, rule.bucket);
      await deps.store.copy({ bucket: r.bucket, key: r.objectKey }, { bucket: finalBucket, key: r.objectKey });
      await deps.store.delete(r.bucket, r.objectKey);
      const done = await save(r, 'approved', { bucket: finalBucket, scanStatus: 'clean' });
      deps.audit({ at: now(), actor: 'system:scanner', action: 'file.approved', fileId: r.fileId, fileClass: r.fileClass });
      return done;
    }
    if (to === 'quarantined') {
      const q = await save(r, 'quarantined', { scanStatus: 'infected' });
      deps.audit({ at: now(), actor: 'system:scanner', action: 'file.quarantined', fileId: r.fileId, fileClass: r.fileClass });
      return q;
    }
    return save(r, 'scanning', { scanStatus: result.status === 'error' ? 'error' : 'pending' });
  }

  return {
    async initializeUpload(caller, req) {
      const c = authed(caller);
      if (!c.roles.some((role) => UPLOADERS[req.fileClass].includes(role))) throw new FileError('forbidden', 'You can’t upload this kind of file.');
      const v = validateClaims(req.fileClass, req);
      if (!v.ok) throw new FileError(v.code === 'type_mismatch' ? 'invalid_type' : v.code, v.message);
      const mine = await deps.repo.listByOwner(c.userId);
      const live = mine.filter((r) => !['deleted', 'expired', 'rejected'].includes(r.status));
      if (live.filter((r) => r.status === 'pending_upload').length >= MAX_PENDING_UPLOADS) throw new FileError('quota_exceeded', 'Too many uploads waiting. Finish or cancel one first.');
      const used = live.reduce((n, r) => n + (r.verifiedSize ?? r.declaredSize), 0);
      if (used + req.size > USER_QUOTA_BYTES) throw new FileError('quota_exceeded', 'You’ve reached your storage limit.');

      const t = now();
      const fileId = newId();
      const objectKey = objectKeyFor({ fileClass: req.fileClass, ownerId: c.userId, fileId, mime: v.value.mime, at: t });
      const rule = FILE_RULES[req.fileClass];
      const record: FileRecord = {
        fileId,
        ownerId: c.userId,
        fileClass: req.fileClass,
        accessClass: rule.accessClass,
        bucket: quarantine,
        objectKey,
        status: 'pending_upload',
        claimedMime: v.value.mime,
        detectedMime: null,
        declaredSize: req.size,
        verifiedSize: null,
        sha256: req.sha256.toLowerCase(),
        createdAt: t,
        updatedAt: t,
        uploadExpiresAt: t + UPLOAD_URL_TTL * 1000,
        completedAt: null,
        scanStatus: 'not_scanned',
        retentionPolicy: rule.retention,
        deletionStatus: 'none',
        related: { ...(req.related ?? {}) },
      };
      await deps.repo.put(record);
      const upload = await deps.store.presignPut({ bucket: quarantine, key: objectKey, contentType: v.value.mime, contentLength: req.size, sha256: record.sha256, expiresIn: UPLOAD_URL_TTL });
      deps.audit({ at: t, actor: c.userId, action: 'file.upload_initialised', fileId, fileClass: req.fileClass });
      return { file: record, upload };
    },

    async completeUpload(caller, fileId) {
      const c = authed(caller);
      const r = await load(fileId);
      if (r.ownerId !== c.userId) throw new FileError('forbidden', 'You can’t complete this upload.');
      // Single use: only a pending upload can be completed, once.
      if (r.status !== 'pending_upload') throw new FileError('already_completed', 'This upload was already completed.');
      if (now() > r.uploadExpiresAt) {
        await deps.store.delete(r.bucket, r.objectKey).catch(() => undefined);
        await save(r, 'expired');
        throw new FileError('expired', 'The upload took too long. Start it again.');
      }
      const info = await deps.store.head(r.bucket, r.objectKey);
      // Interrupted upload: nothing stored yet. It stays pending so the client can retry until expiry.
      if (!info) throw new FileError('not_uploaded', 'We haven’t received the file yet.');
      const head = await deps.store.readHead(r.bucket, r.objectKey, 32);
      const content = head ? validateContent(r.fileClass, r.claimedMime as MimeType, head) : null;
      const problem =
        info.size !== r.declaredSize ? 'size' : !info.sha256 || info.sha256.toLowerCase() !== r.sha256 ? 'checksum' : !content || !content.ok ? 'content' : null;
      if (problem) {
        await deps.store.delete(r.bucket, r.objectKey).catch(() => undefined);
        const up = await save(r, 'uploaded', { verifiedSize: info.size, completedAt: now() });
        await save(up, 'rejected');
        deps.audit({ at: now(), actor: c.userId, action: 'file.rejected', fileId, fileClass: r.fileClass });
        throw new FileError('verification_failed', problem === 'content' ? 'The file content isn’t accepted.' : 'The file didn’t arrive intact. Try again.');
      }
      const uploaded = await save(r, 'uploaded', { verifiedSize: info.size, detectedMime: content!.ok ? content!.value : null, completedAt: now() });
      deps.audit({ at: now(), actor: c.userId, action: 'file.upload_completed', fileId, fileClass: r.fileClass });
      const scanning = await save(uploaded, 'scanning', { scanStatus: 'pending' });
      return runScan(scanning);
    },

    async getFileMetadata(caller, fileId) {
      const c = authed(caller);
      const r = await load(fileId);
      if (r.ownerId !== c.userId && !isStaffFor(c, r.fileClass)) throw new FileError('forbidden', 'You can’t see this file.');
      return r;
    },

    async getDownloadAccess(caller, fileId, reason) {
      const c = authed(caller);
      const r = await load(fileId);
      let who: 'owner' | 'staff';
      try {
        who = mayRead(c, r, reason);
      } catch (e) {
        deps.audit({ at: now(), actor: c.userId, action: 'file.download_denied', fileId, fileClass: r.fileClass });
        throw e;
      }
      if (!isReadable(r.status)) throw new FileError('not_available', r.status === 'quarantined' || r.status === 'rejected' ? 'This file failed our checks.' : 'This file is still being checked.');
      if (r.accessClass === 'public' && deps.publicMediaBaseUrl) {
        return { url: `${deps.publicMediaBaseUrl.replace(/\/+$/, '')}/${r.objectKey}`, method: 'GET', headers: {}, expiresAt: Number.MAX_SAFE_INTEGER };
      }
      const access = await deps.store.presignGet({ bucket: r.bucket, key: r.objectKey, expiresIn: PRIVATE_DOWNLOAD_TTL });
      deps.audit({ at: now(), actor: c.userId, action: 'file.download_issued', fileId, fileClass: r.fileClass, reason: who === 'staff' ? reason!.trim() : undefined });
      return access;
    },

    async deleteFile(caller, fileId, reason) {
      const c = authed(caller);
      const r = await load(fileId);
      const isOwner = r.ownerId === c.userId;
      const isAdmin = c.roles.includes('admin');
      if (!isOwner && !isAdmin) throw new FileError('forbidden', 'You can’t delete this file.');
      if (!isOwner && !reason?.trim()) throw new FileError('reason_required', 'Give a reason to delete someone else’s file.');
      // Evidence under retention is not deleted by its owner; it is marked requested for review.
      if (isOwner && r.fileClass.startsWith('incident_')) {
        await deps.repo.put({ ...r, deletionStatus: 'requested', updatedAt: now() });
        return;
      }
      await deps.store.delete(r.bucket, r.objectKey).catch(() => undefined);
      await save(r, 'deleted', { deletionStatus: 'deleted' });
      deps.audit({ at: now(), actor: c.userId, action: 'file.deleted', fileId, fileClass: r.fileClass, reason: isOwner ? undefined : reason!.trim() });
    },

    async listAuthorizedFiles(caller, filter) {
      const c = authed(caller);
      const mine = await deps.repo.listByOwner(c.userId);
      return mine.filter((r) => r.status !== 'deleted' && (!filter?.fileClass || r.fileClass === filter.fileClass));
    },

    async rescanPending() {
      const waiting = await deps.repo.listByStatus('scanning');
      let changed = 0;
      for (const r of waiting) if ((await runScan(r)).status !== 'scanning') changed++;
      return changed;
    },

    async expireStale() {
      const pending = await deps.repo.listByStatus('pending_upload');
      let n = 0;
      for (const r of pending) {
        if (now() <= r.uploadExpiresAt) continue;
        await deps.store.delete(r.bucket, r.objectKey).catch(() => undefined);
        await save(r, 'expired');
        n++;
      }
      return n;
    },
  };
}

/* ---------- Mock object store (simulates R2 for tests and the preview) ---------- */

export interface MockObjectStore extends ObjectStore {
  /** Simulate the client PUT to a presigned URL (checks expiry and signed headers like R2 would). */
  clientPut(url: string, body: Uint8Array, headers: Record<string, string>, opts?: { interrupt?: boolean }): Promise<{ status: number }>;
  objects: Map<string, { body: Uint8Array; sha256: string | null; contentType: string }>;
}

export function createMockObjectStore(p: { now?: () => number; sha256: (b: Uint8Array) => string }): MockObjectStore {
  const now = p.now ?? (() => Date.now());
  const objects = new Map<string, { body: Uint8Array; sha256: string | null; contentType: string }>();
  const grants = new Map<string, { bucket: string; key: string; expiresAt: number; headers: Record<string, string>; method: 'PUT' | 'GET' }>();
  let n = 0;
  const k = (b: string, key: string) => `${b}/${key}`;
  return {
    objects,
    async presignPut(q) {
      const id = `put-${++n}`;
      const headers = { 'content-type': q.contentType, 'content-length': String(q.contentLength), 'x-amz-checksum-sha256': q.sha256 };
      const expiresAt = now() + q.expiresIn * 1000;
      grants.set(id, { bucket: q.bucket, key: q.key, expiresAt, headers, method: 'PUT' });
      return { url: `mock-r2://${q.bucket}/${q.key}?grant=${id}`, method: 'PUT', headers, expiresAt };
    },
    async presignGet(q) {
      const id = `get-${++n}`;
      const expiresAt = now() + q.expiresIn * 1000;
      grants.set(id, { bucket: q.bucket, key: q.key, expiresAt, headers: {}, method: 'GET' });
      return { url: `mock-r2://${q.bucket}/${q.key}?grant=${id}`, method: 'GET', headers: {}, expiresAt };
    },
    async clientPut(url, body, headers, opts) {
      const g = grants.get(url.split('grant=')[1] ?? '');
      if (!g || g.method !== 'PUT') return { status: 403 };
      if (now() > g.expiresAt) return { status: 403 };
      for (const [h, v] of Object.entries(g.headers)) if (h !== 'x-amz-checksum-sha256' && (headers[h] ?? '') !== v) return { status: 403 };
      if (opts?.interrupt) return { status: 0 };
      // R2 verifies the declared checksum on write; a mismatch is refused (400 BadDigest).
      const actual = p.sha256(body);
      if (g.headers['x-amz-checksum-sha256'] && g.headers['x-amz-checksum-sha256'] !== actual) return { status: 400 };
      objects.set(k(g.bucket, g.key), { body, sha256: actual, contentType: headers['content-type'] ?? 'application/octet-stream' });
      return { status: 200 };
    },
    async head(bucket, key) {
      const o = objects.get(k(bucket, key));
      return o ? { size: o.body.length, sha256: o.sha256, contentType: o.contentType } : null;
    },
    async readHead(bucket, key, length) {
      const o = objects.get(k(bucket, key));
      return o ? o.body.slice(0, length) : null;
    },
    async delete(bucket, key) {
      objects.delete(k(bucket, key));
    },
    async copy(from, to) {
      const o = objects.get(k(from.bucket, from.key));
      if (!o) throw new Error('Source object missing');
      objects.set(k(to.bucket, to.key), { ...o });
    },
  };
}
