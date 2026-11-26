import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createFileService, createMockObjectStore, createSqlFileRepository, createTestScanner, PendingScanner, type FileCaller, type MalwareScanner } from '@gobye/core';
import { createTestDb, NO_DB_REASON, postgresAvailable, type TestDb } from './helpers';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const jpeg = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};

/** WP3b (D-082): the file service on ops.files, as the upload signer runs it through Hyperdrive. */
describe('file metadata in PostgreSQL', async () => {
  const skip = !(await postgresAvailable()) && NO_DB_REASON;
  let tdb: TestDb;
  before(async () => {
    if (!skip) tdb = await createTestDb();
  });
  after(async () => {
    if (!skip) await tdb.drop();
  });

  const setup = (scanner: MalwareScanner) => {
    let t = Date.now();
    const store = createMockObjectStore({ now: () => t, sha256: sha });
    const repo = createSqlFileRepository(tdb.db);
    const svc = createFileService({ env: 'staging', store, repo, scanner, audit: () => undefined, now: () => t });
    return { svc, store, repo, tick: (ms: number) => (t += ms) };
  };

  test('upload, verify, scan and approve: the record round-trips through ops.files', { skip }, async () => {
    const { svc, store, repo } = setup(createTestScanner('clean'));
    const driver: FileCaller = { userId: randomUUID(), roles: ['driver'] };
    const body = jpeg(40_000);
    const r = await svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'front.jpg', mime: 'image/jpeg', size: body.length, sha256: sha(body) });
    assert.match(r.file.fileId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const row = (await tdb.db.query(`select status, owner_id from ops.files where id = $1`, [r.file.fileId])).rows[0];
    assert.equal(row.status, 'pending_upload');
    assert.equal(row.owner_id, driver.userId);

    assert.equal((await store.clientPut(r.upload.url, body, r.upload.headers)).status, 200);
    const done = await svc.completeUpload(driver, r.file.fileId);
    assert.equal(done.status, 'approved');
    const back = await repo.get(r.file.fileId);
    assert.deepEqual({ ...back, updatedAt: 0 }, { ...done, updatedAt: 0 });
    assert.equal((await repo.listByOwner(driver.userId)).length, 1);
    assert.equal(await repo.get('not-a-uuid'), null);
    await assert.rejects(svc.completeUpload({ userId: randomUUID(), roles: ['driver'] }, r.file.fileId), (e: { code?: string }) => e.code === 'forbidden');
  });

  test('with no scanner connected, a file stays unreadable (fail closed)', { skip }, async () => {
    const { svc, store } = setup(PendingScanner);
    const driver: FileCaller = { userId: randomUUID(), roles: ['driver'] };
    const body = jpeg(30_000);
    const r = await svc.initializeUpload(driver, { fileClass: 'vehicle_document', filename: 'ins.jpg', mime: 'image/jpeg', size: body.length, sha256: sha(body) });
    await store.clientPut(r.upload.url, body, r.upload.headers);
    const done = await svc.completeUpload(driver, r.file.fileId);
    assert.equal(done.status, 'scanning');
    await assert.rejects(svc.getDownloadAccess(driver, r.file.fileId));
    const pending = (await tdb.db.query(`select scan_status from ops.files where id = $1`, [r.file.fileId])).rows[0];
    assert.equal(pending.scan_status, 'pending');
  });

  test('stale pending uploads expire', { skip }, async () => {
    const { svc, tick } = setup(createTestScanner('clean'));
    const driver: FileCaller = { userId: randomUUID(), roles: ['driver'] };
    const r = await svc.initializeUpload(driver, { fileClass: 'driver_licence', filename: 'a.jpg', mime: 'image/jpeg', size: 20_000, sha256: 'b'.repeat(64) });
    tick(2 * 3600_000);
    assert.ok((await svc.expireStale()) >= 1);
    assert.equal((await tdb.db.query(`select status from ops.files where id = $1`, [r.file.fileId])).rows[0].status, 'expired');
  });
});
