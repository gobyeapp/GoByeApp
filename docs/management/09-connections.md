# 09 · How the workspaces connect

**Status:** Draft specification, 2026-10-21. PROPOSED. No backend; in the prototype a change made through `act()` updates the in browser test dataset, so connected admin screens update, but **nothing reaches the rider or driver apps**, and no notification or job runs. Effects on the apps below are the target behaviour.
**Read with:** [README.md](README.md) · [01-foundation.md](01-foundation.md) · [02-oversight.md](02-oversight.md) · [03-operations.md](03-operations.md) · [04-configuration.md](04-configuration.md) · [05-care-safety.md](05-care-safety.md) · [06-finance.md](06-finance.md) · [07-payments-and-integrations.md](07-payments-and-integrations.md) · [08-growth.md](08-growth.md).

---

## 1. Shared record ids

- Every record has one id used everywhere: `pas-…` passenger, `drv-…` driver, `trp-…` trip, `cas-…` / `saf-…` case, `col-…` collection, `wdr-…` withdrawal, `ref-…` refund, `jr-…` / `le-…` ledger journal and entry, `apr-…` approval, `cfg-…` config version, `int-…` integration, `ann-…` announcement, campaign id, `evt-…` event partnership. (The public API in `API_CONTRACTS.md` proposes prefixes such as `bkg_`, `drv_`, `pay_`; the backend maps one internal id to one public id, never two records for one thing.)
- Short references for people are separate display fields (`TripRecord.ref` "#K3F9A2", `CaseRecord.ref` "C-2400"); they never replace ids in links.
- In the admin, every link to a passenger, driver or trip uses `RecordLink`, which opens the same shared panel from any workspace. A trip opened from Support is the trip Operations and Finance see.
- Links between records are stored on the records (`CaseRecord.links`, `LedgerEntry.links`, `RefundRecord.tripId/caseId`, `AuditEvent.target`), so every record page can show "Related".

## 2. Access tailoring on the same record

The shared trip panel shows sections by permission, not by workspace:

| Section of the trip panel | Needs |
|---|---|
| Route, status timeline, fare, mode, cancellation | `trips.view` |
| Passenger and driver names, ratings | `passengers.view` / `drivers.view` |
| Phone numbers | `passengers.contact_details` / `drivers.contact_details` |
| Payment state, method, collection, journals | `finance.view` (state and collection), `ledger.view` (journal lines) |
| Cases | `cases.view` (care cases); safety cases appear as "Restricted case" without `safety.view` |
| Live position, safety location | `live.view` for live driver position on `/live`; `safety.location` for alert location |
| Actions (intervene, refund request, restrict) | the action's own permission (`trips.intervene`, `refunds.request`, `*.restrict`) |

City scope (`inCityScope`) applies to every record. The auditor sees every `.view` section except safety.

## 3. Event delivery model (backend need)

1. A command validates permission, transition table and approval rules, then writes records, ledger journals and an **outbox** row in one database transaction.
2. A dispatcher publishes the outbox row as a domain event `{ id, type, occurredAt, actor, target, data }`.
3. Subscribers update read models (admin lists, overview counters), send realtime events to apps (`API_CONTRACTS.md` §9: `payment.updated`, `driver.availability_forced`, etc.), enqueue notifications and jobs.
4. Each subscriber is idempotent by event id. Failures retry with backoff and land in `/developer/events`.
5. Apps reconcile by fetching the record when they reconnect (`resync_required`), so a missed realtime event never leaves a wrong state.

Failure principle: when a dependency is down, the record still changes where the command succeeded, and dependent screens say **pending** or **unavailable** honestly. Nothing shows "done" (paid, sent, live) before it is confirmed.

---

## 4. Triggers

Legend: **Rider** = passenger app screens (R numbers in `SCREEN_INVENTORY.md`); **Driver** = driver app (planned D numbers); **Admin** = management routes.

### 4.1 Driver approved

