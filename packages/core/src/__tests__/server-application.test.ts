import {
  createApplicationSync,
  createDriverApplicationApi,
  createFileUploader,
  mergeServerReview,
  sha256Hex,
  stepBody,
  type ApiClient,
  type ApiResult,
  type DriverApplication,
  type ServerApplicationView,
} from '../index';

const app: DriverApplication = {
  personal: { firstName: 'Tunde', lastName: 'Bakare', city: 'Lagos', photoUri: 'file:///face.jpg' },
  licence: { number: 'ABC123456789', expiry: '2031-01-01', photoUri: 'file:///lic.jpg' },
  identity: { type: 'nin', number: '12345678901', selfieUri: 'file:///me.jpg' },
  vehicle: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2016, colour: 'Silver', plate: 'KJA 123 AB' },
  documents: { registration: 'file:///r.jpg', insurance: 'file:///i.jpg' },
  status: 'in_progress',
};

const view = (version: number, o: Partial<ServerApplicationView['application']> = {}, status: ServerApplicationView['status'] = 'in_progress'): ServerApplicationView => ({
  driverId: 'd1',
  status,
  version,
  application: { documents: {}, status, city: 'lagos', ...o },
  files: [],
});
const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
const err = (code: string, message = 'x'): ApiResult<never> => ({ ok: false, error: { kind: 'conflict', code, message } });

