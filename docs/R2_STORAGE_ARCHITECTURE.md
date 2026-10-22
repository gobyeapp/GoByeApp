# R2 storage architecture (D-051)

How GoBye stores driver documents, profile photos, incident evidence and public media in Cloudflare R2.

**Status at a glance**

| Part | Status |
|---|---|
| File model, policy, validation, lifecycle, `FileService` (`packages/core/src/files`) | **Implemented, tested locally** (jest, mock object store) |
| SigV4 presigner for R2 (`infra/cloudflare/src/r2/sigv4.ts`) | **Implemented, tested locally** (matches the published AWS example signature) |
| R2 ObjectStore adapter on Worker bindings (`src/r2/bindings.ts`) | **Implemented, tested locally** against an in-memory R2 fake |
| Upload signer Worker (`src/workers/upload-signer`) | **Implemented, tested locally**. Not deployed: **pending credentials, gateway, database, scanner** |
| Public media gateway Worker (`src/workers/media-gateway`) | **Implemented, tested locally**. Not deployed: **pending approval of `media.gobye.app`** |
| Buckets, CORS, lifecycle (`infra/cloudflare/r2/*.json`) | **Configured as definitions only**. No bucket exists yet: **pending credentials** |
| Metadata database | **Pending provider selection** (in-memory repository today) |
| Malware scanning | **Pending provider selection** (interface + fail-closed default) |
| Video transcoding / adaptive streaming | **Future enhancement** (interface only) |
| Mobile apps uploading for real | **Pending deployment**: the driver app's photo capture still stores on the phone (simulated), and will call `/v1/files/*` through the API client once the backend exists |

Nothing here has been verified in staging or production.

## Buckets

Environment-specific names, so staging can never read or overwrite production objects (`bucketName()` in `policy.ts`, definitions in `infra/cloudflare/r2/buckets.json`):

| Bucket (production / staging) | Holds | Public? |
|---|---|---|
| `gobye-prod-private-uploads` / `gobye-staging-private-uploads` | **Quarantine.** Every upload lands here first, whatever its class | Never |
| `gobye-prod-private-documents` / `…staging…` | Driver licence, identity document, vehicle papers, profile photos (after approval) | Never |
| `gobye-prod-private-evidence` / `…staging…` | Incident photos and videos (after approval) | Never |
| `gobye-prod-public-media` / `…staging…` | Approved public images and clips | Only via `media.gobye.app` (custom domain). `r2.dev` off |

Private buckets have no public domain and no `r2.dev` URL. Access to a private object is only ever a short-lived presigned URL issued after an authorisation check.

## File classes

From `FILE_RULES` (`packages/core/src/files/policy.ts`):

| Class | Who uploads | Types | Max | Final bucket | Retention (proposed) |
|---|---|---|---|---|---|
| `profile_photo` | rider, driver | JPEG, PNG, WebP, HEIC/HEIF | 5 MB | private-documents | account lifetime |
| `driver_licence`, `identity_document`, `vehicle_document` | driver | images + PDF | 10 MB | private-documents | driver account + 6 years (proposed) |
| `incident_photo` | rider, driver, safety staff | images | 15 MB | private-evidence | 7 years or legal hold (proposed) |
| `incident_video` | rider, driver, safety staff | MP4, MOV | 200 MB | private-evidence | 7 years or legal hold (proposed) |
| `public_media` | admin | images, MP4 | 50 MB | public-media | until unpublished |

All classes, public media included, are scanned before anyone can read them. Staff readers per class (`STAFF_READERS`) must give a reason, which is audited.

## Upload flow

1. **Initialise** — `POST /v1/files/uploads` through the API gateway with `{ fileClass, filename, mime, size, sha256 }`. The gateway authenticates the session and forwards a signed caller assertion (`x-gobye-assertion`, HMAC with `GATEWAY_ASSERTION_SECRET`, ≤ 60 s old). The signer:
   - refuses an unauthenticated caller or a role that may not upload the class;
   - validates the claims (extension allowlist, MIME allowlist, size min/max, SHA-256 format);
   - enforces quota (300 MB per person, ≤ 10 waiting uploads — placeholders);
   - generates the object key itself: `{class}/{owner-hash}/{yyyy}/{mm}/{fileId}.{ext}` — no part of the user's filename or phone number;
   - records metadata as `pending_upload`;
   - returns a presigned PUT for the **quarantine** bucket, valid **5 minutes**, signing `content-type`, `content-length` and `x-amz-checksum-sha256`.
2. **Upload** — the app PUTs the bytes straight to R2 (no Worker in the data path, so no Worker size or CPU limits apply). R2 verifies the SHA-256 header and refuses a mismatch.
3. **Complete** — `POST /v1/files/uploads/:id/complete`. The client's "upload finished" is never authoritative. The signer:
   - checks the caller owns the upload and that it is still `pending_upload` (completion is **single use**: a second call gets `already_completed`);
   - expires it if past its window;
   - `HEAD`s the object — none yet means `not_uploaded`, and it stays pending so the app can retry until expiry (interrupted uploads);
   - compares stored size and SHA-256 to the claims;
   - reads the first bytes and detects the real type (JPEG, PNG, WebP, HEIC/HEIF, PDF, MP4/MOV signatures), which must be allowed and agree with the claim.
   - Any mismatch: the object is deleted and the record becomes `rejected`.
4. **Scan** — `uploaded → scanning`. A clean result copies the object to its final bucket, removes it from quarantine and marks it `approved`. Infected → `quarantined` (never readable). Pending/error → stays `scanning`; `rescanPending()` retries. **With no scanner connected (today), nothing is ever approved: fail closed.**
5. **Cleanup** — `expireStale()` marks waiting uploads past their window `expired` and deletes any partial object. The proposed bucket lifecycle also aborts incomplete multipart uploads after 1 day and clears quarantine after 2 days (staging only until approved).