| Aspect | Detail |
|---|---|
| Source command | `DecideDriverVerification {driverId, to: 'approved'}` by `drivers.verify` from `/drivers` ([03-operations.md](03-operations.md)); `VERIFICATION_FLOW` `in_review → approved` |
| Domain event | `driver.approved` (also `driver.verification_changed`) |
| Records written | `DriverRecord.verification`, documents accepted, audit `driver.approved` |
| Ledger | None |
| Rider | None directly; the driver becomes matchable once eligible |
| Driver | D08 status "Approved"; D09 shows "Buy access to go online" if no active package; eligibility recalculated (approved, documents valid, access active, location healthy, BR-070 to BR-073) |
| Admin | `/drivers` badge decreases; `/live` availability counts; `/overview` active drivers |
| Notifications | Driver push + inbox: "You’re approved. Choose an access package to start driving." |
| Jobs | `drivers.eligibility-recalc`; `documents.expiry-watch` schedules reminders |
| Failure | Push fails → inbox still has it; failure in `/developer/events`. Eligibility job fails → driver stays offline with "Checking your account" rather than going online unchecked |

### 4.2 Package purchased

| Aspect | Detail |
|---|---|
| Source command | Driver `POST /driver/access-packages/{id}/purchase` → `StartPackagePurchase`; confirmed by provider event |
| Domain events | `collection.succeeded` (purpose `package_purchase`) → `package.purchased` → `access.activated` |
| Records written | `CollectionRecord`; `DriverRecord.access {packageId, expiresAt}` (extends from current expiry if active, D-024); package config version id stored on the purchase |
| Ledger | `package_purchase`: company_revenue +P · provider_clearing −P; `processing_fee` if GoBye bears it |
| Rider | None |
| Driver | D09 "Access active until 22 Oct, 20:00"; can go online |
| Admin | `/finance/collections`, `/finance/ledger`, `/reports` revenue (packages, renewals); driver panel access; `/overview` subscription revenue |
| Notifications | Driver: "Daily access active until …"; receipt |
| Jobs | `access.expiry` at `expiresAt`; `access.expiring-reminder` (timing Q-043) |
| Failure | Payment pending → access **not** active, D09 "Payment pending. You can go online when it’s confirmed." Provider down → "Packages can’t be bought right now." |

### 4.3 Vehicle category enabled

| Aspect | Detail |
|---|---|
| Source command | `PublishConfigVersion {key: 'categories'}` (`config.edit` drafts, `config.publish` / owner approval `config_publish`) ([04-configuration.md](04-configuration.md)) |
| Domain events | `config.version_approved`, then `config.version_effective` at `effectiveFrom` → `category.enabled` |
| Records written | `ConfigVersion` status `scheduled → active`, previous `superseded`; audit |
| Ledger | None |
| Rider | R09 Ride options shows the category for eligible areas from the effective time (`ServiceConfig.categories`, D-029); quotes include it |
| Driver | Drivers whose vehicle matches can receive requests for it; D17 vehicle shows the category |
| Admin | `/config/categories`; `/live` filters |
| Notifications | None to users by default; marketing may announce separately (4.4) |
| Jobs | `config.activate` at effective time; app config cache invalidation |
| Failure | Activation job late → old version stays in force (versionInForce); apps keep the cached config and never show a category the server would refuse (`422 CATEGORY_UNAVAILABLE`) |

### 4.4 Announcement published

| Aspect | Detail |
|---|---|
| Source command | `PublishAnnouncement` / `ScheduleAnnouncement` (`comms.publish`; approval `announcement` for all users or any SMS) ([08-growth.md](08-growth.md)) |
| Domain events | `announcement.approved`, `announcement.sending`, `announcement.sent` or `announcement.partly_failed` |
| Records written | `Announcement.sentVersion` snapshot, status, inbox records per recipient, channel jobs, delivery counters |
| Ledger | None |
| Rider / Driver | Inbox (R23 / D17) item; push, email, SMS per selected channel and preferences |
| Admin | `/comms` delivery results; failed deliveries in the retry queue; `/developer/events` |
| Notifications | Is the notification |
| Jobs | `announcements.fanout`, `notifications.send`, `notifications.retry` |
| Failure | Channel provider down → inbox still delivered, channel marked failed, status `partly_failed`, retry queue. Editing the draft later never changes `sentVersion` |

