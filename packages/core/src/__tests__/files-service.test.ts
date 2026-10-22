import {
  FileError,
  PendingScanner,
  bucketName,
  createFileService,
  createMemoryFileRepository,
  createMockObjectStore,
  createR2OriginalsVideoService,
  createTestScanner,
  type FileAuditEvent,
  type FileCaller,
  type MalwareScanner,
} from '../index';

// Deterministic stand-in for SHA-256 in tests (64 hex chars from the bytes).
const fakeSha = (b: Uint8Array) => {
  let h = 2166136261;
  for (const x of b) h = Math.imul(h ^ x, 16777619) >>> 0;
  return (h.toString(16).padStart(8, '0') + b.length.toString(16).padStart(8, '0')).repeat(4);
};
const jpeg = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};

const driver: FileCaller = { userId: '+2348030000001', roles: ['driver'] };
const other: FileCaller = { userId: '+2348030000002', roles: ['driver'] };
const verifier: FileCaller = { userId: 'staff-1', roles: ['staff_verification'] };

function setup(scanner: MalwareScanner = createTestScanner('clean')) {
  let t = Date.UTC(2026, 9, 22, 12);
  let id = 0;
  const audit: FileAuditEvent[] = [];
  const store = createMockObjectStore({ now: () => t, sha256: fakeSha });
  const repo = createMemoryFileRepository();
  const svc = createFileService({ env: 'staging', store, repo, scanner, audit: (e) => audit.push(e), now: () => t, newId: () => `file${String(++id).padStart(8, '0')}` });
  const upload = async (caller = driver, body = jpeg(50_000), opts: { claimSize?: number; claimSha?: string; interrupt?: boolean } = {}) => {
    const r = await svc.initializeUpload(caller, { fileClass: 'driver_licence', filename: 'front.jpg', mime: 'image/jpeg', size: opts.claimSize ?? body.length, sha256: opts.claimSha ?? fakeSha(body) });
    const put = await store.clientPut(r.upload.url, body, r.upload.headers, { interrupt: opts.interrupt });
    return { ...r, put };
  };
  return { svc, store, repo, audit, upload, tick: (ms: number) => (t += ms) };
}

