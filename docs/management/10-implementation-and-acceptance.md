# 10 · Implementation and acceptance

**Status:** Draft plan, 2026-10-21. PROPOSED. The backend does not exist. The management prototype (`apps/admin`) and the shared model (`packages/core/src/platform`) run on deterministic test data with simulated latency. Nothing has been tested on real devices, and nothing has been tested against real providers.
**Read with:** [README.md](README.md) · [01-foundation.md](01-foundation.md) · [02-oversight.md](02-oversight.md) · [03-operations.md](03-operations.md) · [04-configuration.md](04-configuration.md) · [05-care-safety.md](05-care-safety.md) · [06-finance.md](06-finance.md) · [07-payments-and-integrations.md](07-payments-and-integrations.md) · [08-growth.md](08-growth.md) · [09-connections.md](09-connections.md). App side plans: `docs/IMPLEMENTATION_PLAN.md`, `docs/BACKEND_HANDOVER.md`, `docs/API_CONTRACTS.md`.

---

## Part 1 · Implementation phases

The order is the owner's (brief §11). The **developer workspace is built alongside each phase's integrations**, not at the end: every phase that connects a provider also delivers that provider's `/developer` record, health checks and event history.

"Prototype covers" lists what exists today as screens on test data and pure logic; it is a frontend reference, not a working feature. All prototype pages are being built concurrently against this specification; where a page and this spec differ, the spec wins.

### Phase 1 · Foundation

| Item | Detail |
|---|---|
| Deliverable | Staff access, permissions, shared design system, navigation, audit records |
| Scope | Staff sign in (strong authentication for staff), invitations, roles as permission groups (`StaffRole`, `ROLE_PERMISSIONS`, union of roles), city scope, role homepages (`ROLE_HOME`), approval engine (`APPROVAL_RULES`, `canDecide`, never self approval), append only audit log, shared record panels, admin API conventions, white/black/grey design system with status colours paired with labels |
| Depends on | Authentication and database choices; hosting; secrets storage |
| Prototype covers | Routes `/staff`, `/audit`, `/approvals`, `/overview` shell; `nav.tsx` (permission filtered navigation, badges); `src/data/session.tsx` (`can`, scope), `src/data/records.tsx` (`RecordLink`); `permissions.ts`, `approvals.ts`, `AuditEvent` type; unit tests in `packages/core/src/__tests__/platform.test.ts` and `apps/admin/src/workspaces/{staff,audit,approvals}/logic.test.ts` |
| Backend work | Staff identity and sessions; server side permission checks on every command and query (the UI hiding a button is not security); approval service; audit store with request id; outbox and event dispatcher ([09-connections.md](09-connections.md) §3) |
| Developer workspace in this phase | `/developer` records for Authentication, Database (read only health, migration version), Monitoring, Background jobs; `/developer/events` skeleton |
| Exit criteria | Acceptance journeys J-01 and J-10 pass against the backend in a test environment |

### Phase 2 · Core operations

| Item | Detail |
|---|---|
| Deliverable | Passengers, drivers, verification, trips, cities and configuration |
| Scope | Passenger and driver records, restrictions, driver verification (`VERIFICATION_FLOW`), documents with expiry, trips with timeline, live operations, service areas, vehicle categories, fare settings, cancellation rules, versioned and effective dated configuration (`ConfigVersion`, `versionInForce`) |
| Depends on | Phase 1; file storage for documents; maps proposal (D-025) for live operations |
| Prototype covers | `/passengers`, `/drivers`, `/trips`, `/live`, `/config/areas`, `/config/categories`, `/config/fares`; `workflows.ts` `VERIFICATION_FLOW`, `versionInForce`; rider app booking flow on mocks (`booking/machine.ts`) |
| Backend work | Booking and trip services per `API_CONTRACTS.md` §4 to §6 and §9; driver onboarding uploads; config service with versions and `config.activate` job; document expiry job |
| Developer workspace | File storage, Maps (keys, restrictions, usage), Push (driver and trip updates) |
| Exit criteria | J-02, J-08 (document part), J-09 pass in test environment |

### Phase 3 · Financial foundation