### About presigned URLs

- They are generated only by trusted server code (the signer Worker); R2 keys never reach an app or browser bundle.
- They must use the S3 endpoint `https://<accountId>.r2.cloudflarestorage.com`, path style, region `auto` — not a custom domain.
- **A presigned URL can be used repeatedly until it expires.** We keep upload URLs at 5 minutes and private downloads at 60 seconds (`UPLOAD_URL_TTL`, `PRIVATE_DOWNLOAD_TTL`; the presigner clamps to 1 hour max). Re-uploading to the same URL only overwrites the same quarantined key before completion; after completion the record no longer accepts it (single-use completion), and approved objects live in a different bucket.
- Signed headers mean the client can't change type, length or checksum without breaking the signature.

## Download flow

`GET /v1/files/:id/download` (through the gateway) → `{ url, expiresAt }`:
- owner, or staff with a role for that class **and a reason** (recorded in the audit event);
- only `approved` files (still checking / failed checks → `not_available`);
- private: presigned GET for 60 s with `response-cache-control: private, no-store`;
- public: the `media.gobye.app` URL (long-cached, immutable keys).

Listing returns the caller's own files only; there is no way to enumerate another person's files or the buckets. Responses never include bucket names or object keys.

## Public media gateway

`media.gobye.app` is a Worker bound to the public bucket alone, so it physically cannot read private buckets. It serves only keys matching `public_media/<hash>/<yyyy>/<mm>/<id>.<jpg|png|webp|heic|heif|mp4>`, with `Cache-Control: public, max-age=31536000, immutable`, ETag/304, `nosniff` and a restrictive CSP. Placing a file behind a Worker does not make it private by itself: privacy comes from the bucket split and the signer's checks.

## CORS

Configured only on the quarantine bucket (browser PUT) and the public bucket (GET), with explicit origins (`gobye.app`, `www.gobye.app`, `admin.gobye.app`; staging hosts in staging). Never `*`. The mobile apps don't send `Origin`, so CORS doesn't affect them. CORS is not access control; the signature and the server checks are.

## Metadata

`FileRecord` (`packages/core/src/files/types.ts`) is what the backend database will hold:
- identity and ownership: file id, owner, class, access class, related user / vehicle / trip;
- location: bucket and key;
- state: status, scan status, deletion status;
- content: claimed vs detected MIME, declared vs verified size, SHA-256;
- times and policy: timestamps, upload expiry, retention policy.

R2 object names are not the database. `FileMetadataRepository` is the seam: in-memory now, a table once a database is chosen.

## Retention, deletion and backup (proposals)

- **Owners:**
  - Owners can delete their own documents and photos (object deleted, record `deleted`).
  - Incident evidence can't be deleted by its owner; a deletion request is recorded for review.
- **Staff:** admins can delete with a reason, which is audited.
- **Retention:** periods are proposals pending legal (NDPA) and business sign-off. Retention deletes will be driven by the application (account closure + period), not by object-age rules. `lifecycle.proposed.json` holds only cleanup rules, approved for staging.
- **Backup:** critical buckets (documents, evidence) should be copied daily to a separate account or bucket with different credentials, so an accidental or malicious delete in one is recoverable. See `BACKUP_DISASTER_RECOVERY.md`. Pending approval and cost.
- **Monitoring:** watch bucket size growth, upload failure rate, quarantine counts, and files stuck in `scanning` (scanner down). See `MONITORING_OBSERVABILITY.md`.

## Video

`VideoService` (`packages/core/src/files/video.ts`):
- **Storage:** originals (MP4/MOV) go through the same upload, check, scan and access rules, into the evidence bucket (incidents) or the public bucket (staff clips).
- **No processing:** R2 stores and serves files. It does **not** transcode or create adaptive streams. MP4 (H.264) plays as is; MOV/HEVC may not play in every browser, and the asset says so (`playableAsIs`, `note`).
- **States:** `uploading`, `checking`, `ready_original`, `processing`, `ready_streaming`, `failed`, `unsupported`.
- **Later:** a `StreamingProvider` (e.g. Cloudflare Stream) can be added behind the same interface. That is a future enhancement, pending approval.
- **Incident footage:** for this, authorisation and retention matter more than streaming quality.

## Mobile apps

The driver app's licence, identity and vehicle-paper screens use `PhotoCapture`, which today keeps the photo on the phone (simulated). Wiring it to `/v1/files/*` happens once the API gateway and a backend exist. No UX change is needed: capture → initialise → PUT → complete, with progress and retry handled by the shared API client.

## Tests

- **`packages/core/src/__tests__/files-validate-policy.test.ts`:** type detection, claims, content mismatch, keys, display names, transitions.
- **`files-service.test.ts`:** the full lifecycle, plus expired, interrupted, wrong owner, duplicate completion, size/content mismatch, bad checksum, infected, fail-closed scanner, staff reason, listing, quota, deletion, video.
- **`infra/cloudflare/test/r2-sigv4.test.ts`:** the AWS vector, R2 URLs, bounds.
- **`upload-signer.test.ts`:** the Worker end to end against an R2 fake, covering valid, unauthorised/forged/stale assertions, invalid type, oversized, expired, interrupted, wrong owner, duplicate, bad checksum, content mismatch, infected, no scanner, private access, and no leaks.
- **`media-gateway.test.ts`:** serves public keys only and refuses private classes and traversal.

These are local tests with fakes; they do not prove the real R2 behaviour. The first staging run must confirm in particular that R2 enforces the signed `x-amz-checksum-sha256` header on presigned PUTs (`INFRASTRUCTURE_TEST_PLAN.md`).