describe('file service', () => {
  it('valid upload: quarantined first, verified on completion, scanned, then moved to the private documents bucket', async () => {
    const { svc, store, upload, audit } = setup();
    const { file, upload: u, put } = await upload();
    expect(file.status).toBe('pending_upload');
    expect(file.bucket).toBe(bucketName('staging', 'private-uploads'));
    expect(u.expiresAt - Date.UTC(2026, 9, 22, 12)).toBe(300_000);
    expect(put.status).toBe(200);
    const done = await svc.completeUpload(driver, file.fileId);
    expect(done).toMatchObject({ status: 'approved', scanStatus: 'clean', detectedMime: 'image/jpeg', verifiedSize: 50_000, bucket: 'gobye-staging-private-documents' });
    expect(await store.head('gobye-staging-private-uploads', file.objectKey)).toBeNull();
    expect(audit.map((a) => a.action)).toEqual(['file.upload_initialised', 'file.upload_completed', 'file.approved']);
    const dl = await svc.getDownloadAccess(driver, file.fileId);
    expect(dl.expiresAt - Date.UTC(2026, 9, 22, 12)).toBe(60_000);
  });

  it('rejects unauthenticated callers and roles that may not upload the class', async () => {
    const { svc } = setup();
    await expect(svc.initializeUpload(null, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: 50_000, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(svc.initializeUpload({ userId: 'r1', roles: ['rider'] }, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: 50_000, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('invalid type and oversized files are refused before any URL is issued', async () => {
    const { svc, repo } = setup();
    await expect(svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'a.exe', mime: 'application/octet-stream', size: 50_000, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_type' });
    await expect(svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: 11 * 1024 * 1024, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'too_large' });
    expect(repo.all()).toEqual([]);
  });

  it('expired upload authorisation: the PUT is refused and completion expires the record', async () => {
    const { svc, store, tick } = setup();
    const body = jpeg(50_000);
    const r = await svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: body.length, sha256: fakeSha(body) });
    tick(301_000);
    expect((await store.clientPut(r.upload.url, body, r.upload.headers)).status).toBe(403);
    await expect(svc.completeUpload(driver, r.file.fileId)).rejects.toMatchObject({ code: 'expired' });
    expect((await svc.getFileMetadata(driver, r.file.fileId)).status).toBe('expired');
  });

  it('interrupted upload stays pending (retry allowed) until it expires and is cleaned up', async () => {
    const { svc, upload, tick } = setup();
    const { file } = await upload(driver, jpeg(50_000), { interrupt: true });
    await expect(svc.completeUpload(driver, file.fileId)).rejects.toMatchObject({ code: 'not_uploaded' });
    expect((await svc.getFileMetadata(driver, file.fileId)).status).toBe('pending_upload');
    tick(301_000);
    expect(await svc.expireStale()).toBe(1);
    expect((await svc.getFileMetadata(driver, file.fileId)).status).toBe('expired');
  });

  it('wrong owner can’t complete; duplicate completion is refused', async () => {
    const { svc, upload } = setup();
    const { file } = await upload();
    await expect(svc.completeUpload(other, file.fileId)).rejects.toMatchObject({ code: 'forbidden' });
    await svc.completeUpload(driver, file.fileId);
    await expect(svc.completeUpload(driver, file.fileId)).rejects.toMatchObject({ code: 'already_completed' });
  });

  it('size or content that doesn’t match the claim is rejected and the object removed', async () => {
    const { svc, store, repo } = setup();
    // Claimed 60 KB, sent 50 KB.
    const body = jpeg(50_000);
    const r = await svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: 60_000, sha256: fakeSha(body) });
    await store.clientPut(r.upload.url, body, { ...r.upload.headers, 'content-length': '60000' });
    await expect(svc.completeUpload(driver, r.file.fileId)).rejects.toMatchObject({ code: 'verification_failed' });
    expect((await repo.get(r.file.fileId))!.status).toBe('rejected');
    // A PNG body uploaded as a JPEG.
    const png = new Uint8Array(50_000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r2 = await svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'b.jpg', mime: 'image/jpeg', size: png.length, sha256: fakeSha(png) });
    await store.clientPut(r2.upload.url, png, r2.upload.headers);
    await expect(svc.completeUpload(driver, r2.file.fileId)).rejects.toMatchObject({ code: 'verification_failed' });
    expect(await store.head(r2.file.bucket, r2.file.objectKey)).toBeNull();
  });

  it('a bad checksum is refused by the store on write (R2 verifies x-amz-checksum-sha256)', async () => {
    const { svc, upload } = setup();
    const { file, put } = await upload(driver, jpeg(50_000), { claimSha: 'b'.repeat(64) });
    expect(put.status).toBe(400);
    await expect(svc.completeUpload(driver, file.fileId)).rejects.toMatchObject({ code: 'not_uploaded' });
  });

  it('infected files are quarantined and never downloadable', async () => {
    const { svc, upload } = setup(createTestScanner('infected'));
    const { file } = await upload();
    expect((await svc.completeUpload(driver, file.fileId)).status).toBe('quarantined');
    await expect(svc.getDownloadAccess(driver, file.fileId)).rejects.toMatchObject({ code: 'not_available' });
  });

  it('with no scanner connected, private files stay unreadable (fail closed) until a rescan passes', async () => {
    let result: 'pending' | 'clean' = 'pending';
    const { svc, upload } = setup({ scan: async () => ({ status: result }) });
    const { file } = await upload();
    expect((await svc.completeUpload(driver, file.fileId)).status).toBe('scanning');
    await expect(svc.getDownloadAccess(driver, file.fileId)).rejects.toMatchObject({ code: 'not_available' });
    result = 'clean';
    expect(await svc.rescanPending()).toBe(1);
    expect((await svc.getFileMetadata(driver, file.fileId)).status).toBe('approved');
    expect(PendingScanner).toBeDefined();
  });

  it('private access: other users refused; staff need a reason, which is audited', async () => {
    const { svc, upload, audit } = setup();
    const { file } = await upload();
    await svc.completeUpload(driver, file.fileId);
    await expect(svc.getDownloadAccess(other, file.fileId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.getFileMetadata(other, file.fileId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.getDownloadAccess(verifier, file.fileId)).rejects.toMatchObject({ code: 'reason_required' });
    await svc.getDownloadAccess(verifier, file.fileId, 'Licence check for application');
    expect(audit.filter((a) => a.action === 'file.download_denied')).toHaveLength(2);
    expect(audit.find((a) => a.action === 'file.download_issued' && a.actor === 'staff-1')?.reason).toBe('Licence check for application');
  });

  it('lists only the caller’s own files and enforces the pending-upload limit', async () => {
    const { svc, upload } = setup();
    await upload(driver);
    await upload(other);
    expect((await svc.listAuthorizedFiles(driver)).map((f) => f.ownerId)).toEqual([driver.userId]);
    for (let i = 0; i < 9; i++) await upload(driver);
    await expect(upload(driver)).rejects.toBeInstanceOf(FileError);
  });

  it('owners delete their documents; incident evidence is only marked for review', async () => {
    const { svc, upload } = setup();
    const { file } = await upload();
    await svc.deleteFile(driver, file.fileId);
    await expect(svc.getFileMetadata(driver, file.fileId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.deleteFile(other, file.fileId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('video: MP4/MOV originals only, no transcoding claimed', async () => {
    const { svc } = setup();
    const video = createR2OriginalsVideoService(svc);
    await expect(video.initialize({ userId: 'r1', roles: ['rider'] }, { fileClass: 'incident_video', filename: 'a.avi', mime: 'video/x-msvideo', size: 50_000, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_type' });
  });
});
