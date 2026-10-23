# Backend Phase 2 plan: real Rider and Driver authentication and onboarding

**Status: PLAN ONLY.** Nothing in this document is implemented yet.

**Prerequisites** (from `BACKEND_PHASE_1_VERIFICATION.md`):
- corrections **C-1** (pooler start-up parameter) and **C-6** (rotate credentials);
- owner decisions **A-2, A-3, A-4, A-6**;
- a **Supabase staging project**.

**Scope:**
- Real accounts for riders and drivers (sign-up, sign-in, phone verification, password reset, Apple/Google, sign-out, account deletion).
- The driver application, from first step to staff approval.
- Staff sign-in for the admin.

**Out of scope:** rides, pricing, payments and the wallet (Phase 3+).

**Principles:**
- **Same screens:** the apps keep their screens; only a new `AuthService` implementation and a driver application service are added behind the existing interfaces (`packages/core/src/services/types.ts`). Each one has a switch to fall back to mocks.
- **Server decides:** Supabase Auth owns credentials and sessions. The API owns profiles, roles, applications and decisions.
- **Staging only** until the owner approves production (Q-072). Nothing is submitted to the stores.

## 1. What already exists and will be reused

| Piece | Where | Use in Phase 2 |
|---|---|---|
| Auth interface | `packages/core/src/services/types.ts` `AuthService` (signUp, signIn, socialSignIn, requestOtp, verifyOtp, password reset, updateProfile, requestAccountDeletion, signOut) | Implement `createSupabaseAuthService()` against it |
| Sign-up / sign-in screens | `@gobye/ui` journey blocks (D-043, D-045, D-047, D-048), `apps/rider`, `apps/driver` | Unchanged |
| Driver application model | `packages/core/src/driver/onboarding.ts` (5 steps), `driver/verification.ts` (checks, issues) | Same validation on the server |
| Token verification, principals, permissions, idempotency, audit, validation, migrations | `apps/api` (Phase 1) | Unchanged; new routes use them |
| File lifecycle + upload signer Worker | `packages/core/src/files`, `infra/cloudflare` upload signer, `ops.files` | Document uploads |
| Admin driver review UI | `apps/admin/src/workspaces/people` | Switched from test data to the API, behind a switch |

## 2. Decisions needed before coding (owner)

| # | Question | Options | Recommendation |
|---|---|---|---|
| A-3 | "Every sign-in ends with a phone code" (D-045/D-048) | (a) Supabase phone MFA on every sign-in: +$75/month for the first project, +$10 each additional, plus SMS. (b) Verify the phone once at sign-up, again on a new device, and on sensitive changes. (c) Phone OTP *is* the sign-in (no password). | **(b)** |
| A-4 | SMS route for one-time codes | A provider built into Supabase (Twilio, MessageBird, Vonage, Textlocal), or the **Send SMS hook** (verified with Standard Webhooks) to a Nigerian gateway | Test delivery and price to MTN, Airtel, Glo and 9mobile on staging, then choose |
| A-6 | Access-token lifetime | 5–60 min | 15 min |
| A-9 | Identity checks for drivers (NIN, licence) | Manual staff review only at launch, or a KYC provider (NIN/BVN/licence lookup) | Manual at launch; choose a provider in Phase 2b |
| A-5 | Documents before a malware scanner exists | Wait, or review unscanned files in a restricted viewer | Wait: choose a scanner (Q-067) in Phase 2 |
| A-10 | Terms and privacy notice versions that sign-up records consent to (Q-063, NDPA) | — | Legal to supply text and version ids |

## 3. Work packages

### WP0: preconditions (1–2 days of engineering after the owner's steps)

1. **C-1:** drop the start-up `statement_timeout`. Set it on the role, test through the staging pooler (6543) and directly (5432).
2. Create the staging Supabase project and roles (`DATABASE_MIGRATIONS.md` §Roles). Run `migrate up`. Point a locally running API at it. Prove the verification items blocked in Phase 1:
   - real JWKS, a real token on `/v1/me`, key rotation;
   - `bypassrls` (or the policy fallback);
   - the CA certificate.
3. Activate CI (C-3), add ESLint (C-2), and get the first real image build, pinned by digest (C-4).
4. Supabase Auth settings: email + password, phone, Apple, Google, TOTP; the A-6 token lifetime; refresh-token reuse detection; redirect URLs `gobye://auth-callback` (rider) and `gobyedriver://auth-callback` (driver), staging variants included.
5. Rate limits and abuse controls:
   - Supabase Auth limits for sign-ups, OTP and password reset, set to Nigerian-scale numbers;
   - phone numbers restricted to `+234` (server check plus the SMS hook if used);
   - Cloudflare Turnstile CAPTCHA on admin and web sign-in (Supabase supports CAPTCHA);
   - an SMS spend alert.

**Exit:** `/v1/me` answers 200 for a real staging account, and `health-check.mjs --expect-version` passes strictly (status `ok`, not `degraded`).