### 4.5 Promo campaign activated

| Aspect | Detail |
|---|---|
| Source command | `ActivateCampaign` (`promos.manage`; approval if required) ([08-growth.md](08-growth.md)); `CAMPAIGN_FLOW` `scheduled → active` |
| Domain event | `campaign.activated` |
| Records written | `PromoCampaign.status`, audit |
| Ledger | None on activation; spend posts `promotions_expense` when rewards are granted |
| Rider | Home (R07) and Wallet (R22) carousel shows it for matching audience, by `sortOrder`, within dates |
| Driver | Only for driver audience campaigns |
| Admin | `/promos` impressions and opens |
| Notifications | None |
| Jobs | `campaigns.schedule` (start, end, budget cap → `ended`) |
| Failure | Feed unavailable → apps show the last cached set or no carousel; never a broken card |

### 4.6 Passenger wallet funded

| Aspect | Detail |
|---|---|
| Source command | `StartWalletFunding` (rider `POST /wallet/top-ups`); completion by verified provider event |
| Domain events | `collection.succeeded` → `wallet.credited` |
| Records written | `CollectionRecord` (`successful`, `verifiedAt`, `events[]`) |
| Ledger | `wallet_funding`: passenger_wallet +A · provider_clearing −A (reference = provider reference) |
| Rider | R22 balance and "Deposit · Completed"; R29 available balance |
| Driver | None |
| Admin | `/finance/collections`, `/finance/wallets`, `/finance/ledger`; `/overview` wallet deposits (not revenue) |
| Notifications | Rider inbox + push "₦5,000 added to your wallet" |
| Jobs | `payments.verify-pending`, `reconciliation.daily` |
| Failure | Webhook late → R22 "Pending" line; duplicate → no second credit; provider down → Add money unavailable ([06-finance.md](06-finance.md) flow a) |

### 4.7 Trip completed and paid

| Aspect | Detail |
|---|---|
| Source command | Driver `POST /driver/trips/{id}/phase {completed}`; then rider `POST /bookings/{id}/charge` or bank transfer confirmation + provider event |
| Domain events | `trip.completed`, `trip.payment_started`, `trip.paid` (or `trip.payment_failed`, `trip.payment_pending`), `earnings.credited` |
| Records written | `TripRecord.status/payment/timeline`, payment attempt, `CollectionRecord` for transfers, receipt |
| Ledger | Wallet: `trip_charge` (`trip:{tripId}`); transfer via GoBye: `driver_trip_earning`; direct to driver: none (`DirectPaymentReport`) |
| Rider | R29 trip complete → R14 payment successful (only when verified) → R29b summary, R16 rating, R15 receipt; R17 Activities status; Home "Payment outstanding" until paid |
| Driver | D14 "Paid" or "Waiting for payment"; D15 earnings |
| Admin | `/trips` timeline and payment state; `/live` trip leaves active list; `/finance/earnings`, `/finance/collections`, `/finance/ledger`; `/overview` completed trips and trip value |
| Notifications | Rider receipt; driver "₦4,100 added to your earnings" |
| Jobs | `payments.verify-pending`, `trips.unpaid-reminder` (Q-053), `referrals.qualify` (first paid trip) |
| Failure | Timeout → "Payment not confirmed yet" with Check again (`PAYMENT_TIMEOUT_MS` 25 s); transfer unseen → pending not failed; wallet short → "Not enough in your wallet"; no double debit (idempotent per trip) |

### 4.8 Driver withdrawal requested

