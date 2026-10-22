import { describe, expect, it } from 'vitest';
import { createTestScanner, type FileAuditEvent, type MalwareScanner } from '@gobye/core';
import { ASSERTION_HEADER, signAssertion } from '../src/r2/assertion';
import { createUploadSigner, type UploadSignerEnv } from '../src/workers/upload-signer';
import { clientPut, fakeBucket, sha256Hex } from './r2-fake';

const SECRET = 'test-only-assertion-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 9, 22, 12);

function setup(scanner: MalwareScanner = createTestScanner('clean')) {
  let t = T0;
  let n = 0;
  const audit: FileAuditEvent[] = [];
  const env: UploadSignerEnv = {
    DEPLOY_ENV: 'staging',
    R2_ACCOUNT_ID: 'f'.repeat(32),
    R2_ACCESS_KEY_ID: 'TESTKEY',
    R2_SECRET_ACCESS_KEY: 'TESTSECRET',
    GATEWAY_ASSERTION_SECRET: SECRET,
    UPLOADS: fakeBucket(),
    DOCUMENTS: fakeBucket(),
    EVIDENCE: fakeBucket(),
    PUBLIC_MEDIA: fakeBucket(),
  };
  const byName = { 'gobye-staging-private-uploads': env.UPLOADS, 'gobye-staging-private-documents': env.DOCUMENTS, 'gobye-staging-private-evidence': env.EVIDENCE, 'gobye-staging-public-media': env.PUBLIC_MEDIA };
  const worker = createUploadSigner({ scanner, audit: (e) => audit.push(e), now: () => t, newId: () => `file${String(++n).padStart(8, '0')}` });
  const call = async (method: string, path: string, who: { sub: string; roles: string[] } | null, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (who) headers[ASSERTION_HEADER] = await signAssertion({ sub: who.sub, roles: who.roles as never, iat: t }, SECRET);
    const res = await worker.fetch(new Request(`https://api.gobye.app${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, body: (await res.json()) as any, headers: res.headers };
  };
  return { env, byName, call, audit, tick: (ms: number) => (t += ms), now: () => t };
}

const driver = { sub: '+2348030000001', roles: ['driver'] };
const other = { sub: '+2348030000002', roles: ['driver'] };
const jpeg = (size = 40_000) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = (i * 7) % 253;
  return b;
};

async function startUpload(s: ReturnType<typeof setup>, who = driver, body = jpeg(), claim: Partial<{ size: number; sha256: string; mime: string; filename: string; fileClass: string }> = {}) {
  return s.call('POST', '/v1/files/uploads', who, { fileClass: 'driver_licence', filename: 'front.jpg', mime: 'image/jpeg', size: body.length, sha256: await sha256Hex(body), ...claim });
}

describe('upload signer worker', () => {
  it('valid upload: presigned PUT to R2, server-side completion, scan, then a 60 s private download', async () => {
    const s = setup();
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    expect(init.status).toBe(201);
    expect(init.body.file).not.toHaveProperty('objectKey');
    expect(init.body.file).not.toHaveProperty('bucket');
    expect(init.body.upload.url).toMatch(/^https:\/\/f{32}\.r2\.cloudflarestorage\.com\/gobye-staging-private-uploads\/driver_licence\//);
    expect(new URL(init.body.upload.url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(init.headers.get('cache-control')).toBe('private, no-store');
    expect(await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now())).toBe(200);
    const done = await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver);
    expect(done.status).toBe(200);
    expect(done.body.file.status).toBe('approved');
    expect((s.env.DOCUMENTS as any).data.size).toBe(1);
    expect((s.env.UPLOADS as any).data.size).toBe(0);
    const dl = await s.call('GET', `/v1/files/${init.body.file.fileId}/download`, driver);
    expect(dl.status).toBe(200);
    expect(new URL(dl.body.url).searchParams.get('X-Amz-Expires')).toBe('60');
    expect(dl.body.url).toContain('/gobye-staging-private-documents/');
  });

  it('unauthorised: no assertion, a forged one, or a stale one is refused', async () => {
    const s = setup();
    expect((await s.call('POST', '/v1/files/uploads', null, {})).status).toBe(401);
    const forged = await signAssertion({ sub: driver.sub, roles: ['driver'], iat: s.now() }, 'not-the-gateway-secret-but-long-enough-xx');
    expect((await s.call('POST', '/v1/files/uploads', null, {}, { [ASSERTION_HEADER]: forged })).status).toBe(401);
    const stale = await signAssertion({ sub: driver.sub, roles: ['driver'], iat: s.now() - 120_000 }, SECRET);
    expect((await s.call('POST', '/v1/files/uploads', null, {}, { [ASSERTION_HEADER]: stale })).status).toBe(401);
  });

  it('invalid type and oversized uploads are refused before signing', async () => {
    const s = setup();
    expect((await startUpload(s, driver, jpeg(), { filename: 'run.exe', mime: 'application/octet-stream' })).body.error.code).toBe('invalid_type');
    const big = await startUpload(s, driver, jpeg(), { size: 11 * 1024 * 1024 });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('too_large');
  });

  it('expired authorisation: R2 refuses the PUT and completion reports it expired', async () => {
    const s = setup();
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    s.tick(301_000);
    expect(await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now())).toBe(403);
    expect((await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver)).status).toBe(410);
  });

  it('missing / interrupted upload: completion says not received and the file stays pending', async () => {
    const s = setup();
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    expect(await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now(), { interrupt: true })).toBe(0);
    const c = await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver);
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('not_uploaded');
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}`, driver)).body.file.status).toBe('pending_upload');
  });

  it('wrong owner can’t complete; duplicate completion is refused', async () => {
    const s = setup();
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now());
    expect((await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, other)).status).toBe(403);
    expect((await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver)).status).toBe(200);
    const again = await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_completed');
  });

  it('failed completion: a checksum R2 rejects, or content that isn’t what was claimed', async () => {
    const s = setup();
    const body = jpeg();
    const bad = await startUpload(s, driver, body, { sha256: 'c'.repeat(64) });
    expect(await clientPut(s.byName, bad.body.upload.url, bad.body.upload.headers, body, s.now())).toBe(400);
    expect((await s.call('POST', `/v1/files/uploads/${bad.body.file.fileId}/complete`, driver)).body.error.code).toBe('not_uploaded');
    // A PNG sent as a JPEG: R2 accepts the bytes, the server-side content check rejects it.
    const png = new Uint8Array(40_000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mis = await startUpload(s, driver, png);
    expect(await clientPut(s.byName, mis.body.upload.url, mis.body.upload.headers, png, s.now())).toBe(200);
    const c = await s.call('POST', `/v1/files/uploads/${mis.body.file.fileId}/complete`, driver);
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe('verification_failed');
    expect((s.env.UPLOADS as any).data.size).toBe(0);
  });

  it('infected file: quarantined, never downloadable, owner told it failed checks', async () => {
    const s = setup(createTestScanner('infected'));
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now());
    expect((await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver)).body.file.status).toBe('quarantined');
    const dl = await s.call('GET', `/v1/files/${init.body.file.fileId}/download`, driver);
    expect(dl.status).toBe(409);
    expect(dl.body.error.code).toBe('not_available');
    expect(s.audit.map((a) => a.action)).toContain('file.quarantined');
  });

  it('with no scanner connected (the default) files are never served', async () => {
    const s = setup({ scan: async () => ({ status: 'pending' }) });
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now());
    expect((await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver)).body.file.status).toBe('scanning');
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}/download`, driver)).status).toBe(409);
  });

  it('private access: another driver is refused, verification staff need a reason (audited)', async () => {
    const s = setup();
    const body = jpeg();
    const init = await startUpload(s, driver, body);
    await clientPut(s.byName, init.body.upload.url, init.body.upload.headers, body, s.now());
    await s.call('POST', `/v1/files/uploads/${init.body.file.fileId}/complete`, driver);
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}/download`, other)).status).toBe(403);
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}`, other)).status).toBe(403);
    const staff = { sub: 'staff-7', roles: ['staff_verification'] };
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}/download`, staff)).status).toBe(400);
    expect((await s.call('GET', `/v1/files/${init.body.file.fileId}/download?reason=Licence%20review`, staff)).status).toBe(200);
    expect(s.audit.find((a) => a.action === 'file.download_issued' && a.actor === 'staff-7')?.reason).toBe('Licence review');
    // Listing only ever shows the caller's own files.
    expect((await s.call('GET', '/v1/files', other)).body.files).toEqual([]);
  });

  it('errors never leak internals; unknown routes are 404; big bodies refused', async () => {
    const s = setup();
    expect((await s.call('GET', '/v1/files/../../etc/passwd', driver)).status).toBe(404);
    const huge = await s.call('POST', '/v1/files/uploads', driver, { filename: 'x'.repeat(5000) });
    expect(huge.status).toBe(400);
    expect(JSON.stringify(huge.body)).not.toMatch(/gobye-staging|TESTSECRET|stack/);
  });
});