describe('SHA-256 (plain TypeScript)', () => {
  const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex(text(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(text('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('driver application client (WP4)', () => {
  it('sends steps with If-Match and the step path', async () => {
    const calls: unknown[][] = [];
    const api = { request: async (...a: unknown[]) => (calls.push(a), ok(view(2))), get: async (p: string) => (calls.push(['GET', p]), ok(view(1))), post: async (...a: unknown[]) => (calls.push(['POST', ...a]), ok(view(3))) } as unknown as ApiClient;
    const c = createDriverApplicationApi(api);
    await c.get();
    await c.saveStep('vehicle', { a: 1 }, 1, 'key-1');
    await c.submit(2, 'key-2');
    expect(calls[1]).toEqual(['PUT', '/drivers/me/application/steps/vehicle', { body: { a: 1 }, idempotencyKey: 'key-1', headers: { 'If-Match': '"1"' } }]);
    expect(calls[2]).toEqual(['POST', '/drivers/me/application/submit', {}, { idempotencyKey: 'key-2', headers: { 'If-Match': '"2"' } }]);
  });

  it('builds step bodies with file ids, and nothing until the photo is uploaded', () => {
    const ids: Record<string, string> = { 'file:///lic.jpg': 'f-lic', 'file:///r.jpg': 'f-r', 'file:///face.jpg': 'f-face' };
    const id = (u: string) => ids[u];
    expect(stepBody(app, 'licence', id)).toEqual({ number: 'ABC123456789', expiry: '2031-01-01', photoFileId: 'f-lic' });
    expect(stepBody(app, 'identity', id)).toBeNull();
    expect(stepBody(app, 'documents', id)).toEqual({ registration: 'f-r' });
    expect(stepBody(app, 'personal', id)).toEqual({ firstName: 'Tunde', lastName: 'Bakare', photoFileId: 'f-face' });
    expect(stepBody(app, 'personal', () => undefined)).toBeNull();
  });

  it('uploads each photo once, then saves; retries once on a version conflict with a new key', async () => {
    const uploads: string[] = [];
    const saves: [number, string][] = [];
    let serverVersion = 4;
    const known = new Map<string, string>();
    let n = 0;
    const sync = createApplicationSync({
      api: {
        get: async () => ok(view(serverVersion)),
        saveStep: async (_s, _b, v, key) => {
          saves.push([v, key]);
          if (v !== serverVersion) return err('VERSION_CONFLICT');
          serverVersion += 1;
          return ok(view(serverVersion));
        },
        submit: async () => ok(view(serverVersion, {}, 'pending_review')),
      },
      upload: async (uri) => (uploads.push(uri), { ok: true, value: `id-${uri}` }),
      files: { get: (u) => known.get(u), set: (u, id) => void known.set(u, id) },
      newKey: () => `k-${++n}`,
    });
    const first = await sync.pushStep(app, 'licence');
    expect(first.ok && first.value?.version).toBe(5);
    await sync.pushStep(app, 'licence');
    expect(uploads).toEqual(['file:///lic.jpg']);

    serverVersion = 9; // another device saved meanwhile
    const r = await sync.pushStep(app, 'vehicle');
    expect(r.ok && r.value?.version).toBe(10);
    expect(saves.slice(-2).map((s) => s[0])).toEqual([6, 9]);
    expect(new Set(saves.map((s) => s[1])).size).toBe(saves.length);
  });

  it('stops at a failed upload or a refused step', async () => {
    const sync = createApplicationSync({
      api: { get: async () => ok(view(1)), saveStep: async () => ({ ok: false, error: { kind: 'validation', message: 'Check the plate.' } }), submit: async () => err('DOCUMENTS_NOT_READY', 'Some documents are still being checked.') },
      upload: async () => ({ ok: false, error: 'The upload didn’t finish.' }),
      files: { get: () => undefined, set: () => undefined },
      newKey: () => 'k-1-abcdef',
    });
    expect(await sync.pushStep(app, 'licence')).toEqual({ ok: false, error: 'The upload didn’t finish.' });
    expect(await sync.pushStep(app, 'vehicle')).toEqual({ ok: false, error: 'Check the plate.' });
    expect(await sync.submit()).toEqual({ ok: false, error: 'Some documents are still being checked.' });
  });

  it('uploads by presign, put and completion with the checksum', async () => {
    const posts: [string, unknown][] = [];
    const api = {
      post: async (path: string, body: unknown) => {
        posts.push([path, body]);
        return path === '/files/uploads' ? ok({ file: { fileId: 'f-1' }, upload: { url: 'https://r2/x', headers: { 'content-type': 'image/jpeg' } } }) : ok({ file: { fileId: 'f-1' } });
      },
    } as unknown as ApiClient;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    let put: [string, Record<string, string>] | null = null;
    const upload = createFileUploader({ api, read: async () => ({ bytes, mime: 'image/jpeg', filename: 'lic.jpg' }), put: async (url, headers) => ((put = [url, headers]), true), newKey: () => 'k-12345678' });
    expect(await upload('file:///lic.jpg', 'driver_licence')).toEqual({ ok: true, value: 'f-1' });
    expect(posts[0]).toEqual(['/files/uploads', { fileClass: 'driver_licence', filename: 'lic.jpg', mime: 'image/jpeg', size: 6, sha256: sha256Hex(bytes) }]);
    expect(posts[1]![0]).toBe('/files/uploads/f-1/complete');
    expect(put).toEqual(['https://r2/x', { 'content-type': 'image/jpeg' }]);
    const failed = createFileUploader({ api, read: async () => ({ bytes, mime: 'image/jpeg', filename: 'a.jpg' }), put: async () => false, newKey: () => 'k-12345678' });
    expect((await failed('u', 'driver_licence')).ok).toBe(false);
  });

  it('takes staff review from the server and keeps the device’s photos', () => {
    const v = view(7, { status: 'changes_requested', reviewNote: 'Retake one photo', issues: [{ id: 'i1', code: 'licence_unreadable', raisedAt: 1 }], licence: { number: 'ABC123456789', expiry: '2031-01-01', photoUri: 'f-lic' } }, 'changes_requested');
    const m = mergeServerReview(app, v);
    expect(m.status).toBe('changes_requested');
    expect(m.reviewNote).toBe('Retake one photo');
    expect(m.issues).toHaveLength(1);
    expect(m.licence?.photoUri).toBe('file:///lic.jpg');
  });
});
