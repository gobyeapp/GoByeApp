import {
  FileError,
  PendingScanner,
  createFileService,
  createMemoryFileRepository,
  type DeployEnvironment,
  type FileAuditEvent,
  type FileErrorCode,
  type FileMetadataRepository,
  type FileRecord,
  type FileService,
  type MalwareScanner,
} from '@gobye/core';
import { ASSERTION_HEADER, verifyAssertion } from '../../r2/assertion';
import { createR2ObjectStore, type R2BucketLike } from '../../r2/bindings';

/**
 * Upload signer Worker (D-051). Reached only through the API gateway on `/v1/files/*`, which
 * authenticates the session and forwards a signed caller assertion. It issues short-lived presigned
 * R2 URLs, verifies completed uploads server-side, and issues short-lived downloads.
 *
 * Status: implemented and tested locally with an in-memory R2 fake. Not deployed (pending R2
 * credentials, the gateway, a metadata database and a malware scanner). With no scanner bound, files
 * stay "checking" and are never served (fail closed).
 */

export interface UploadSignerEnv {
  DEPLOY_ENV: DeployEnvironment;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  GATEWAY_ASSERTION_SECRET: string;
  PUBLIC_MEDIA_BASE_URL?: string;
  UPLOADS: R2BucketLike;
  DOCUMENTS: R2BucketLike;
  EVIDENCE: R2BucketLike;
  PUBLIC_MEDIA: R2BucketLike;
}

export interface UploadSignerDeps {
  /** Metadata store. In-memory until a database is chosen (pending provider selection). */
  repo?: FileMetadataRepository;
  scanner?: MalwareScanner;
  audit?: (e: FileAuditEvent) => void;
  now?: () => number;
  newId?: () => string;
}

const STATUS: Record<FileErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_type: 422,
  too_large: 413,
  too_small: 422,
  quota_exceeded: 429,
  invalid_checksum: 422,
  expired: 410,
  not_uploaded: 409,
  verification_failed: 422,
  already_completed: 409,
  not_available: 409,
  reason_required: 400,
  invalid_state: 409,
};

const MAX_JSON_BYTES = 4096;

function json(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-request-id': requestId, 'x-content-type-options': 'nosniff' },
  });
}
const errorBody = (code: string, message: string, requestId: string) => ({ error: { code, message, requestId } });

/** What clients see of a file: no bucket names or object keys. */
export const publicView = (r: FileRecord) => ({
  fileId: r.fileId,
  fileClass: r.fileClass,
  status: r.status,
  mime: r.detectedMime ?? r.claimedMime,
  size: r.verifiedSize ?? r.declaredSize,
  createdAt: r.createdAt,
  related: r.related,
});

/** Structured log line with no secrets, tokens, URLs or file contents. */
function log(e: Record<string, unknown>) {
  console.log(JSON.stringify({ service: 'upload-signer', ...e }));
}

