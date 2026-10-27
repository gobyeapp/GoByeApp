# GoBye — API Contracts

> **Status: PROPOSED.** Every endpoint, field and event in this document is a proposal for the future backend. Nothing here exists yet; the apps currently use mock services (`ARCHITECTURE.md` §5). Field names mirror `DATA_MODELS.md`. Numeric values in examples are mock (`BUSINESS_RULES.md`).

---

## 1. Conventions

| Item | Convention |
|---|---|
| Base URL | `https://api.gobye.app/v1` (proposed) |
| Format | JSON, UTF-8, `camelCase` fields |
| Auth | `Authorization: Bearer <accessToken>` on all endpoints except OTP request/verify and refresh |
| Roles | Token carries `role: passenger \| driver`; endpoints under `/driver/*` require `driver` |
| Money | Integer **kobo**, field suffix `Kobo` (e.g. `amountKobo: 345000` = ₦3,450). Currency always `NGN`. Never floats (BR-001) |
| Time | ISO-8601 UTC strings, e.g. `2026-10-21T14:05:00Z`. Durations in seconds, distances in metres |
| IDs | Opaque strings with prefixes: `usr_`, `bkg_`, `qt_`, `off_`, `rsp_`, `drv_`, `pm_`, `pay_`, `tkt_`, `ntf_` |
| Idempotency | `Idempotency-Key: <uuid v4>` **required** on every `POST`/`PATCH` that creates or mutates (bookings, offers, raise, select, cancel, charges, retries, refunds, payouts, trip phases). Same key + same body → original response replayed; same key + different body → `409 IDEMPOTENCY_MISMATCH`. Keys retained ≥ 24 h. **Exception (2026-10-21):** payment charge/confirmation attempts use the deterministic key `${bookingId}-${attempt}` (attempt persisted on the booking, BR-108) so a retry after an app restart reuses the same key |
| Concurrency | Resources include `version` (integer). Mutations may send `If-Match: <version>`; mismatch → `409 VERSION_CONFLICT` |
| Pagination | Cursor: `?limit=20&cursor=<opaque>` → `{ "items": [], "nextCursor": "…" \| null }` |
| Client headers | `X-Client: rider-ios/1.0.0 (57)`, `X-Request-Id: <uuid>` (echoed back) |
| Simulation flag | Responses from sandbox include `"isSimulated": true` |

### 1.0 Gateway, route map and health (D-051)

The API gateway Worker (`infra/cloudflare/src/workers/api-gateway`, see `API_GATEWAY.md`) fronts every endpoint in this document. Route classes:

| Path | Class | Notes |
|---|---|---|
| `/v1/auth/*` | auth | no bearer needed; OTP has its own tighter limit |
| `/v1/users/*`, `/v1/drivers/*` | users, drivers | bearer required |
| `POST /v1/rides` | rides_create | booking creation; paused under the Maintenance policy |
| `/v1/rides/{id}/*`, `GET /v1/rides` | rides_active | trips in progress; never paused |
| `/v1/fares/*`, `/v1/offers/*` | fares, offers | |
| `/v1/payments/*` | payments | |
| `/v1/files/*` | files | metadata only; bytes go to R2 via presigned URLs |
| `/v1/notifications/*`, `/v1/support/*`, `/v1/safety/*` | … | support and safety never paused; safety never rate-limited |
| `GET /health/live`, `GET /health/ready` | gateway | every origin must implement both; `ready` checks critical dependencies and returns 503 when it can't serve |

**Naming to reconcile (Q-069):** this document's booking endpoints are written as `/bookings…`; the gateway's map uses `/v1/rides`. The backend picks one before implementation.

**Envelopes:** success `{ "data": …, "meta": { "requestId": "…" } }` from the backend (`{ "data", "requestId" }` from gateway-generated replies; clients read `data` and the `x-request-id` header); error `{ "error": { "code", "message", "requestId", "retryAfterSeconds"?, "details"? } }` (`packages/core/src/infra/health.ts`). Gateway-generated codes are lowercase (`rate_limited`, `backend_not_configured`, …); the domain codes below are upper case. The API client maps both by HTTP status (`infra/errors.ts`).

**Request ids:** the gateway always generates `X-Request-Id`; a well-formed client id is passed on as `X-Client-Request-Id`.

**Idempotency at the edge:** a write is only ever retried on another origin if it carries `Idempotency-Key` and the first origin refused the connection. A timed-out write is never replayed; clients resolve it by looking up the key (`resolveAmbiguous`).