### WP1: API, accounts (riders and drivers)

**Migration `0006_accounts.sql`:**
- `app.consents (user_id, document, version, accepted_at, ip_hash)`, append-only;
- `app.devices (id, user_id, platform, app_version, first_seen, last_seen, verified_at)`, for decision A-3(b);
- `app.account_deletions (user_id, requested_at, scheduled_for, status, completed_at)`.

**Endpoints** (all writes take an `Idempotency-Key`; zod `.strict()` bodies; audit rows in the same transaction):

| Method and path | Who | Does |
|---|---|---|
| `POST /v1/me/profile` | Signed in, no profile yet | Creates `app.users` plus `app.riders` or `app.drivers` (`role: rider\|driver`; driver needs `city: lagos\|abuja`) and records consents. **Requires a verified phone:** check the token's `phone` claim (confirm on staging that Supabase sets it only after verification; otherwise read `phone_confirmed_at` via an auth hook claim). Second role later (a rider becomes a driver) with `POST /v1/me/roles`. |
| `PATCH /v1/me/profile` | Self | Name only. Email and phone changes go through Supabase (verified), then sync. |
| `GET /v1/me` | Self | Exists. Adds `consentsNeeded`, `deviceVerified`. |
| `POST /v1/me/devices` | Self | Registers a device. Returns `verificationRequired` per A-3(b). |
| `DELETE /v1/me` | Self | Starts deletion: a job anonymises `app.users` after a grace period and deletes the Supabase user through the Auth admin API. **The worker is the only component holding the service-role key, scoped to this job.** Keeps records the law requires (SECURITY_PRIVACY §9). |

**Guards:** `@RequireRole('rider'|'driver')` and `@RequireApprovedDriver()` (C-5). Every route checks ownership.

**Tests:**
- API integration tests with locally signed tokens, as in Phase 1;
- staging contract tests with real Supabase test users (a script, not run in CI against production);
- deletion idempotency;
- consent replay.

### WP2: apps, real sign-in behind a switch

**Shared client:** a `packages/core`-compatible `createSupabaseAuthService(config)` in a new small package `packages/auth-client` (it imports `@supabase/supabase-js`, so it stays out of the pure core).

- **Session storage:** `expo-secure-store` holds an encryption key. The encrypted session goes in AsyncStorage, because SecureStore values are small. `autoRefreshToken` stops when the app goes to the background and resumes when it comes back.

**Flows (same screens):**

| Flow | Steps |
|---|---|
| Sign up | `signUp(email, password, data: { full_name })`, then add the phone and confirm the code, then `POST /v1/me/profile` |
| Sign in | Email (or phone) + password. Then, per A-3(b), a phone code on a new device or after a long gap. |
| Apple (iOS) | `expo-apple-authentication` with a hashed nonce, then `signInWithIdToken('apple')`. Save the name on the first sign-in (Apple sends it once). |
| Apple (Android) | OAuth with a deep link (Supabase docs) |
| Google | Native Google sign-in, then `signInWithIdToken('google')` |
| Password reset | Email code (`resetPasswordForEmail`) then `verifyOtp(type: recovery)` then `updateUser({ password })`. Always "sent" (no account enumeration). |
| Sign out | `signOut({ scope: 'local' })`, then wipe local state |

