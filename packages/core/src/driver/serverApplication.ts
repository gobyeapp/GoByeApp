import type { ApiClient } from '../infra/http';
import type { ApiResult } from '../infra/errors';
import type { FileClass } from '../files/types';
import { sha256Hex } from '../files/sha256';
import type { Result } from '../types';
import { VEHICLE_DOCUMENTS, type DriverApplication, type OnboardingStepId } from './onboarding';

/**
 * The Driver App's side of the driver application API (Backend Phase 2, WP4, D-080). The app keeps its
 * application on the device (photos as local files) and mirrors it to the API: each saved step is uploaded
 * (files first), and staff review (status, checks, flagged items) comes back from the server.
 */

export type ServerFileState = 'checking' | 'ready' | 'problem' | 'missing';

/** `GET /v1/drivers/me/application` and the body of every write (API_CONTRACTS.md §10). */
export interface ServerApplicationView {
  driverId: string;
  status: DriverApplication['status'];
  version: number;
  application: DriverApplication & { city: 'lagos' | 'abuja' };
  files: { slot: string; fileId: string; state: ServerFileState }[];
}

export interface DriverApplicationApi {
  get(): Promise<ApiResult<ServerApplicationView>>;
  saveStep(step: OnboardingStepId, body: object, version: number, idempotencyKey: string): Promise<ApiResult<ServerApplicationView>>;
  submit(version: number, idempotencyKey: string): Promise<ApiResult<ServerApplicationView>>;
}

export function createDriverApplicationApi(api: ApiClient): DriverApplicationApi {
  const ifMatch = (v: number) => ({ 'If-Match': `"${v}"` });
  return {
    get: () => api.get<ServerApplicationView>('/drivers/me/application'),
    saveStep: (step, body, version, idempotencyKey) =>
      api.request<ServerApplicationView>('PUT', `/drivers/me/application/steps/${step}`, { body, idempotencyKey, headers: ifMatch(version) }),
    submit: (version, idempotencyKey) => api.post<ServerApplicationView>('/drivers/me/application/submit', {}, { idempotencyKey, headers: ifMatch(version) }),
  };
}

/* ---------- Uploads ---------- */

export interface LocalFile {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  /** What the platform uploads best (React Native: the picked file as a Blob). Defaults to `bytes`. */
  body?: unknown;
}

export interface FileUploaderDeps {
  api: ApiClient;
  /** Read a picked photo (a local URI) into bytes. */
  read(uri: string): Promise<LocalFile>;
  /** Send the file to the presigned URL with exactly the signed headers. True when stored. */
  put(url: string, headers: Record<string, string>, file: LocalFile): Promise<boolean>;
  newKey(): string;
}

/** Presign → upload → server-side completion (R2_STORAGE_ARCHITECTURE.md). Returns the file id. */
export function createFileUploader(d: FileUploaderDeps) {
  return async function upload(uri: string, fileClass: FileClass): Promise<Result<string>> {
    let file: LocalFile;
    try {
      file = await d.read(uri);
    } catch {
      return { ok: false, error: 'We couldn’t read that photo. Take it again.' };
    }
    const init = await d.api.post<{ file: { fileId: string }; upload: { url: string; headers: Record<string, string> } }>(
      '/files/uploads',
      { fileClass, filename: file.filename, mime: file.mime, size: file.bytes.length, sha256: sha256Hex(file.bytes) },
      { idempotencyKey: d.newKey() },
    );
    if (!init.ok) return { ok: false, error: init.error.message };
    const stored = await d.put(init.value.upload.url, init.value.upload.headers, file).catch(() => false);
    if (!stored) return { ok: false, error: 'The upload didn’t finish. Check your connection and try again.' };
    const done = await d.api.post<{ file: { fileId: string } }>(`/files/uploads/${init.value.file.fileId}/complete`, {}, { idempotencyKey: d.newKey() });
    if (!done.ok) return { ok: false, error: done.error.message };
    return { ok: true, value: init.value.file.fileId };
  };
}

/* ---------- Step bodies ---------- */

/** The photos each step carries: local URI and the file class the server expects. */
export function stepFiles(app: DriverApplication, step: OnboardingStepId): { uri: string; fileClass: FileClass }[] {
  if (step === 'licence' && app.licence?.photoUri) return [{ uri: app.licence.photoUri, fileClass: 'driver_licence' }];
  if (step === 'identity' && app.identity?.selfieUri) return [{ uri: app.identity.selfieUri, fileClass: 'identity_document' }];
  if (step === 'documents') return VEHICLE_DOCUMENTS.flatMap((d) => (app.documents[d.id] ? [{ uri: app.documents[d.id]!, fileClass: 'vehicle_document' as FileClass }] : []));
  return [];
}

