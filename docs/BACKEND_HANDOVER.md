# GoBye — Backend Handover

**Audience:** the backend team that will replace GoBye's mock services.
**Status:** Draft, 2026-10-21. No backend exists. The apps run on mock services (`ARCHITECTURE.md` §5). Contracts referenced are **PROPOSED** (`API_CONTRACTS.md`). All numeric policy values are mock placeholders (`BUSINESS_RULES.md`, D-007) — the backend owns the real values.

Guiding rule: **the client displays and validates for UX; the backend decides.** Anything the client computes (fares, ranges, expiry, fees, eligibility) is advisory and must be recomputed and enforced server-side (SECURITY_PRIVACY §10).

---

## 1. Responsibilities summary

| # | Area | Backend owns | Client keeps | Refs |
|---|---|---|---|---|
| 1 | Pricing authority | Rates per city/category, demand multiplier, rounding, quotes, quote TTL, negotiation range | Display, breakdown, local range check for instant feedback | BR-020–023, BR-040 |
| 2 | Matching & eligibility | Dispatch, search radius, timeouts, eligibility (BR-070–073 incl. active access package and healthy precise location), ranking | Searching UI, timeout display | BR-032, BR-070, BR-072, BR-073 |
| 3 | Negotiation enforcement | Offer/response validation, server-side expiry, rounds, single assignment | Stepper clamping, countdowns derived from server `expiresAt` | BR-040–049 |
| 4 | Trip lifecycle | Authoritative booking status, transition validation, fare finalisation | Reducer mirrors server; illegal transitions rejected locally too | UI_STATES §2 |
| 5 | Payments | Provider integration, wallet debits, bank-transfer virtual accounts + webhook confirmation, processing-fee computation, refunds, wallet ledger | Method selection, separate fee display, transfer details/confirm UI, status display | BR-100–108 |
| 6 | Settlement, commission (0%) & driver access packages | Driver earnings (full fare), package catalogue/purchase/expiry, payouts | "Estimated" earnings preview, package purchase UI (not yet built) | BR-060–062, BR-072 |
| 7 | Driver verification / KYC | Document storage, checks, review workflow, expiry | Capture/upload UI, status display | BR-071, SECURITY §7 |
| 8 | Realtime | WebSocket gateway, fan-out, replay | Subscribe, dedupe, reconcile | API_CONTRACTS §9 |
| 9 | Location ingestion & retention | Ingest, throttle, stale detection, pause matching, expose to matched rider only, retention | Collect only while online per D-026 (D-012 rider) | SECURITY §6 |
| 9a | Maps proxy (PROPOSED, D-025) | Places (New) / Routes API calls with server-held keys, field masks, quotas, cost monitoring | `MapService`, map rendering with restricted SDK key | API_CONTRACTS §3.1 |
| 10 | Account deletion | Deletion pipeline, retention exceptions | Request flow (R28/D17), local wipe | SECURITY §9 |
| 11 | Audit logging | Immutable logs for sensitive actions | — | §11 |
| 12 | Rate limits & abuse | OTP and API limits, fraud | Respect `429` + `retryAfterSeconds` | §12 |

---

## 2. Pricing authority

- Compute quotes server-side per BR-020 with configurable rates per **city × category** (admin-editable, US-A-002). Return `breakdown`, `suggestedKobo`, `negotiationRange {minKobo,maxKobo,stepKobo}`, `expiresAt`.
- Quote is bound to `(pickup, destination, category, routeId, riderId)`; booking creation accepts only a valid, unexpired `quoteId` (`409 QUOTE_EXPIRED`).
- Any multiplier > 1.0 must be in the quote so the client can disclose it (BR-021). Surge policy itself is open (Q-006).
- Lock fare at booking submission (`fareLockedAt`); config changes never alter locked fares (BR-031).
- Route-change re-pricing during a trip is a backend rule (BR-091, Q-005).
- Recommend versioning `PricingConfig` and storing the config version on each quote for disputes.

## 3. Matching & eligibility