| Item | Detail |
|---|---|
| Deliverable | Ledger, collections, wallet funding, trip payments, receipts |
| Scope | Append only double entry ledger ([06-finance.md](06-finance.md) Part 1), collection records, wallet funding flow (a), trip payment flow (b) with wallet and bank transfer through a GoBye collection account, direct to driver record (d), receipts, payment provider adapter (test environment), signed webhook processing with duplicate handling, server side verification |
| Depends on | Phase 1 and 2; payment provider chosen (Q-042); legal entity and wallet regulatory answer (Q-009, Q-032) |
| Prototype covers | `/finance/collections`, `/finance/wallets`, `/finance/ledger`, `/payments`; `ledger.ts` (`postJournal`, `creditWalletFunding`, `chargeTripFromWallet`, `reverseJournal`), `COLLECTION_FLOW`; rider R22 wallet, R29 trip complete, R14 payment successful, R29b summary, R15 receipt on mocks with `PAYMENT_TIMEOUT_MS` and idempotency key `${bookingId}-${attempt}` |
| Backend work | Ledger tables with unique (`reference`, `kind`), transactional balance checks, `/wallet/top-ups`, `/bookings/{id}/charge`, `/bookings/{id}/bank-transfer`, webhook endpoint, `payments.verify-pending`, `collections.expire` |
| Developer workspace | Payments test record with checks (API key valid, webhook reachable, signature verified, test charge verified server side); `/developer/events` with provider events, duplicates and failures |
| Exit criteria | J-03, J-04, J-05 pass against the provider **test** environment |

### Phase 4 · Driver money flows

| Item | Detail |
|---|---|
| Deliverable | Packages, renewal, earnings, withdrawals, reconciliation |
| Scope | Access package catalogue and purchase (D-024), renewal and expiry, earnings views, withdrawals flow (c) with review threshold, payouts through the provider, settlements import, reconciliation exceptions, financial reports separating trip value, revenue, wallet deposits and driver earnings |
| Depends on | Phase 3; driver app D09, D14, D15 (planned, Phase 4 of `IMPLEMENTATION_PLAN.md`); payout answers (Q-031, Q-043) |
| Prototype covers | `/config/packages`, `/finance/earnings`, `/finance/withdrawals`, `/finance/settlements`, `/finance/reconciliation`, `/reports`; `reserveWithdrawal`, `settleWithdrawal`, `releaseWithdrawal`, `WITHDRAWAL_FLOW`, `needsApproval('withdrawal')`. Driver app: placeholder only (`apps/driver/src/app/index.tsx`) |
| Backend work | `/driver/access-packages/*`, `/driver/payout-account` (name enquiry), `/driver/payouts`, `withdrawals.submit`, `withdrawals.status-poll`, `access.expiry`, `settlements.import`, `reconciliation.daily` |
| Developer workspace | Payout capability checks (test transfer to test account), settlement import job health, reconciliation job health |
| Exit criteria | J-06, J-07, J-08 (pass part) pass in test environment |

### Phase 5 · Service operations

| Item | Detail |
|---|---|
| Deliverable | Support, safety, escalation and controlled refunds |
| Scope | Case workspace ([05-care-safety.md](05-care-safety.md) Module A), safety queue and in app alert (Module B), escalation timers, access logging, refunds with approval and execution |
| Depends on | Phase 1 to 3; push and SMS for responder notifications; safety rota decision |
| Prototype covers | `/cases`, `/safety`, `/finance/refunds`; `CASE_FLOW`, `REFUND_FLOW`, `APPROVAL_RULES.refund`; rider R26 support (simulated), R25 safety (dialler only, BR-120) |
| Backend work | Support ticket API (`API_CONTRACTS.md` §8) mapped to cases, attachments, `RaiseSafetyAlert`, `safety.escalation-timer`, `refunds.execute` |
| Developer workspace | Responder notification delivery tracking; attachment storage rules; email for case replies |
| Exit criteria | J-11, J-12 pass in test environment |

### Phase 6 · Growth tools