/** The PUT body for a step, with local photo URIs replaced by uploaded file ids. Null when the step has nothing to send. */
export function stepBody(app: DriverApplication, step: OnboardingStepId, fileId: (uri: string) => string | undefined): object | null {
  switch (step) {
    case 'personal':
      return app.personal ? { firstName: app.personal.firstName, lastName: app.personal.lastName, ...(app.personal.email ? { email: app.personal.email } : {}) } : null;
    case 'licence': {
      const l = app.licence;
      const id = l?.photoUri && fileId(l.photoUri);
      return l && id ? { number: l.number, expiry: l.expiry, photoFileId: id } : null;
    }
    case 'identity': {
      const i = app.identity;
      const id = i?.selfieUri && fileId(i.selfieUri);
      return i && id ? { type: i.type, number: i.number, selfieFileId: id } : null;
    }
    case 'vehicle': {
      const v = app.vehicle;
      return v ? { category: v.category, make: v.make, model: v.model, year: v.year, colour: v.colour, plate: v.plate } : null;
    }
    case 'documents': {
      const docs = Object.fromEntries(VEHICLE_DOCUMENTS.flatMap((d) => {
        const uri = app.documents[d.id];
        const id = uri && fileId(uri);
        return id ? [[d.id, id]] : [];
      }));
      return Object.keys(docs).length ? docs : null;
    }
  }
}

/** Staff review from the server onto the device's copy (the device keeps its photos and typed details). */
export function mergeServerReview(local: DriverApplication, view: ServerApplicationView): DriverApplication {
  const s = view.application;
  return { ...local, status: view.status, submittedAt: s.submittedAt, checks: s.checks, issues: s.issues, reviewNote: s.reviewNote, rejectionReason: s.rejectionReason };
}

/* ---------- Sync ---------- */

export interface ApplicationSyncDeps {
  api: DriverApplicationApi;
  upload(uri: string, fileClass: FileClass): Promise<Result<string>>;
  /** Local photo URI → uploaded file id, kept on the device so a photo is uploaded once. */
  files: { get(uri: string): string | undefined; set(uri: string, fileId: string): void };
  newKey(): string;
}

/**
 * Pushes steps and submissions with the server's version, uploading photos first. A version conflict
 * (another device saved meanwhile) re-reads the version and tries once more; anything else is returned.
 */
export function createApplicationSync(d: ApplicationSyncDeps) {
  let version: number | null = null;

  const refresh = async (): Promise<Result<ServerApplicationView>> => {
    const r = await d.api.get();
    if (!r.ok) return { ok: false, error: r.error.message };
    version = r.value.version;
    return { ok: true, value: r.value };
  };

  async function withVersion(send: (v: number) => Promise<ApiResult<ServerApplicationView>>): Promise<Result<ServerApplicationView>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (version === null) {
        const r = await refresh();
        if (!r.ok) return r;
      }
      const r = await send(version!);
      if (r.ok) {
        version = r.value.version;
        return { ok: true, value: r.value };
      }
      if (r.error.code !== 'VERSION_CONFLICT') return { ok: false, error: r.error.message };
      version = null;
    }
    return { ok: false, error: 'Your application changed on another device. Open it again.' };
  }

  return {
    pull: refresh,

    async pushStep(app: DriverApplication, step: OnboardingStepId): Promise<Result<ServerApplicationView | null>> {
      for (const f of stepFiles(app, step)) {
        if (d.files.get(f.uri)) continue;
        const up = await d.upload(f.uri, f.fileClass);
        if (!up.ok) return up;
        d.files.set(f.uri, up.value);
      }
      const body = stepBody(app, step, (uri) => d.files.get(uri));
      if (!body) return { ok: true, value: null };
      // A new key per attempt: the request includes the version, so a retry after a conflict is a new request.
      return withVersion((v) => d.api.saveStep(step, body, v, d.newKey()));
    },

    async submit(): Promise<Result<ServerApplicationView>> {
      return withVersion((v) => d.api.submit(v, d.newKey()));
    },
  };
}

export type ApplicationSync = ReturnType<typeof createApplicationSync>;
