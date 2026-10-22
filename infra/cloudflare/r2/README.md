# R2 definitions (D-051)

Status: **definitions only — nothing here has been created or deployed.** Pending R2 credentials and owner approval.

| File | What it is |
|---|---|
| `buckets.json` | The eight buckets (staging + production × public-media, private-documents, private-evidence, private-uploads). Only `public-media` is public, and only through a custom domain; `r2.dev` stays off everywhere. |
| `cors.production.json`, `cors.staging.json` | CORS for browser uploads (PUT to the quarantine bucket) and public media reads. Explicit origins, no `*`. Mobile apps don't use CORS. CORS is not access control. |
| `lifecycle.proposed.json` | Cleanup of abandoned uploads (staging-approved) and **proposed** retention notes. Do not apply to production until retention is signed off. |
| `wrangler.upload-signer.toml` | Worker template: presigns uploads/downloads, verifies completion. Secrets via `wrangler secret put`, never in the file. |
| `wrangler.media-gateway.toml` | Worker template for `media.gobye.app`, bound to the public bucket only. |

Setup steps: `docs/CLOUDFLARE_SETUP.md`. Design: `docs/R2_STORAGE_ARCHITECTURE.md`.