**Files:** `POST /v1/files/uploads` (initialise → presigned PUT, 5 min), `POST /v1/files/uploads/{id}/complete` (single use, server verifies size/SHA-256/type, then scan), `GET /v1/files/{id}`, `GET /v1/files/{id}/download` (approved files only; private = 60 s presigned URL; staff must pass `reason`), `DELETE /v1/files/{id}`, `GET /v1/files` (caller's own only). Details in `R2_STORAGE_ARCHITECTURE.md`.

### 1.1 Error envelope

```json
{
  "error": {
    "code": "OFFER_OUT_OF_RANGE",
    "message": "Offer must be between ₦3,100 and ₦6,150.",
    "details": { "minKobo": 310000, "maxKobo": 615000 },
    "retryable": false,
    "retryAfterSeconds": null,
    "requestId": "req_8f2c…"
  }
}
```

`message` is safe to show but clients should map `code` to their own copy.

| HTTP | Codes (examples) |
|---|---|
| 400 | `INVALID_PHONE`, `OFFER_NOT_ON_STEP`, `unsupported_api_version`. **Validation failures are `422 validation_failed`** (D-059: matches the gateway and `packages/core` `ERROR_STATUS`; clients treat 400 and 422 alike) |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `OTP_INVALID`, `OTP_EXPIRED` |
| 403 | `FORBIDDEN`, `DRIVER_NOT_APPROVED`, `ACCOUNT_SUSPENDED`, `NO_ACTIVE_ACCESS` (driver has no active access package, BR-072), `PRECISE_LOCATION_REQUIRED` (BR-073) |
| 404 | `NOT_FOUND` |
| 409 | `INVALID_TRANSITION`, `QUOTE_EXPIRED`, `OFFER_EXPIRED`, `RESPONSE_EXPIRED`, `DRIVER_UNAVAILABLE`, `MAX_ROUNDS_REACHED`, `OFFER_LOWERED`, `ACTIVE_BOOKING_EXISTS`, `IDEMPOTENCY_MISMATCH`, `VERSION_CONFLICT` |
| 422 | `OFFER_OUT_OF_RANGE`, `COUNTER_OUT_OF_RANGE`, `CATEGORY_UNAVAILABLE`, `OUTSIDE_SERVICE_AREA`, `PAYMENT_METHOD_NOT_ENABLED` (e.g. cash while disabled, D-023) |
| 402 | `PAYMENT_DECLINED`, `INSUFFICIENT_WALLET_BALANCE` (wallet must cover fare + passenger-borne fee, BR-106), `TRANSFER_NOT_RECEIVED` |
| 429 | `RATE_LIMITED`, `OTP_ATTEMPTS_EXCEEDED` (with `retryAfterSeconds`) |
| 5xx | `INTERNAL`, `UPSTREAM_UNAVAILABLE` (`retryable: true`) |

---

## 2. Auth

### `POST /auth/otp/request`
```json
// request
{ "phone": "+2348031234567", "role": "passenger", "channel": "sms" }
// 200
{ "requestId": "otp_91a…", "expiresAt": "2026-10-21T14:10:00Z", "resendAvailableAt": "2026-10-21T14:05:30Z", "codeLength": 6 }
```
The code is never returned. Rate-limited per phone/device/IP.

### `POST /auth/otp/verify`
```json
// request
{ "requestId": "otp_91a…", "phone": "+2348031234567", "code": "482913", "deviceId": "dev_…" }
// 200
{
  "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-10-21T14:20:00Z",
  "refreshToken": "rt_…", "isNewUser": true,
  "user": { "id": "usr_1", "role": "passenger", "firstName": null, "lastName": null, "phone": "+2348031234567" }
}
```

### `POST /auth/refresh`
`{ "refreshToken": "rt_…" }` → new token pair (refresh token rotated; reuse of an old one revokes the family).

### `POST /auth/logout`
`{ "refreshToken": "rt_…" }` → `204`.

### `PATCH /me`
`{ "firstName": "Tolu", "lastName": "Adebayo", "email": "tolu@example.com", "acceptedTermsVersion": "2026-10" }` → `User`.

### `DELETE /me` (account deletion)
```json
// request (Idempotency-Key required)
{ "reason": "not_using", "confirm": true }
// 202
{ "status": "deletion_requested", "requestedAt": "2026-10-21T14:05:00Z",
  "blockers": [], "retainedDataSummaryUrl": "https://gobye.app/privacy#retention" }
// 409 when blocked
{ "error": { "code": "DELETION_BLOCKED", "details": { "blockers": ["active_booking", "outstanding_balance"] } } }
```

---

## 3. Places, geocoding, routes

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/places/search?q=ikeja&lat=6.60&lng=3.35&limit=10` | — | `{ "items": [Place] }` |
| GET | `/places/reverse?lat=6.6018&lng=3.3515` | — | `Place` |
| POST | `/routes` | `{ "origin": LatLng, "destination": LatLng, "category": "go" }` | `RouteEstimate` |
| GET | `/me/places` · POST `/me/places` · DELETE `/me/places/{id}` | `SavedPlace` | `SavedPlace` |

```json
// Place
{ "id": "plc_icm", "title": "Ikeja City Mall", "subtitle": "Obafemi Awolowo Way, Ikeja",
  "coordinate": { "latitude": 6.6135, "longitude": 3.3581 } }
// RouteEstimate
{ "distanceMeters": 14200, "durationSeconds": 2460, "polyline": "encoded…", "isSimulated": false }
```
Polyline transmitted encoded (Google polyline algorithm, proposed); client decodes to `LatLng[]`. Provider behind these endpoints is open (Q-007).

### 3.1 Proposed provider mapping — Google Maps Platform (D-025, **PROPOSED**, 2026-10-21)

These GoBye endpoints are a **server-side proxy** (recommendation): the app never holds the Places/Routes key; only the Maps SDK key for map rendering ships in the app, restricted per platform (iOS bundle ID; Android package + signing SHA-1) and per API.

| GoBye endpoint | Google API (proposed) | Notes |
|---|---|---|
| `GET /places/search` | Places API (New) Autocomplete | Client sends a `sessionToken` (UUID per search session) which the backend forwards so autocomplete + details bill as one session; bias to the city (Abuja/Lagos); restrict to `NG`. Add `sessionToken` query param. |
| `GET /places/{id}` (new) | Places API (New) Place Details | **Field mask** limited to `id,displayName,formattedAddress,location` (cost tier). |
| `GET /places/reverse` | Geocoding API (reverse) | Pickup label from pin; accuracy to be validated. |
| `POST /routes`, `POST /quotes` | Routes API `computeRoutes` | `travelMode: DRIVE`, `routingPreference: TRAFFIC_AWARE` (or `TRAFFIC_AWARE_OPTIMAL` if cost allows); **field mask** `routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline`. `RouteEstimate.durationSeconds` = traffic-aware duration. |
| Driver ETA to pickup | Routes API `computeRoutes` (or `computeRouteMatrix` for multiple candidates) | Server-side during dispatch. |

Server responsibilities: cache within the provider's terms, per-key quotas and budget alerts (Q-044), return `isSimulated: false` only for live provider data, and fall back to a clear error (`UPSTREAM_UNAVAILABLE`) rather than invented ETAs. The app keeps using `MapService` (D-004).

**Validation plan before accepting D-025:** on real devices in **Abuja** (e.g. Nnamdi Azikiwe Int'l Airport, Jabi Lake Mall, Wuse Market, Eagle Square, Ceddi Plaza) and **Lagos** (airport, island, mainland estates), compare search result and pin position against the actual pickup point; record distance error and whether a driver could find the pickup; compare Routes ETA with observed travel time at peak and off-peak; project monthly cost from calls per trip (Q-044). Rows in `DEVICE_TEST_MATRIX.md`.

---

## 4. Fare quotes

### `POST /quotes`
```json
// request
{ "pickup": { "latitude": 6.6018, "longitude": 3.3515 }, "destination": { "latitude": 6.4281, "longitude": 3.4219 },
  "categories": ["keke", "go", "comfort", "xl"] }
// 200
{
  "routeId": "rte_77",
  "route": { "distanceMeters": 14200, "durationSeconds": 2460, "polyline": "…", "isSimulated": false },
  "quotes": [
    {
      "id": "qt_go_1", "category": "go", "available": true,
      "breakdown": { "baseKobo": 50000, "distanceKobo": 255600, "timeKobo": 102500, "multiplier": 1.0, "roundingKobo": 1900, "totalKobo": 410000 },
      "suggestedKobo": 410000,
      "negotiationRange": { "minKobo": 310000, "maxKobo": 615000, "stepKobo": 5000 },
      "expiresAt": "2026-10-21T14:10:00Z"
    },
    { "id": "qt_keke_1", "category": "keke", "available": false, "unavailableReason": "NOT_IN_AREA" }
  ]
}
```
Range per BR-040, rounding per BR-002 (computed server-side): 75% × ₦4,100 = ₦3,075 → ₦3,100 on the ₦50 step; 150% = ₦6,150. `roundingKobo` makes the breakdown sum to the total (BR-023); `FareBreakdown` in `DATA_MODELS.md` would need this field — proposal.

---

## 5. Bookings (rider)

### `POST /bookings` — Quick Match
```json
// headers: Idempotency-Key
{ "mode": "quick_match", "quoteId": "qt_go_1", "pickup": Place, "destination": Place, "paymentMethodId": "pm_wallet" }
// 201
{ "id": "bkg_123", "version": 1, "mode": "quick_match", "status": "searching",
  "agreedFareKobo": 410000, "fareLockedAt": "2026-10-21T14:06:00Z", "searchExpiresAt": "2026-10-21T14:07:00Z",
  "charge": { "fareKobo": 410000, "processingFeeKobo": 0, "totalKobo": 410000, "feeBearer": "platform" }, … }
```
Errors: `QUOTE_EXPIRED`, `ACTIVE_BOOKING_EXISTS`, `CATEGORY_UNAVAILABLE`, `PAYMENT_METHOD_NOT_ENABLED`, `INSUFFICIENT_WALLET_BALANCE` (wallet bookings: balance < fare + passenger-borne fee, BR-106).

### `POST /bookings` — Negotiate
```json
{ "mode": "negotiate", "quoteId": "qt_go_1", "pickup": Place, "destination": Place,
  "paymentMethodId": "pm_bank_transfer", "offer": { "amountKobo": 350000 } }
// 201
{ "id": "bkg_124", "status": "negotiating",
  "offer": { "id": "off_1", "amountKobo": 350000, "round": 1, "status": "open",
             "createdAt": "2026-10-21T14:06:00Z", "expiresAt": "2026-10-21T14:07:30Z" },
  "responses": [], "maxRounds": 3 }
```
Errors: `OFFER_OUT_OF_RANGE`, `OFFER_NOT_ON_STEP`.

### `POST /bookings/{id}/offers` — raise offer
```json
{ "amountKobo": 380000, "previousOfferId": "off_1" }
// 201 → new offer
{ "id": "off_2", "amountKobo": 380000, "round": 2, "status": "open", "expiresAt": "2026-10-21T14:09:10Z" }
```
Errors: `OFFER_LOWERED`, `MAX_ROUNDS_REACHED`, `OFFER_OUT_OF_RANGE`. Previous offer → `withdrawn` (if open).

### `POST /bookings/{id}/responses/{responseId}/select`
```json
{ "offerId": "off_2" }
// 200
{ "id": "bkg_124", "status": "matched", "agreedFareKobo": 400000, "fareLockedAt": "…", "driver": DriverSummary }
// 409
{ "error": { "code": "DRIVER_UNAVAILABLE", "message": "This driver is no longer available.", "retryable": false } }
```
For wallet bookings the server rejects a selection the wallet cannot cover (`402 INSUFFICIENT_WALLET_BALANCE`, BR-106); the client also blocks it.

### `POST /bookings/{id}/switch-to-quick-match`
`{ "quoteId": "qt_go_1" }` → booking `searching` (or `409 QUOTE_EXPIRED`).

### `POST /bookings/{id}/retry-search`
→ `searching` from `no_drivers`.

### `GET /bookings/{id}/cancellation-preview`
```json
{ "feeKobo": 50000, "reason": "AFTER_FREE_WINDOW", "freeUntil": "2026-10-21T14:10:00Z" }
```

### `POST /bookings/{id}/cancel`
```json
{ "reasonCode": "changed_plans", "note": null, "acknowledgedFeeKobo": 50000 }
// 200
{ "id": "bkg_123", "status": "cancelled", "cancellation": { "by": "passenger", "feeKobo": 50000, "at": "…" } }
```
If the server-computed fee differs from `acknowledgedFeeKobo` → `409 FEE_CHANGED` with new preview (fee is never charged without acknowledgement).

### Other
| Method | Path | Purpose |
|---|---|---|
| GET | `/bookings/{id}` | Full booking (state recovery) |
| GET | `/bookings/active` | Current non-terminal booking or `204` |
| GET | `/bookings?cursor=` | History |
| GET | `/bookings/{id}/receipt` | `TripReceipt` |

---

## 6. Driver

| Method | Path | Request | Response / notes |
|---|---|---|---|
| GET | `/driver/me` | — | `Driver` incl. `verification`, `documents[]` with `expiresAt` |
| POST | `/driver/onboarding/{step}` | step data (`personal`, `licence`, `identity`, `vehicle`) | Updated onboarding progress |
| POST | `/driver/documents/upload-url` | `{ "type": "licence_front", "contentType": "image/jpeg" }` | `{ "uploadUrl": "…", "documentId": "doc_1", "expiresAt": "…" }` (pre-signed, short-lived) |
| POST | `/driver/documents/{id}/complete` | `{}` | Document `uploaded` |
| POST | `/driver/verification/submit` | `{}` | `{ "verification": "pending_review" }` |
| POST | `/driver/availability` | `{ "online": true, "location": LatLng, "accuracyMeters": 12, "permission": "when_in_use_precise", "backgroundCapable": true }` | `{ "state": "online_idle", "updateProfile": { "intervalMs": 15000, "distanceMeters": 50, "staleAfterMs": 60000 } }`; `403 DRIVER_NOT_APPROVED`, `403 NO_ACTIVE_ACCESS`, `403 PRECISE_LOCATION_REQUIRED`, `409 ON_TRIP` (going offline with an active trip) |
| GET | `/driver/access-packages` | — | `{ "items": [{ "id": "daily", "name": "Daily access", "priceKobo": 200000, "durationDays": 1, "provisional": true }, { "id": "monthly", …, "priceKobo": 6000000, "durationDays": 30 }] }` — prices provisional, server-configurable (D-024) |
| POST | `/driver/access-packages/{id}/purchase` | `{ "paymentMethodId": "…" }` (+ `Idempotency-Key`) | `{ "subscription": { "packageId": "daily", "startsAt": "…", "expiresAt": "…" }, "payment": { "status": "succeeded" \| "pending", "processingFeeKobo": 0 } }`. Returns the pending payment only; the pass is recorded by the payment verification job and queued per BR-062 (D-058). How drivers pay, renewal, grace, refunds, VAT → Q-043 |
| GET | `/driver/access` | — | **Replaced by** `GET /v1/drivers/{driverId}/subscription` (D-058). |
| GET | `/drivers/{driverId}/subscription` | — | `SubscriptionTimelineResponse` (`packages/core/src/subscriptions`), the same body for the Driver App (`me`) and the admin: `{ driverId, asOf, version, access: { active, canAcceptRides, currentPassId, currentPlan, activeUntil, currentPassEndsAt }, passes: [{ id, plan, amount, paymentRef, confirmedAt, startsAt, endsAt, accessEndsAt, status: active\|scheduled\|expired\|cancelled\|refunded\|reversed, voidReason? }] (newest first), summary: { active, scheduled, expired, voided, nextStartsAt, lastEndedAt } }`. Times are epoch ms (ISO in the wire format). Clients never calculate validity. |
| POST | `/admin/drivers/{driverId}/subscription/passes/{paymentRef}/void` | `{ kind: cancelled\|refunded\|reversed, reason }` (+ `Idempotency-Key`; permission `refunds.approve`) | Updated `SubscriptionTimelineResponse`. Audited. The pass stays in history (BR-139). |
| POST | `/driver/location` | batch, see below | `204` |
| POST | `/driver/requests/{requestId}/accept` | `{}` (Quick Match) | `200` assigned or `409 REQUEST_TAKEN` |
| POST | `/driver/requests/{requestId}/decline` | `{ "reasonCode": "too_far" }` | `204` |
| POST | `/driver/offers/{offerId}/responses` | `{ "kind": "counter", "amountKobo": 400000 }` | `DriverResponse` (`live`, `expiresAt`); replaces own previous live response; `422 COUNTER_OUT_OF_RANGE`, `409 OFFER_EXPIRED` |
| DELETE | `/driver/offers/{offerId}/responses/{id}` | — | Withdraw own response |
| POST | `/driver/trips/{bookingId}/phase` | `{ "phase": "arrived" \| "passenger_confirmed" \| "in_progress" \| "completed", "location": LatLng, "pin": null }` | Booking; `409 INVALID_TRANSITION` |
| POST | `/driver/trips/{bookingId}/cash-received` | `{ "amountKobo": 400000 }` | Payment `paid`. **Only if cash is approved** (Q-001; cash disabled at launch, D-023) |
| POST | `/driver/trips/{bookingId}/cancel` | `{ "reasonCode": "rider_no_show" }` | Booking |
| GET | `/driver/earnings?from=&to=` | — | `{ "grossKobo", "commissionKobo", "netKobo", "estimatedKobo", "trips", "accessPackagesKobo" }` — `commissionKobo` is `0` (D-024); `accessPackagesKobo` = packages bought in the period, shown separately |
| GET/POST | `/driver/payout-account` | `{ "bankCode": "058", "accountNumber": "0123456789" }` | `{ "accountName": "EMEKA OKAFOR", "last4": "6789", "verified": true }` |
| GET | `/driver/payouts?cursor=` · POST `/driver/payouts` | `{ "amountKobo": 2500000 }` | Payout `processing` |

Location ping (batched, throttled; frequency TBD with backend):
```json
{ "points": [
  { "latitude": 6.6018, "longitude": 3.3515, "accuracyMeters": 12, "headingDegrees": 84, "speedMps": 8.3, "recordedAt": "2026-10-21T14:06:02Z" }
], "bookingId": "bkg_124" }
```

**Location ingestion per D-026 (PROPOSED, 2026-10-21):**
- Accepted only while the driver is online (`available`, `to_pickup`, `on_trip`); pings while offline with no active trip → `409 NOT_ONLINE` and are discarded.
- Cadence by activity (placeholders mirroring `UPDATE_PROFILES`, Q-045): `available` 15 s / 50 m, stale after 60 s; `to_pickup` 5 s / 15 m, stale 20 s; `on_trip` 5 s / 20 m, stale 20 s. The server returns the profile in `/driver/availability` and on `trip.phase_changed` so it can be tuned without an app release.
- **Stale detection:** the server marks a driver `stale` when the newest `recordedAt` is older than the profile's `staleAfterMs`, or `accuracyMeters` > 100 (placeholder). Stale, interrupted, approximate-only or permission-lost drivers are **excluded from new matching** (an active trip continues; the rider sees "last updated …" rather than a frozen marker).
- Client reports tracking changes: `POST /driver/tracking-status` `{ "permission": "when_in_use_approximate", "issues": ["approximate_only"], "at": "…" }` → `{ "matchingPaused": true }`. The server sends `driver.matching_paused` / `driver.matching_resumed` (§9).
- Points carry device `recordedAt`; out-of-order or duplicate points are dropped by `recordedAt`.

---

## 7. Payments & wallet (rider)

> **Revised 2026-10-21 (D-023, D-024; PROPOSED).** Launch methods are **GoBye Wallet** and **bank transfer**; cash disabled (open, Q-001); **cards removed** (the former `/payment-methods/cards/*` endpoints and `switch-to-cash` are withdrawn). Provider, virtual-account mechanism and real fees are open (Q-042).

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/payments/config` | — | `{ "enabledMethods": { "wallet": true, "bank_transfer": true, "cash": false }, "processingFees": { "bank_transfer": { "fixedKobo": 5000, "percent": 0, "capKobo": null, "bearer": "passenger" }, … } }` — server-computed, values placeholders |
| GET | `/payment-methods` | — | `{ "items": [{ "id": "pm_wallet", "type": "wallet", "label": "GoBye Wallet" }, { "id": "pm_bank_transfer", "type": "bank_transfer", "label": "Bank transfer" }], "defaultId": "pm_wallet" }` |
| POST | `/bookings/{id}/charge` | `{ "paymentMethodId": "pm_wallet", "attempt": 1 }` + `Idempotency-Key: bkg_124-1` | Wallet debit: `{ "paymentId": "pay_1", "status": "succeeded" \| "failed", "failureCode": "INSUFFICIENT_WALLET_BALANCE", "fareKobo", "processingFeeKobo", "totalKobo" }` |
| POST | `/bookings/{id}/bank-transfer` | `{ "attempt": 1 }` + `Idempotency-Key: bkg_124-1` | Provider virtual account for this payment: `{ "paymentId": "pay_2", "bankName": "…", "accountNumber": "0123456789", "accountName": "GoBye Payments", "amountKobo": 415000, "fareKobo": 410000, "processingFeeKobo": 5000, "expiresAt": "…", "status": "awaiting_transfer" }` |
| POST | `/bookings/{id}/bank-transfer/confirm` | `{ "paymentId": "pay_2", "attempt": 2 }` + `Idempotency-Key: bkg_124-2` | Passenger says "I've sent the transfer" → `{ "status": "checking" \| "succeeded" \| "not_received" }`. This only triggers/expedites a check; **payment is marked paid only on provider confirmation** |
| POST | `/webhooks/payments/{provider}` | provider payload | **Server-to-server.** Verify signature, dedupe by provider reference, match to `paymentId`/virtual account and amount; under/over-payment → support flow (Q-042). Emits `payment.updated` |
| POST | `/bookings/{id}/payment-method` | `{ "paymentMethodId": "pm_wallet" }` | Switch method while `payment_pending` (e.g. "Pay with GoBye Wallet instead"); cancels the open virtual account if unpaid |
| GET | `/wallet` | — | `{ "balanceKobo": 120000, "currency": "NGN" }` |
| GET | `/wallet/transactions?cursor=` | — | `WalletTransaction[]` |
| POST | `/wallet/top-ups` | `{ "amountKobo": 500000 }` | Bank-transfer top-up: virtual-account payload as above; balance credited on webhook |
| GET | `/bookings/{id}/receipt` | — | `TripReceipt` with `fareKobo`, `processingFeeKobo`, `totalPaidKobo` as **separate fields** |
| GET | `/bookings/{id}/refunds` | — | `[{ "id": "rfd_1", "amountKobo": 50000, "status": "succeeded", "createdAt": "…" }]` |

Rules:
- **Fees are computed server-side** and returned as separate fields (`fareKobo`, `processingFeeKobo`, `totalKobo`); the client never computes a charged amount (BR-105). The fare is never changed by the payment method.
- Wallet charges are triggered **server-side** on `completed`; the client endpoint covers retry. Bank transfer moves the booking to `payment_pending` with `awaitingPaymentAction: true` until the passenger confirms or switches method.
- Idempotency key `${bookingId}-${attempt}`; `attempt` increments on each retry/confirm and is persisted client-side (BR-108).
- Refunds are created by admin/support only (US-A-003).

---

## 8. Ratings, support, notifications

| Method | Path | Request | Notes |
|---|---|---|---|
| POST | `/bookings/{id}/rating` | `{ "stars": 2, "comment": "Late", "reasons": ["late_pickup"] }` | `stars < 3` requires `reasons` (BR-111); comment ≤ 300 |
| POST | `/support/tickets` | `{ "topic": "fare_issue", "bookingId": "bkg_124", "message": "…" }` | Ride-linked within 7 days (BR-110) |
| GET | `/support/tickets?cursor=` · GET `/support/tickets/{id}` | — | `{ "id", "status": "open" \| "pending" \| "resolved", "messages": [] }` |
| POST | `/devices` | `{ "pushToken": "…", "platform": "ios", "app": "rider" }` | Register push token (provider Q-014) |
| DELETE | `/devices/{pushToken}` | — | On sign-out |
| GET | `/notifications?cursor=` | — | `AppNotification[]` |
| POST | `/notifications/read` | `{ "ids": ["ntf_1"] }` | `204` |

---

## 9. Realtime (WebSocket)

**Endpoint:** `wss://rt.gobye.app/v1?token=<accessToken>` (or token in first `auth` message). Server pushes; client sends only `subscribe`, `unsubscribe`, `ping`, `ack`.

Envelope:
```json
{ "id": "evt_01J…", "type": "booking.driver_response", "seq": 42, "occurredAt": "2026-10-21T14:06:20Z",
  "bookingId": "bkg_124", "data": { } }
```
- `id` for dedupe, `seq` monotonically increasing per booking/channel (drop older; NFR-REL-008).
- On reconnect, client sends `{ "type": "subscribe", "channel": "booking:bkg_124", "sinceSeq": 41 }`; server replays or replies `resync_required` → client calls `GET /bookings/{id}`.
- Heartbeat every 25 s; client reconnects with exponential backoff (1 s → 30 s, jitter).

### Rider events

| Type | Data | Effect (UI_STATES) |
|---|---|---|
| `booking.searching` | `{ searchExpiresAt }` | — |
| `booking.no_drivers` | `{}` | B10 |
| `booking.driver_response` | `DriverResponse` (`status: live`) | B14 / §4 `RESPONSE_RECEIVED` or `REPLACED` |
| `booking.response_withdrawn` | `{ responseId, reason }` | §4 withdrawn/unavailable |
| `offer.expired` | `{ offerId, round }` | §3 expiry (server-authoritative) |
| `booking.matched` | `{ driver, agreedFareKobo, fareLockedAt, etaSeconds }` | B9 / B15 |
| `trip.phase_changed` | `{ phase: "driver_en_route" \| "driver_arrived" \| "in_progress" \| "completed", at }` | B20–B24 |
| `trip.driver_location` | `{ latitude, longitude, headingDegrees, etaSeconds, recordedAt }` | Marker/ETA |
| `booking.cancelled` | `{ by, reasonCode, feeKobo }` | B26–B29 |
| `booking.rematching` | `{}` | B27 |
| `payment.updated` | `{ paymentId, status: "awaiting_transfer" \| "checking" \| "succeeded" \| "not_received" \| "failed", failureCode, fareKobo, processingFeeKobo, totalKobo }` | B24/B25 and bank-transfer states |

### Driver events

| Type | Data |
|---|---|
| `driver.request` | `{ requestId, mode: "quick_match", pickup, destination, distanceMeters, etaToPickupSeconds, fareKobo, estimatedEarningsKobo, expiresAt }` |
| `driver.negotiation_offer` | `{ offerId, bookingId, offerKobo, suggestedKobo, rangeMaxKobo, stepKobo, pickup, destination, expiresAt }` |
| `driver.request_closed` | `{ requestId \| offerId, reason: "taken" \| "expired" \| "cancelled" \| "other_selected" }` |
| `driver.response_expired` | `{ responseId }` |
| `driver.assigned` | `{ bookingId, passenger: { firstName, rating }, pickup, destination, agreedFareKobo }` |
| `trip.phase_changed` | as rider |
| `booking.cancelled` | `{ by: "passenger", feeKobo }` |
| `payment.updated` | `{ bookingId, status }` |
| `driver.availability_forced` | `{ state: "offline", reason: "document_expired" \| "suspended" \| "access_expired" }` |
| `driver.matching_paused` / `driver.matching_resumed` | `{ issues: ["stale_position" \| "approximate_only" \| "permission_missing" \| "session_interrupted" \| "low_accuracy"] }` (D-026) |
| `driver.access_expiring` | `{ expiresAt }` (reminder before package expiry; timing Q-043) |
| `driver.verification_changed` | `{ verification, rejectionReason }` |

---

## 10. Implemented in Phase 1 (`apps/api`, D-059)

These endpoints exist and are covered by automated tests (`apps/api/test`). They run behind the gateway; nothing is deployed yet. Conventions are in `BACKEND_ARCHITECTURE.md` §12.

| Method | Path | Auth | Request | Response `data` | Errors |
|---|---|---|---|---|---|
| GET | `/health/live` | none (no gateway signature needed) | — | (raw) `{ status: "ok", version }` | — |
| GET | `/health/ready` | none | — | (raw) `{ status: "ok" \| "degraded" \| "unavailable", version }`; 503 when unavailable (database down or schema behind) | — |
| GET | `/v1/ops/health` | staff `logs.view` + MFA | — | `{ status, version, checks: { database, schema, auth_keys }, timingsMs, environment }` | 401, 403 `MFA_REQUIRED` / `forbidden` |
| GET | `/v1/me` | any valid session | — | `{ userId, signupComplete, status, rider, driver: { city, verification } \| null, staff: { roles, cities, status, mfaRequired, permissions[] } \| null, session: { aal } }` | 401 `unauthenticated` / `TOKEN_EXPIRED`, 403 `ACCOUNT_SUSPENDED` |
| GET | `/v1/drivers/{driverId}/subscription` | the driver themself, or staff `drivers.view` + MFA within their cities | path `driverId` (UUID) | `SubscriptionTimelineResponse` (D-058, `packages/core/src/subscriptions`) | 404 when not yours and no permission; 403 outside city scope; 422 bad id |
| POST | `/v1/costs/expenses` | staff `costs.manage` + MFA | Headers: `Idempotency-Key`. Body (strict): `{ vendorId, description, amountKobo (int > 0), month "YYYY-MM", incurredAt ISO-8601 with offset, recurring?, original?: { currency: "USD", cents, fxRate }, note? }` | `201 { id, vendorId, category, description, amountKobo, month, status: "pending_approval", recurring, incurredAt, createdAt }`; a replay returns the same body with `idempotent-replayed: true` | 422 `validation_failed` (`details` per field, missing key), 409 `idempotency_conflict`, 403 |
| GET | `/v1/costs/expenses?month=YYYY-MM` | staff `costs.view` + MFA | — | `{ items: Expense[] }` | 422, 403 |
| GET | `/v1/costs/break-even?month=YYYY-MM` | staff `costs.view` + MFA | — | `{ month, operatingCost, subscriptionRevenue, coverage, gap, monthlyPassesNeeded, dailyPassesNeeded, passesSold, excluded: { marketingCostKobo, pendingApprovalKobo }, rules }` (all money in kobo; marketing and unapproved costs excluded; refunded or reversed passes excluded; months in Lagos time) | 422, 403 |

**WhatsApp quick booking (D-064, `WHATSAPP_BOOKING.md`); 404 unless `WHATSAPP_PROVIDER` is set:**

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/v1/webhooks/whatsapp` | Meta's subscription check: `hub.mode=subscribe`, `hub.verify_token` = ours | query `hub.challenge` | (raw, text/plain) the challenge | 403 |
| POST | `/v1/webhooks/whatsapp` | `X-Hub-Signature-256` = HMAC-SHA256(app secret, exact body) | Meta `whatsapp_business_account` messages webhook | `{ received, queued }` (duplicates are not queued again) | 401 bad signature |

Not exposed over HTTP on purpose: recording verified pass payments and voids (`apps/api/src/subscriptions/subscriptions.repository.ts`). The payment verification job will call it once a provider is connected; clients and webhooks never can.