| Aspect | Detail |
|---|---|
| Source command | Driver `POST /driver/payouts` → `RequestWithdrawal` |
| Domain events | `withdrawal.requested`; later `withdrawal.review_started`, `withdrawal.submitted`, `withdrawal.succeeded` / `failed` / `reversed` / `rejected` |
| Records written | `WithdrawalRecord` (`requested`, history); `ApprovalRequest` (`withdrawal`) if ≥ threshold |
| Ledger | `withdrawal_reserve`: driver_earnings −W · reserve +W; later payout, release or reversal journals |
| Rider | None |
| Driver | D15 available down, "Withdrawal requested" in history |
| Admin | `/finance/withdrawals` queue and badge; `/approvals` when reviewed; `/overview` payouts pending |
| Notifications | Driver at each status; finance queue alert |
| Jobs | `withdrawals.submit`, `withdrawals.status-poll` |
| Failure | Provider down at submit → stays `requested`/`under_review` with "Waiting to send"; transfer status unknown → `processing` with "Waiting for the bank to confirm", never "Paid" |

### 4.9 Support case opened

| Aspect | Detail |
|---|---|
| Source command | Rider/driver `POST /support/tickets` or staff `OpenCase` |
| Domain event | `case.opened` |
| Records written | `CaseRecord` with links to passenger, driver, trip, payment |
| Ledger | None |
| Rider / Driver | Support conversation (R26 / D17) with status "Open" |
| Admin | `/cases` queue and badge for the assigned team; trip, passenger and driver panels list the case; payment context visible to `finance.view` |
| Notifications | Care queue; owner if urgent; customer acknowledgement in inbox |
| Jobs | `cases.sla-timer` |
| Failure | Admin realtime down → queue refreshes on poll; app submit fails → app keeps the draft: "Couldn’t send. Try again." |

### 4.10 Safety alert raised

| Aspect | Detail |
|---|---|
| Source command | Rider/driver `RaiseSafetyAlert` (proposed; today the app only opens the 112 dialler, BR-120) |
| Domain events | `safety.alert_raised`, `case.opened` (team safety), `safety.responders_notified` |
| Records written | `CaseRecord` (`team: safety`, `urgent`, `safetyContext` with location snapshot), access log |
| Ledger | None |
| Rider / Driver | "Safety team alerted" with time; later "Our safety team is on it" |
| Admin | `/safety` queue (badge, sound); trip panel "Restricted case"; `/live` safety marker; `/overview` count |
| Notifications | Designated responders (admin alert, staff push, SMS fallback proposed) |
| Jobs | `safety.escalation-timer`, `safety.responder-notify` |
| Failure | Responder notification fails → persistent banner on the case and escalation to the lead; app alert request fails → app shows "Couldn’t reach GoBye. Call 112." and keeps the 112 action first |

### 4.11 Refund completed

| Aspect | Detail |
|---|---|
| Source command | Approval of `RequestRefund` (`refunds.approve`) → `refunds.execute` job |
| Domain events | `refund.approved`, `refund.processing`, `refund.completed` (or `refund.failed`) |
| Records written | `RefundRecord.status`, `providerResult`; trip `payment = refunded \| partly_refunded`; case action |
| Ledger | `refund` (`refund:{id}`), from the approved funding source |
| Rider | R22 "Refund" credit; R18 ride detail shows refund; inbox "₦1,500 refund added to your wallet" |
| Driver | If clawed back from earnings: D15 adjustment with reason |
| Admin | `/finance/refunds`, `/finance/ledger`, `/finance/wallets`; case timeline in `/cases` |
| Notifications | Passenger; case owner |
| Jobs | `refunds.execute`, `refunds.status-poll` |
| Failure | Provider refund fails → `failed`, nothing credited, case shows "Refund failed. Finance will retry." |

### 4.12 Integration fails

| Aspect | Detail |
|---|---|
| Source | `integrations.health-check` job or a burst of processing failures |
| Domain events | `integration.check_failed`, `integration.degraded`; later `integration.recovered` |
| Records written | `IntegrationRecord.state = degraded`, `failures[]`, audit |
| Ledger | None |
| Rider | Payments: Add money "unavailable right now"; trip payment pending "Payment not confirmed yet"; maps: search "Search is unavailable. Enter the address by hand." (fallbacks per area); SMS: "We couldn’t send a code. Try again in a few minutes." |
| Driver | Payouts "Withdrawals are delayed"; push failures invisible to the driver but inbox still works |
| Admin | `/developer` badge; `/overview` integration alert; finance banner for payments; `/developer/events` failures |
| Notifications | Integration owner and developer role; owner for payments |
| Jobs | Retries of affected jobs paused or backed off |
| Failure | This is the failure path. No dependent screen shows success while degraded |