- Eligibility (BR-070): `approved`, documents valid (BR-071), online, not on an active trip, category match, within search radius, rating ≥ threshold. Values are mock (Q-022, Q-023, Q-038).
- Quick Match: dispatch to eligible drivers (sequential or broadcast — design choice), first valid accept wins; search timeout → `no_drivers` (BR-032).
- Negotiation: broadcast offer to eligible drivers; drivers respond via `/driver/offers/{id}/responses`.
- Driver cancellation after acceptance: record for reliability (BR-082); rematch policy open (Q-030).
- **Access packages (D-024, BR-072):** matching must **reject drivers without an active access package**; `/driver/availability` returns `403 NO_ACTIVE_ACCESS`. On expiry while online and idle, force offline (`driver.availability_forced`, reason `access_expired`); behaviour mid-trip is open (Q-043; client assumption: trip finishes, no new requests).
- **Location health (D-026, BR-073):** exclude drivers whose location is stale, interrupted, approximate-only, permission-lost or less accurate than the dispatch threshold (placeholder 100 m); emit `driver.matching_paused` / `driver.matching_resumed`.

## 4. Negotiation enforcement

| Concern | Requirement |
|---|---|
| Range validation | Offer: `minKobo ≤ amount ≤ maxKobo`, on `stepKobo` (BR-040/041). Counter: `offer ≤ amount ≤ maxKobo` (BR-043). Reject with `422`. |
| Raise only | New offer amount > current open/last offer (BR-048); `409 OFFER_LOWERED`. |
| Rounds | `round ≤ maxRounds` (BR-049); `409 MAX_ROUNDS_REACHED`. Whether a raise after expiry counts as a round: Q-020. |
| Server-side expiry | Offer and response `expiresAt` set by server clock; expiry enforced on every write (select after expiry → `409 RESPONSE_EXPIRED`) and emitted as `offer.expired` / `driver.response_expired`. Never trust client time. |
| One live response per driver | Upsert keyed by `(offerId, driverId)`; previous → `withdrawn` (BR-045). |
| Single assignment (race handling) | `select` must atomically: verify response `live` and unexpired, verify driver not assigned to another active booking, set booking `matched`, set driver `on_trip`, withdraw other responses. Use a transaction with row lock on the driver (e.g. `SELECT … FOR UPDATE`) or a unique partial index `UNIQUE(driver_id) WHERE status IN (active statuses)`; loser gets `409 DRIVER_UNAVAILABLE` (BR-047). Same pattern for Quick Match accept (`409 REQUEST_TAKEN`). |
| Idempotency | `Idempotency-Key` on create/raise/select/cancel; replay returns original outcome. |
| Response selectable after offer expiry | Client assumption: yes until response `expiresAt` (Q-029). Confirm. |

## 5. Payments

> **Revised 2026-10-21 (D-023, D-024) — PROPOSED.** Launch methods: **GoBye Wallet** and **bank transfer**. Cash open (Q-001), disabled. **Cards not in scope** — the earlier card requirements (provider-hosted card entry, `brand`/`last4`) are withdrawn.

- **Provider choice open (Q-042).** Examples suitable for Nigeria: **Paystack**, **Flutterwave**, **Monnify** (illustrative, not a decision). Requirements regardless of provider:
  - **Wallet debit:** server-side on trip completion from a double-entry ledger in kobo; reject if balance < fare + passenger-borne fee (`402 INSUFFICIENT_WALLET_BALANCE`, BR-106). Also validate at booking creation and at Negotiate selection.
  - **Bank transfer:** issue a provider **virtual account** (per payment or per passenger — Q-042) with the exact amount and an expiry; the passenger's "I've sent the transfer" only triggers a check. **Payment is confirmed only by the provider webhook** (or provider status query), never by the client tap (BR-107). Handle under/over-payment and late transfers after the passenger switched to wallet (refund/credit — Q-042).
  - **Processing fees computed server-side** per method (`fixed`, `percent`, `cap`, `bearer`) and returned as separate fields `fareKobo`, `processingFeeKobo`, `totalKobo` on quotes/bookings/receipts (BR-105). The ₦50 bank-transfer fee in the mock is a **placeholder**.
  - Idempotency key **`${bookingId}-${attempt}`** per charge/confirmation attempt; the client persists `paymentAttempts` so retries after restart reuse keys correctly (BR-108).
  - **Webhooks** are the source of truth: verify signature, dedupe by provider event ID, process idempotently, update payment and emit `payment.updated`.
  - Failed/unconfirmed payment → booking `payment_pending` (BR-103); support retry ("Check again"), method switch (`POST /bookings/{id}/payment-method`).
  - Refunds and fee waivers via admin (US-A-003) with audit log.
  - Wallet top-ups by bank transfer (virtual account, credited on webhook); regulatory status of a stored-value wallet is a legal question (Q-032).
  - **No Apple IAP** for rides, wallet top-ups or driver packages (BR-101).