| Item | Detail |
|---|---|
| Deliverable | Announcements, promotions, referrals, events and delivery reporting ([08-growth.md](08-growth.md)) |
| Depends on | Phase 1 and 2; email, SMS and push integrations at least `tested` |
| Prototype covers | `/comms`, `/promos`, `/events`, `/config/referrals`; `ANNOUNCEMENT_FLOW`, `CAMPAIGN_FLOW`; rider Home and Wallet promo carousel and R24 referrals on mock config |
| Backend work | Audience queries, fan out jobs, retry queue, campaign scheduler, referral qualification on first paid trip, promotions spend journals |
| Developer workspace | Email (sender identity, templates, delivery events), SMS (sender ID, delivery, usage), Push (delivery attempts) |
| Exit criteria | J-13 passes in test environment |

### Phase 7 · Technical operations

| Item | Detail |
|---|---|
| Deliverable | Integration health, queues, monitoring, recovery and release checks |
| Scope | Complete the inventory ([07-payments-and-integrations.md](07-payments-and-integrations.md) Part 2) with owners and health checks, queue dashboards and dead letters, alert routing, backup and restore drills, provider switch rehearsal, live activation of payments after owner approval, release checklist |
| Depends on | All previous phases |
| Prototype covers | `/developer`, `/developer/events`, `/payments`; `CONNECTION_FLOW`, `canGoLive` |
| Backend work | Health check job, credential rotation flow, monitoring wiring, runbooks |
| Exit criteria | Every journey in Part 2 passes in test; payment journeys repeated with the live provider using small real amounts after owner approval; device test matrix run (`DEVICE_TEST_MATRIX.md`) |

---

## Part 2 · Pre launch verification plan

Each journey runs across the dashboard and both apps, in the test environment first, then (for payments) live with small amounts after owner approval. Evidence is stored with the release record. Surfaces: **Rider**, **Driver**, **Admin**, **Provider** (provider dashboard or test tools), **Logs** (`/developer/events`, server logs).