export function createUploadSigner(deps: UploadSignerDeps = {}) {
  const repo = deps.repo ?? createMemoryFileRepository();
  let service: FileService | null = null;
  let boundTo: UploadSignerEnv | null = null;

  const svc = (env: UploadSignerEnv) => {
    if (!service || boundTo !== env) {
      boundTo = env;
      service = createFileService({
        env: env.DEPLOY_ENV,
        repo,
        scanner: deps.scanner ?? PendingScanner,
        audit: deps.audit ?? ((e) => log({ event: 'audit', action: e.action, fileId: e.fileId, fileClass: e.fileClass, actor: e.actor, hasReason: !!e.reason })),
        now: deps.now,
        newId: deps.newId,
        publicMediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL,
        store: createR2ObjectStore({
          env: env.DEPLOY_ENV,
          now: deps.now,
          creds: { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
          buckets: { 'private-uploads': env.UPLOADS, 'private-documents': env.DOCUMENTS, 'private-evidence': env.EVIDENCE, 'public-media': env.PUBLIC_MEDIA },
        }),
      });
    }
    return service;
  };

  async function readJson(request: Request): Promise<Record<string, unknown> | null> {
    const len = Number(request.headers.get('content-length') ?? '0');
    if (len > MAX_JSON_BYTES) return null;
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) return null;
    try {
      const v = JSON.parse(text || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  return {
    async fetch(request: Request, env: UploadSignerEnv): Promise<Response> {
      const started = (deps.now ?? Date.now)();
      const requestId = /^[A-Za-z0-9-]{8,64}$/.test(request.headers.get('x-request-id') ?? '') ? request.headers.get('x-request-id')! : crypto.randomUUID();
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '');
      let status = 500;
      try {
        const caller = await verifyAssertion(request.headers.get(ASSERTION_HEADER), env.GATEWAY_ASSERTION_SECRET, (deps.now ?? Date.now)());
        if (!caller) {
          status = 401;
          return json(401, errorBody('unauthenticated', 'Sign in to continue.', requestId), requestId);
        }
        const s = svc(env);
        let m: RegExpMatchArray | null;

        if (request.method === 'POST' && path === '/v1/files/uploads') {
          const b = await readJson(request);
          if (!b) return json((status = 400), errorBody('invalid_request', 'Send a small JSON body.', requestId), requestId);
          const r = await s.initializeUpload(caller, {
            fileClass: String(b.fileClass) as never,
            filename: String(b.filename ?? ''),
            mime: String(b.mime ?? ''),
            size: Number(b.size),
            sha256: String(b.sha256 ?? ''),
            related: typeof b.related === 'object' && b.related ? (b.related as FileRecord['related']) : undefined,
          });
          return json((status = 201), { file: publicView(r.file), upload: r.upload }, requestId);
        }
        if (request.method === 'POST' && (m = path.match(/^\/v1\/files\/uploads\/([a-z0-9-]{8,64})\/complete$/))) {
          return json((status = 200), { file: publicView(await s.completeUpload(caller, m[1])) }, requestId);
        }
        if (request.method === 'GET' && (m = path.match(/^\/v1\/files\/([a-z0-9-]{8,64})\/download$/))) {
          const access = await s.getDownloadAccess(caller, m[1], url.searchParams.get('reason') ?? undefined);
          return json((status = 200), { url: access.url, expiresAt: access.expiresAt }, requestId);
        }
        if (request.method === 'GET' && (m = path.match(/^\/v1\/files\/([a-z0-9-]{8,64})$/))) {
          return json((status = 200), { file: publicView(await s.getFileMetadata(caller, m[1])) }, requestId);
        }
        if (request.method === 'DELETE' && (m = path.match(/^\/v1\/files\/([a-z0-9-]{8,64})$/))) {
          await s.deleteFile(caller, m[1], url.searchParams.get('reason') ?? undefined);
          return json((status = 200), { ok: true }, requestId);
        }
        if (request.method === 'GET' && path === '/v1/files') {
          const fileClass = url.searchParams.get('class') ?? undefined;
          return json((status = 200), { files: (await s.listAuthorizedFiles(caller, fileClass ? { fileClass: fileClass as never } : undefined)).map(publicView) }, requestId);
        }
        return json((status = 404), errorBody('not_found', 'Not found.', requestId), requestId);
      } catch (e) {
        if (e instanceof FileError) return json((status = STATUS[e.code] ?? 400), errorBody(e.code, e.message, requestId), requestId);
        // Never leak internals (bucket names, stack traces) to the client.
        log({ event: 'error', requestId, error: e instanceof Error ? e.name : 'unknown' });
        return json((status = 500), errorBody('internal', 'Something went wrong. Try again.', requestId), requestId);
      } finally {
        log({ event: 'request', requestId, method: request.method, route: path.replace(/[a-z0-9-]{8,64}/g, ':id'), status, ms: (deps.now ?? Date.now)() - started });
      }
    },
  };
}

/** Deployed entry point (when approved). In-memory metadata: pending database selection. */
export default createUploadSigner();