- Cancellation fees (BR-080/081): compute server-side; expose `GET /cancellation-preview`; only charge if the client acknowledged that exact fee.

## 6. Settlement, commission & driver access packages

- **Commission is 0% per trip** (D-024, Q-002 resolved 2026-10-21). Still store the rate (0) on each booking at lock time so a future change is auditable.
- Earnings = full fare (BR-060); passenger-borne processing fees are not driver earnings. Mark trip "settled" when payment final → client stops showing "Estimated" (BR-061).
- *(Superseded: cash-trip commission netting, Q-034 — no commission; cash itself is open.)*
- **Driver access packages (PROPOSED):** server-configurable catalogue (`GET /driver/access-packages`; provisional Daily ₦2,000 / 1 day, Monthly ₦60,000 / 30 days), purchase (`POST /driver/access-packages/{id}/purchase`, idempotent), status/expiry (`GET /driver/access`). Purchase while active extends from current expiry (mock behaviour). Payment method for packages, renewal, grace period, refunds/pro-rating and VAT → Q-043. Audit-log package price changes.
- Payouts: bank account verification (name enquiry), schedule/minimums (Q-031), payout via provider transfers API, status webhooks, failed payout handling.

## 7. Driver verification / KYC

- Steps: personal, licence, identity, vehicle, vehicle documents (D03–D07). Upload via pre-signed short-lived URLs; encrypted at rest; reviewer-only access; every access audit-logged (SECURITY §7).
- Identity/licence checks: manual review and/or KYC vendor (vendor open). Nigerian ID types accepted (NIN, driver's licence, etc.) — legal/ops to confirm (Q-009).
- Track document `expiresAt`; on expiry force offline and set re-verification (BR-071; Q-041).
- Rejections require a reason code + human-readable reason surfaced on D08.

## 8. Realtime infrastructure

- WebSocket gateway (TLS) with auth on connect, per-booking and per-driver channels, `seq` per channel, replay window (proposed ≥ 5 min) for `sinceSeq` resubscribe, heartbeats.
- Push notifications as fallback when the app is backgrounded (driver requests, matched, arrived, payment failed). Provider open (Q-014).
- Event catalogue: `API_CONTRACTS.md` §9.

## 9. Location ingestion & retention

- Driver pings only while online (client stops when offline with no active trip — D-026). Batch endpoint; server throttles and rejects out-of-order/implausible points.
- **Per D-026 (PROPOSED):** cadence by activity (placeholders `available` 15 s/50 m, stale 60 s; `to_pickup` 5 s/15 m, stale 20 s; `on_trip` 5 s/20 m, stale 20 s; tune via Q-045 — serve the profile from the server); stale detection from newest `recordedAt`; accuracy threshold for dispatch (placeholder 100 m); **pause new matching** when stale/interrupted/approximate/permission lost and notify the driver; active trips continue. Details: `API_CONTRACTS.md` §6.

### 9.1 Maps (PROPOSED, D-025)

- Recommended: Places API (New) and Routes API called **server-side** (keys never in the app); app holds only a Maps SDK key restricted by platform (bundle ID / package + SHA-1) and API.
- Use **field masks** on every Places/Routes call; Places autocomplete with session tokens; Routes `computeRoutes` with `TRAFFIC_AWARE` routing for distance/ETA used in quotes and driver ETA.
- Quotas, budget alerts and a cost projection are required before accepting the provider (Q-044).
- Validation plan (Abuja + Lagos pickup accuracy, ETA vs observed): `API_CONTRACTS.md` §3.1 and `DEVICE_TEST_MATRIX.md`.
- Expose driver location only to the rider of the matched booking, from `matched` until `completed` (FR-MAP-010).
- Rider location: pickup selection only (foreground); no continuous rider tracking.
- Retention: raw pings vs trip summaries — periods undecided (Q-016, SECURITY §6). Reduce raw traces to summaries as early as legal/dispute needs allow.

## 10. Account deletion pipeline

1. `DELETE /me` → validate blockers (active booking, outstanding balance, pending payout).
2. Revoke all tokens and push registrations; remove from matching.
3. Delete or irreversibly anonymise personal data across DB, object storage, search indexes, analytics, logs and processors (provider customer records).
4. Retain only records with a legal basis (completed trips/payments, safety incidents, verification records) for defined periods (Q-016, Q-017), then delete.
5. Confirm completion (email/SMS optional) and record an audit entry without PII.

## 11. Audit logging

Log (append-only, no PII in free text): admin verification decisions, document access, pricing config changes, refunds/fee waivers, manual fare adjustments, account suspensions, deletion requests/completions, payout account changes. Include actor, action, target ID, timestamp, request ID.

## 12. Rate limits & fraud

| Area | Proposal (values TBD) |
|---|---|
| OTP request | Per phone, per device, per IP; resend cooldown; daily cap |
| OTP verify | Attempt limit per request; lockout |
| Booking create | One active booking per rider (`ACTIVE_BOOKING_EXISTS`) |
| Offers | Max rounds; min interval between raises |
| Driver responses | Throttle per offer |
| Fraud signals | Device fingerprint reuse, rider–driver collusion (repeat pairs), GPS spoofing (implausible speeds), cancellation abuse, card testing |

## 13. Reviewer / demo support

App Review needs Rider and approved Driver demo accounts, a reviewer OTP honoured server-side for those numbers only, and a way to complete a trip (sandbox city or simulated driver) with the backend live during review (APP_STORE_COMPLIANCE §2, Q-024).

---

## 13a. Demo relay (D-049, not the backend)

The connected demo uses `packages/core/src/relay` and `tools/demo-relay` (docs/DEMO_CONNECTED.md). Its tables show which party writes which field (rider: PIN, chosen driver, payment; driver: claim, position, stages; staff: review, cancellation) and the review model in `driver/verification.ts` (checks, outside-delay reasons, issues, `changes_requested`). Treat it as a reference for flows and copy, not as the API: the backend needs auth, server-side matching, pushed updates and a PIN that never leaves the server.

## 14. Mock service interfaces (current) and how to swap them

From `ARCHITECTURE.md` §5:

```ts
interface GoByeServices {
  auth: AuthService;          // signUp, signIn(email|phone, password), socialSignIn(apple|google), requestPasswordReset, resetPassword, requestOtp(phone), verifyOtp(phone, code), deleteAccount() — D-045
  maps: MapService;           // searchPlaces(q, near), reverseGeocode(coord), getRoute(a, b)
  pricing: PricingService;    // quote(route, category) -> FareQuote
  matching: MatchingService;  // quickMatch(booking) / openNegotiation(offer) -> event stream
  trips: TripService;         // driver location/phase simulation for an assigned trip
  payments: PaymentService;   // listMethods(), charge(bookingId, method) -> result
}
```

| Interface | Mock behaviour | Production mapping (proposed) |
|---|---|---|
| `AuthService` | Any 6-digit code except `000000` | `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `DELETE /me` |
| `MapService` | Fixed landmark list (Lagos + approximate Abuja), simulated routes | `/places/search`, `/places/reverse`, `/routes` (provider behind backend; Google Maps Platform proposed, D-025) |
| `PricingService` | `MOCK_PRICING_CONFIG` calculation | `POST /quotes` |
| `MatchingService` | Simulated drivers/responses via `subscribe(listener)` | `POST /bookings`, offers/select endpoints + WS `booking.*`, `offer.*` |
| `TripService` | Simulated movement & phases | WS `trip.driver_location`, `trip.phase_changed`; `GET /bookings/{id}` |
| `PaymentService` | Configurable failure rate; `charge({ bookingId, method, amount, idempotencyKey })`; bank transfer simulated (demo account, simulated check) | `/payments/config`, `/payment-methods`, `/bookings/{id}/charge`, `/bookings/{id}/bank-transfer[/confirm]`, `/bookings/{id}/payment-method`, wallet |
| *(none yet)* | Driver access packages and location session are pure logic in `@gobye/core` (`payments.ts`, `driver/locationSession.ts`); no service interface | `/driver/access-packages`, `/driver/access`, `/driver/availability`, `/driver/location`, `/driver/tracking-status` |

Swap plan:
1. Implement `createHttpServices(baseUrl)` in `@gobye/core` (or app layer) satisfying the same interfaces; keep `createMockServices()` for tests and demo.
2. Select implementation by build profile (EAS env), never by a user-changeable runtime flag (SECURITY §2).
3. Map REST payloads (ISO strings, `*Kobo` fields) to client types (epoch ms, `Kobo`) in one adapter layer.
4. Map WS events onto the existing `subscribe(listener)` streams; dedupe by `id`, order by `seq`.
5. Map error `code`s to reducer events (`SUBMIT_FAILED`, `SELECT_FAILED`, etc.).
6. Interfaces still missing for full integration (to add): driver availability/requests/trip-phase, driver onboarding/documents, wallet/payouts, ratings, support, notifications/push registration, saved places.

---

## 15. Client assumptions to validate

| # | Assumption in the client | Validate with |
|---|---|---|
| A-01 | Money is integer kobo everywhere; `FareBreakdown` sums to total (a `roundingKobo` component may be added) | Backend |
| A-02 | Quote TTL 5 min; offer 90 s; response 30 s; max 3 rounds; QM search 60 s | Product (Q-020) |
| A-03 | Each raise is a new round and restarts the 90 s timer | Product (Q-020) |
| A-04 | A live response remains selectable after its offer expires, until its own `expiresAt` | Product (Q-029) |
| A-05 | One active booking per rider | Product/Backend |
| A-06 | One pending request per driver at a time | Product/Backend |
| A-07 | Cancellation fee is previewed and acknowledged before charge | Product (Q-021) |
| A-08 | Driver-cancel triggers automatic rematch for Quick Match | Product (Q-030) |
| A-09 | Passenger confirmation at pickup is by name (PIN optional) | Product (Q-010) |
| A-10 | ~~Card entry happens only in provider UI~~ (cards out of scope, D-023). Bank transfer uses provider virtual accounts confirmed by webhook | Backend/Finance (Q-042) |
| A-11 | Charge on completion is server-initiated; client only retries/switches | Backend |
| A-12 | Driver location visible to rider from `matched` to `completed` only | Product/Legal |
| A-13 | Server `expiresAt` values are authoritative; client clock skew tolerated (server returns `serverTime` in responses — proposed) | Backend |
| A-14 | WebSocket replay by `sinceSeq` exists; otherwise client refetches booking | Backend |
| A-15 | Account deletion returns blockers rather than silently failing | Backend/Legal |
| A-16 | Categories may be unavailable per area with a reason code | Product (Q-004) |
| A-17 | Commission rate (0%, D-024) stored per booking; earnings "Estimated" until settled | Finance |
| A-18 | Processing fees returned as separate fields; method never changes the fare | Backend/Finance (Q-042) |
| A-19 | Idempotency key `${bookingId}-${attempt}` for payment attempts | Backend |
| A-20 | Buying an access package while active extends from current expiry; no grace period | Finance (Q-043) |
| A-21 | Server can deliver the location update profile per activity | Backend (Q-045) |