| ID | Journey | Setup | Steps | Expected in each surface | Evidence |
|---|---|---|---|---|---|
| J-01 | Permission restrictions | Staff A care only; B finance only; C care + finance; D auditor; E operations Lagos only | Each signs in and opens every route by link; C requests a refund then tries to approve it; E opens an Abuja trip by link | Admin: sidebar shows only permitted items; direct links refused with "You don’t have access to this page."; C cannot approve own request; E refused out of scope; D sees no action anywhere and no safety pages. Server: same refusals (403) when the UI is bypassed with API calls | Screen recordings per role, API responses for bypass attempts, audit entries |
| J-02 | Driver approval to first request | Applicant with documents | Onboarding approves; driver buys daily package; goes online | Driver: Approved, then "Buy access", then online. Admin: `/drivers` badge down, `/live` availability up, audit. Rider: driver matchable | Screenshots each surface, events log |
| J-03 | Wallet funding, normal and duplicate callback | Passenger with ₦0 | Add ₦5,000; provider sends success; replay the same webhook twice from provider tools | Rider: Pending then ₦5,000 once, one notification. Admin: collection `successful` with two duplicate events; one `wallet_funding` journal. Logs: two `duplicate` rows | Ledger export for the passenger, event log rows, notification log |
| J-04 | Interrupted payment (wallet) | Passenger ₦10,000; trip ₦4,100 | Complete trip; tap Pay; cut network before response; reopen app; Check again | Rider: "Paying" then after 25 s "Payment not confirmed yet"; after Check again, Payment successful once. Admin: one `trip_charge` journal (`trip:{id}`), trip `paid`. Driver: earnings +₦4,100 once | Rider recording, ledger query by reference, API logs with attempt keys |
| J-05 | Bank transfer, not received then received; late transfer after wallet | Trip ₦3,000 | Choose transfer; tap I’ve transferred before sending; then send; separately: switch to wallet and pay, then transfer arrives | Rider: "Transfer not received yet" (pending, not failed), then success after provider event. Late transfer: credited to wallet as overpayment, finance flagged. Admin: collection, journals, reconciliation exception | Recordings, collection timeline, reconciliation entry |
| J-06 | Withdrawal success and failed payout | Driver with ₦30,000 available, verified bank | Request ₦20,000; provider success. Request ₦5,000 to an account set to fail at the provider | Driver: available drops at request; "Sent to your bank" while processing; then paid, or "Withdrawal failed. ₦5,000 is back in your earnings." Admin: statuses `processing` → `successful` / `failed`; reserve, payout and release journals | Withdrawal histories, journals, driver notifications |
| J-07 | Payout reversal and review threshold | Driver ₦200,000 | Request ₦150,000; finance reviews and approves (different person); provider success then reversal | Admin: `under_review` with approval; `processing`; `successful`; `reversed` with reversal journal. Driver: earnings restored with message | Approval record, journals, event log showing separate success and reversal events |
| J-08 | Expired passes and documents | Driver with daily access expiring in 2 min; another with insurance expiring | Wait for expiry while idle; another while on a trip | Driver: forced offline when idle with reason; on trip, trip finishes then offline. Admin: driver access shows expired; `/drivers` expiry filter. Matching refuses expired drivers even if the job is paused | Event log `driver.availability_forced`, matching refusal logs |
| J-09 | Config takes effect without changing existing bookings | Fares v2 active; v3 scheduled in 10 min | Book a trip before effect; book another after | First trip keeps v2 fare and version id; second uses v3. Admin shows "In force since" | Quote records with version ids |
| J-10 | Notification failures | SMS provider disabled in test; push credentials invalid for one device | Publish an announcement to inbox, push and SMS; complete a trip | Rider: inbox item present; Admin: announcement `partly_failed`, retry queue lists SMS and push failures; Logs: failures; no screen claims "sent" for failed channels | Delivery counters, retry queue screenshot |
| J-11 | Support case with refund | Passenger with a paid trip | Passenger opens case from R18; care replies, requests ₦1,500 refund; finance approves; refund executes | Rider: support conversation, refund in wallet, inbox. Admin: case timeline, approval, refund `completed`, journal. Internal notes absent from app API | API response capture for the app, case export |
| J-12 | Safety alert | Passenger in an active trip | Send safety alert; do not acknowledge for 2 min; then acknowledge; reveal location | Rider: "Safety team alerted". Admin: `/safety` urgent case with trip context, automatic escalation at 2 min, location reveal logged; care cannot see the case | Responder notification log, access log, audit |
| J-13 | Campaign and announcement to app | Campaign scheduled; announcement draft | Activate campaign; publish announcement; edit draft afterwards | Rider: carousel shows campaign on Home and Wallet; inbox shows sent version; later edit does not change it | Screenshots, `sentVersion` record |
| J-14 | Integration degraded | Payments live in test conditions | Break webhook secret; send events | Admin: integration `degraded`, overview alert, finance banner. Rider: funding shows pending; nothing shows success until fixed; after fix and retry, processed once | Health check history, event retries |
| J-15 | Provider switch with open items | Provider A with pending collection and processing withdrawal | Activate provider B; let A's events arrive | New payments use B; A's items resolve through A and keep provider A on records | Records before and after, event log |

### What has and has not been tested

| Area | Status |
|---|---|
| Pure logic in `packages/core/src/platform` | Unit tests exist (`packages/core/src/__tests__/platform.test.ts`: permissions, approvals, ledger idempotency and balance checks, withdrawal reserve and release, status tables, dataset consistency). Results are recorded in `docs/TEST_PLAN.md` when run; this document does not claim a result |
| Admin workspace logic | `logic.test.ts` files exist per workspace; same note |
| Rider payment flow | Implemented on mock services (timeout, pending, idempotent wallet debit); not run against any backend |
| Driver app | Not built beyond a placeholder |
| End to end journeys J-01 to J-15 | **Not run.** No backend exists |
| Real devices | **Nothing tested on real devices** for the management flows or payments |
| Real providers | **Nothing tested against real providers**: no payment, payout, email, SMS, push, maps, identity or storage provider is connected; every integration is `prototype`, `configured` or (payments test only, in test data) `tested`, and none is `live` |
| Security | No penetration test; permission enforcement exists only in the frontend prototype |