### 4.13 Config version takes effect

| Aspect | Detail |
|---|---|
| Source | `config.activate` job at `effectiveFrom` of a `scheduled` `ConfigVersion` |
| Domain event | `config.version_effective {key, version}` |
| Records written | New version `active`, previous `superseded` |
| Ledger | None |
| Rider | New quotes use new fares; existing bookings keep their locked fare and version (BR-031) |
| Driver | New package prices for new purchases; purchased passes keep their terms |
| Admin | `/config/*` shows "In force since"; `/audit` |
| Notifications | Optional announcement; none automatic |
| Jobs | `config.activate`, cache invalidation |
| Failure | Activation fails → old version stays in force and an alert is raised; never a mix of versions within one quote |

### 4.14 Passenger restricted

| Aspect | Detail |
|---|---|
| Source command | `RestrictPassenger {reason, until?}` (`passengers.restrict`: admin, safety) |
| Domain event | `passenger.restricted` |
| Records written | `PassengerRecord.status = restricted`, `restriction`; audit with reason |
| Ledger | None (wallet balance kept) |
| Rider | Booking blocked with "Your account is restricted. Contact support."; an active trip continues; payment of outstanding trips still allowed |
| Driver | None |
| Admin | Passenger panel; `/cases` linked |
| Notifications | Passenger inbox with how to appeal |
| Jobs | `restrictions.expire` at `until` |
| Failure | Notification fails → restriction still applies; app shows the reason at next booking attempt |

### 4.15 Document expired

| Aspect | Detail |
|---|---|
| Source | `documents.expiry-watch` job at `DriverDocument.expiresAt` |
| Domain events | `document.expired`, `driver.availability_forced {reason: document_expired}` |
| Records written | `DriverDocument.status = expired`; eligibility recalculated |
| Ledger | None (access package time is not paused unless policy says so, Q-041/Q-043) |
| Rider | None (driver no longer matched) |
| Driver | Forced offline if idle; current trip finishes; D17 "Your insurance expired. Upload a new one to drive." |
| Admin | `/drivers` expiry filter and badge; onboarding queue |
| Notifications | Driver reminders before expiry (placeholder 14 and 3 days) and at expiry |
| Jobs | `documents.expiry-watch`, `drivers.eligibility-recalc` |
| Failure | Job late → backend matching still checks document validity on every dispatch, so an expired document never gets requests |

---

## 5. Summary matrix

| Trigger | Ledger | Rider | Driver | Ops | Care | Safety | Finance | Growth | Developer | Overview |
|---|---|---|---|---|---|---|---|---|---|---|
| Driver approved | | | ● | ● | | | | | | ● |
| Package purchased | ● | | ● | | | | ● | | | ● |
| Category enabled | | ● | ● | ● | | | | | | |
| Announcement published | | ● | ● | | | | | ● | ● | |
| Campaign activated | | ● | | | | | | ● | | |
| Wallet funded | ● | ● | | | | | ● | | | ● |
| Trip completed and paid | ● | ● | ● | ● | | | ● | ● (referrals) | | ● |
| Withdrawal requested | ● | | ● | | | | ● | | | ● |
| Support case opened | | ● | ● | | ● | | | | | ● |
| Safety alert raised | | ● | ● | ● | | ● | | | | ● |
| Refund completed | ● | ● | ○ | | ● | | ● | | | ● |
| Integration fails | | ● | ● | | | | ● | | ● | ● |
| Config takes effect | | ● | ● | ● | | | | | | |
| Passenger restricted | | ● | | ● | ● | ● | | | | |
| Document expired | | | ● | ● | | | | | | ● |

● affected · ○ only if the refund is clawed back from earnings