**Switching:** `EXPO_PUBLIC_USE_MOCKS=false` and `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public by design), validated by `parsePublicConfig`. Mocks remain the default for demos.

**Error copy:** neutral and mapped from codes (D-045). Rate limits show "Try again in N seconds".

**Tests:** Jest with a fake Supabase client (each flow's states and errors); the existing journey screen tests; manual device tests on iOS and Android (`DEVICE_TEST_MATRIX.md`). Nothing is marked tested until run on a device.

### WP3: API, driver application

**Migration `0007_driver_applications.sql`:**
- `app.driver_applications (driver_id pk, status draft|submitted|in_review|changes_requested|approved|rejected, version, submitted_at, decided_at, decided_by)`;
- `app.driver_application_steps (driver_id, step personal|licence|identity|vehicle|documents, data jsonb, saved_at)`, validated with the core rules;
- `app.driver_application_issues (id, driver_id, step, message, raised_by, resolved_at)`;
- `app.driver_documents (driver_id, kind licence_front|licence_back|identity|registration|insurance|roadworthiness|photo, file_id → ops.files, expires_on)`;
- `app.application_events`, append-only.

The schema allows one application per driver; resubmission continues it.

**Endpoints:**

| Method and path | Who | Rules |
|---|---|---|
| `GET /v1/drivers/me/application` | Driver | Full state, issues, checks |
| `PUT /v1/drivers/me/application/steps/{step}` | Driver (draft or changes_requested) | Core validation (`packages/core/src/driver`); saving resolves that step's issues; version check (`If-Match`) |
| `POST /v1/drivers/me/application/submit` | Driver | Every step complete, documents uploaded and **approved by the scanner**; draft → submitted |
| `POST /v1/files/uploads`, `/complete` | Driver | Existing contract (`R2_STORAGE_ARCHITECTURE.md`): presign → upload signer → scan. Files stay unreadable until clean. |
| `GET /v1/staff/driver-applications?status&city` | Staff `drivers.view` + MFA, city scope | Review queue |
| `POST /v1/staff/driver-applications/{id}/request-changes` | Staff `drivers.verify` | Issues per step; audit |
| `POST /v1/staff/driver-applications/{id}/decision` | Staff `drivers.verify` | Approve or reject with a reason. Approval sets `app.drivers.verification_status = approved` and needs every document valid and not expired (BR-071). A second-person approval if the owner requires it (`approvals.ts`). |
| `GET /v1/files/{id}/download?reason=` | Staff with a file permission | 60-second private URL; reason audited |

**Notifications to the driver** (submitted, changes requested, approved): jobs `notify.application_*` through the `NotificationSender` port. Push and SMS providers are still to be chosen; until then, in-app status only.

**Tests:**
- state machine: every allowed and forbidden transition;
- validation parity with core;
- concurrency (two staff deciding at once → one wins via the version);
- document expiry;
- city scope;
- audit rows;
- file access logging.

### WP4: Driver App and admin connected

- **Driver App:** registration steps call the API (the screens exist). Status screens read `GET /v1/drivers/me/application`. Uploads use presigned URLs, with progress and retry.
- **Admin:**
  - staff sign-in through Supabase (email + password + TOTP; Turnstile);
  - the Drivers workspace review queue, the document viewer (signed URLs), request changes and decisions;
  - behind `VITE_USE_MOCKS=false`, with the test dataset staying the default.
- **Tests:** admin Vitest against a mocked API client; an end-to-end script on staging (apply, then upload, submit, request changes, fix, approve).

### WP5: hardening and staging acceptance

- **Security review:**
  - threat model update (`THREAT_MODEL.md`) for auth and documents;
  - OTP abuse;
  - session theft on the device;
  - staff access to documents;
  - deletion.
- **Load:** sign-up and sign-in burst (Supabase limits) and API p95 under 100 rps on the StackShift staging instance (test R3).
- **Observability:** sign-up funnel metrics (no personal data), OTP send and verify counts, failures by code; alerts on spikes.
- **Privacy:** consent records, the retention job for rejected applicants (Q-071), the data export path (NDPA access requests).

**Exit criteria for Phase 2:**
- A rider and a driver can create real accounts on staging devices, sign in on a second device (A-3(b)), reset a password and delete the account.
- A driver can complete and submit an application with scanned documents; staff request changes, then approve.
- Every step is audited.
- All automated tests pass with Postgres.
- The device test matrix entries for these flows are run and recorded.
- No production deploy without owner approval.

## 4. Order and dependencies

```
Owner: C-6, A-2/A-3/A-4/A-6, Supabase staging ─┐
WP0 (C-1, CI, lint, image, Auth settings) ─────┴─▶ WP1 (accounts API) ─▶ WP2 (apps sign-in)
                                                     │
                                Q-067 scanner ──────▶ WP3 (application API + files) ─▶ WP4 (Driver App + admin)
                                                                                        │
                                                                                        ▼
                                                                                  WP5 (hardening, acceptance)
```

WP1 and WP2 can ship to staging before WP3. Riders can sign up while driver documents wait for the scanner.

## 5. Costs Phase 2 adds

| Item | Cost | Note |
|---|---|---|
| Supabase Pro (staging and production projects) | ≈ $40/month (see `INFRASTRUCTURE_COSTS.md`) | Needed for no pausing, backups and the auth features |
| SMS one-time codes | Per message; provider not chosen | Volume ≈ sign-ups + new-device sign-ins under A-3(b) |
| Supabase phone MFA (only if A-3(a)) | $75/month first project + $10 each additional | Avoided by A-3(b) |
| Malware scanner (Q-067) | Unknown | Needed before documents can be approved |
| KYC provider (only if A-9 chooses one) | Per lookup | Not needed at launch with manual review |
| StackShift staging | Unknown (Q-075) | |

## 6. Risks specific to Phase 2

| Risk | Mitigation |
|---|---|
| SMS pumping / toll fraud through sign-up OTPs | `+234` only; CAPTCHA on web; per-number, device and IP limits; spend alert |
| Account takeover by SIM swap (phone code as second factor) | Password plus device verification; staff see recent phone changes; sensitive changes need re-authentication |
| Session theft from a rooted or jailbroken device | Encrypted storage; short access tokens; server-side suspension; session list and "sign out everywhere" (later) |
| Documents seen by the wrong staff | Per-file permission, reason required, 60 s URLs, audit; never on the public media domain |
| Apple App Review (4.8 sign-in options, account deletion 5.1.1(v)) | Apple offered with Google; in-app deletion (`DELETE /v1/me`) shipped in WP1 |
