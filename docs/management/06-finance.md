# 06 · Finance

**Status:** Draft specification, 2026-10-21. PROPOSED. No backend, no real provider, no real money. The prototype posts journals into the in browser test dataset using the helpers in `packages/core/src/platform/ledger.ts`. Provider names in the test data ("Paystack (test)") are placeholders: the provider decision is open (Q-042).
**Source of truth for:** `/finance/collections`, `/finance/wallets`, `/finance/earnings`, `/finance/withdrawals`, `/finance/refunds`, `/finance/settlements`, `/finance/reconciliation`, `/finance/ledger`, and the financial content of `/reports`.
**Read with:** [README.md](README.md) · [01-foundation.md](01-foundation.md) (permissions, approvals, audit) · [02-oversight.md](02-oversight.md) (owner overview, `/reports` placement) · [03-operations.md](03-operations.md) (trips, drivers) · [04-configuration.md](04-configuration.md) (packages, payment methods config) · [05-care-safety.md](05-care-safety.md) (cases, refund requests) · [07-payments-and-integrations.md](07-payments-and-integrations.md) (provider setup, webhooks) · [09-connections.md](09-connections.md).

Decisions applied: D-006 (kobo), D-023 (Wallet + bank transfer at launch, cash open, no cards), D-024 (0% commission; drivers buy access packages; processing fees shown separately), D-030 (payment after the trip, its own stage), D-036 (pay → success → summary). Owner brief §5 (ledger, flows) is authoritative where older docs differ; differences are listed at the end.

---

## Part 1 · Money model

### 1.1 Four numbers that are never mixed

| Quantity | What it is | Ledger source | Is it company revenue? |
|---|---|---|---|
| **Trip value** | Sum of agreed fares (`TripRecord.agreedFare`) of completed trips, however paid, including trips paid directly to the driver | Trip records, not the ledger | No |
| **Company revenue** | Driver access package sales (D-024), plus any fee GoBye keeps (none at launch) | `company_revenue` | Yes |
| **Wallet deposits** | Money passengers put in their wallet for future use. A liability owed to passengers | `passenger_wallet` credits of kind `wallet_funding` | **No.** Never shown as revenue (brief §2) |
| **Driver earnings** | Fares paid through GoBye and owed to drivers (100% of fare, 0% commission) | `driver_earnings` credits of kind `trip_charge`, `driver_trip_earning` | No |

Also reported separately: **processing costs** (`processing_costs`), **promotional spend** (`promotions_expense`: referral rewards, goodwill), **refunds**, **payouts** (withdrawals paid), **direct to driver payments** (recorded, not in the ledger).

### 1.2 Ledger rules

1. **Entries, not balances.** A `LedgerEntry` is one signed line on one `LedgerAccount`. Lines posted together share a `journalId` and **sum to zero** (`postJournal` refuses `unbalanced` and `empty`). Every balance on every screen is `balanceOf(entries, account)`; no table stores an editable balance.
2. **Sign convention (to fix before the backend; see inconsistency F-1).** Liability and revenue accounts increase with **+** (passenger wallet, driver earnings, withdrawal reserve, company revenue). Asset and expense accounts increase with **−** (provider clearing when the provider holds our money, promotions expense, processing costs). Screens display expenses and costs as positive amounts.
3. **Corrections never edit.** A wrong entry is corrected by a new journal of kind `adjustment` (any balanced lines) or `reversal` (exact negation of a journal, `reverseJournal`, once only, `already_reversed`). Both require `reason` (`reason_required`) and link to what they correct (`reverses`). Manual adjustments need owner approval (`APPROVAL_RULES.ledger_adjustment`).
4. **Idempotency by reference.** A journal with a `reference` is posted once per (`reference`, `kind`). Posting again returns the original entries with `duplicate: true` and posts nothing. Provider events use the provider's transaction or transfer reference; internal flows use deterministic references (`trip:{tripId}`, `wd-reserve:{withdrawalId}`, `wd-release:{withdrawalId}`, `refund:{refundId}`).
5. **Overdraft guard.** Debits from a passenger wallet or driver earnings are refused with `insufficient_funds` if the derived balance is short (`chargeTripFromWallet`, `reserveWithdrawal`). The backend enforces this inside the same database transaction that posts the journal (row lock or serialisable isolation per account) so two requests cannot both pass the check.
6. **Provider association is permanent.** Every entry from a provider carries `provider` and `reference`. Switching provider ([07-payments-and-integrations.md](07-payments-and-integrations.md)) never rewrites them, so pending items are resolved with the provider that started them.

### 1.3 Accounts (`LedgerAccount`)

| Kind | Owner | Meaning | Normal sign |
|---|---|---|---|
| `passenger_wallet` | passenger id | Money held for a passenger | + |
| `driver_earnings` | driver id | Earned fares available to withdraw | + |
| `driver_withdrawal_reserve` | driver id | Earnings set aside for a requested withdrawal | + |
| `company_revenue` | none | Package sales | + |
| `provider_clearing` | provider name | Money in transit at the provider (collected, not yet settled to the bank; or sent, not yet confirmed) | − when the provider holds our money |
| `promotions_expense` | none | Referral rewards, goodwill credits | − |
| `processing_costs` | none | Provider fees GoBye bears | − |

**Proposed additions (backend need, not in code):** `company_bank` (settled money in GoBye's bank account; needed for settlement journals), `passenger_wallet_reserve` (only if reservation at booking is chosen; the rider wallet already displays "reserved"), `goodwill_expense` (if goodwill is separated from promotions), `suspense` (unmatched provider money awaiting reconciliation).

### 1.4 Journal kinds (`LedgerEntryKind`)

| Kind | Lines (account: sign) | Reference | Posted by | Helper |
|---|---|---|---|---|
| `wallet_funding` | passenger_wallet: +A · provider_clearing: −A | provider reference | provider event, after server verification | `creditWalletFunding` |
| `trip_charge` | passenger_wallet: −F · driver_earnings: +F | `trip:{tripId}` | system on wallet payment | `chargeTripFromWallet` |
| `driver_trip_earning` | driver_earnings: +F · provider_clearing: −F | provider reference | provider event for a transfer to the GoBye collection account | `postJournal` |
| `package_purchase` | company_revenue: +P · provider_clearing: −P | provider reference | provider event | `postJournal` |
| `processing_fee` | processing_costs: −f · provider_clearing: +f (proposed sign, see F-1) | `{reference}-fee` | provider event or settlement import | `postJournal` |
| `refund` | to wallet: passenger_wallet: +R · funding account: −R. To original method: passenger_wallet or source: −R · provider_clearing: +R | `refund:{refundId}` | system after approval | `postJournal` |
| `withdrawal_reserve` | driver_earnings: −W · driver_withdrawal_reserve: +W | `wd-reserve:{id}` | driver request | `reserveWithdrawal` |
| `withdrawal_release` | driver_withdrawal_reserve: −W · driver_earnings: +W | `wd-release:{id}` | rejection or provider failure | `releaseWithdrawal` |
| `withdrawal_payout` | driver_withdrawal_reserve: −W · provider_clearing: +W | provider transfer reference | provider success event | `settleWithdrawal` |
| `referral_reward` | passenger_wallet: +X · promotions_expense: −X | `ref-reward:{id}` | referrals job | `postJournal` |
| `adjustment` | any balanced lines, reason required | `adj:{approvalId}` | finance, after owner approval | `postJournal` |
| `reversal` | negation of one journal, reason required | `{original}-rev` or provider reversal reference | finance (approved) or provider event | `reverseJournal` / `postJournal` |

Settlement (proposed, needs `company_bank`): provider_clearing: +S · company_bank: −S, reference = provider settlement id.

---

## Part 2 · Key flows

Each flow lists the step, where it happens, records written, ledger journal, status, notification and failure handling. Surfaces: **Rider** (passenger app), **Driver** (driver app, planned D09 to D17), **Admin** (this platform), **Server**, **Provider**.

### Flow (a) · Passenger wallet funding

| # | Step | Surface | Records | Ledger | Status | Notification |
|---|---|---|---|---|---|---|
| 1 | Passenger enters amount (Add money, R22 DepositSheet) | Rider | none | none | | |
| 2 | App calls `POST /wallet/top-ups {amountKobo}` with `Idempotency-Key` | Server | `CollectionRecord` (`purpose: wallet_funding`, `payerType: passenger`, unique `reference`, `provider` = active live provider, `fee`) | none | `initiated` | |
| 3 | Server opens provider checkout (or issues virtual account details, D-023) and returns instructions | Server, Provider | collection updated with provider handle | none | `pending` | |
| 4 | Passenger pays at the provider | Provider | provider event received and stored raw (signature checked) | none | `pending` | |
| 5 | Server verifies the result **server side** (signed webhook plus status query to the provider for the reference; amount and currency must match) | Server | `events[]` appended; duplicates appended with `duplicate: true` | none yet | `successful` or `failed` | |
| 6 | Wallet credited **once** | Server | `verifiedAt` | `wallet_funding` (reference = provider reference). Fee journal if GoBye bears the fee | `successful` | |
| 7 | Transaction visible | Rider R22 (Deposit, "Completed"), Admin `/finance/collections`, `/finance/wallets`, `/finance/ledger` | | | | |
| 8 | Confirmation sent | Rider | notification record | | | Inbox + push: "₦5,000 added to your wallet" |

Failure handling:

| Case | Behaviour |
|---|---|
| Duplicate webhook for the same reference | Event stored with `duplicate: true`; `postJournal` returns the existing entries; no second credit; `/developer/events` shows "Duplicate, ignored" |
| Webhook signature invalid | Rejected (no state change), stored in `/developer/events` as a processing failure, integration check "Webhook signature verified" fails → integration `degraded` if repeated |
| Webhook never arrives | Job `payments.verify-pending` queries the provider for `pending` collections (backoff schedule placeholder: 1, 5, 15, 60 min). App shows "Pending. We’ll add it when the payment is confirmed." |
| Amount differs from requested | Credit the **verified** amount, flag the collection for reconciliation, notify finance |
| Passenger closes checkout | After the expiry window (placeholder 30 min) with no provider record: `abandoned`. No credit |
| Provider reports success after `abandoned` or `failed` | Inconsistency F-3: `COLLECTION_FLOW` has no such transition. Proposed: allow `abandoned → successful` only from a verified provider event; post the credit; notify passenger and finance |
| Provider reverses a successful funding | Collection `reversed`; `reversal` journal of the funding (reason = provider event). If the wallet has already been spent, the wallet can go negative only through this reversal; the passenger is blocked from booking until it is settled and a case is opened automatically |
| Provider unavailable at step 3 | App: "Add money is unavailable right now. Try again later." Collection stays `initiated` → `failed` with reason `provider_unavailable`. Integration health alert |

### Flow (b) · Trip payment

The selector lives on the end of trip screen, never on pricing (D-030). Reserving wallet funds earlier in booking is an **open decision** and, if adopted, only adds a hold; it does not move the selector back to pricing.

| # | Step | Surface | Records | Ledger | Status | Notification |
|---|---|---|---|---|---|---|
| 1 | Driver completes trip | Driver D13 → Server | `TripRecord.status = payment_pending`, `payment = pending`; booking `payment_pending`, `awaitingPaymentAction` | none | `pending` | Rider: trip complete screen |
| 2 | Passenger sees the payment focused screen (R29 `trip-complete`: amount due once, method with Change) | Rider | | | | |
| 3a | **Wallet:** "Pay ₦4,100" → `POST /bookings/{id}/charge` with key `${bookingId}-${attempt}` | Rider → Server | booking `paymentAttempts += 1`; payment attempt record | `trip_charge` (reference `trip:{tripId}`), refused if balance < total | `processing` → `paid` | |
| 3b | **Bank transfer:** "Pay ₦4,100" opens account details from `POST /bookings/{id}/bank-transfer` (GoBye collection account per payment, exact amount, reference, expiry); "I’ve transferred" calls `/bank-transfer/confirm`, which only starts a check | Rider → Server → Provider | `CollectionRecord` (`purpose: trip_payment`) | none until verified | `processing`; check result `checking` or `not_received` | |
| 4 | Payment confirmed: wallet journal posted, or provider transfer verified server side | Server | trip `payment = paid`, booking `completed`; collection `successful` | 3b: `driver_trip_earning` (reference = provider reference); passenger borne fee to `processing_costs` | `paid` | |
| 5 | Driver earnings and financial records update | Driver D14, D15; Admin `/finance/earnings`, `/finance/ledger`, trip panel | | | | Driver: "₦4,100 added to your earnings" |
| 6 | Payment success screen (R14 `trip-paid`, green, only after verification) | Rider | | | | Push if app in background |
| 7 | Rating and receipt (R29b `trip-summary`, R15 receipt: fare, processing fee only if > 0, total) | Rider | receipt record | | | Receipt in inbox (email when email integration is live) |

App behaviour while unconfirmed (from `apps/rider/src/state/booking.tsx` and `booking/machine.ts`):

| Situation | App state | Copy and actions |
|---|---|---|
| Request in flight | `paymentStatus: processing`; method switch and second tap blocked (`PAYMENT_STARTED` guard) | Button "Paying" |
| No answer within `PAYMENT_TIMEOUT_MS` (25 s) | `pending` with notice `not_confirmed`; never "failed" because money may have moved | "Payment not confirmed yet" · **Check again** (new attempt key; the wallet debit is idempotent per trip, `trip:{tripId}`, so it cannot debit twice) |
| Transfer not seen yet | `pending` with notice `transfer_not_received` | "Transfer not received yet" · Check again · Pay with GoBye Wallet instead |
| Wallet short | `failed` (`402 INSUFFICIENT_WALLET_BALANCE`) | "Not enough in your wallet" · Add money · Use bank transfer |
| Passenger leaves | Trip stays `payment_pending`; Home shows "Payment outstanding"; new booking blocked (Q-053) | Pay later |

Server rules: the server, not the app, decides the amount (`fareKobo`, `processingFeeKobo`, `totalKobo`); the wallet check and debit happen in one transaction; a trip has at most one successful payment; a transfer that arrives after the passenger already paid by wallet is an **overpayment**: credited to the passenger's wallet (journal `wallet_funding`, reference = provider reference) and flagged for finance (Q-042).

Failure handling: duplicate charge requests return the original result; duplicate webhooks are ignored as in flow (a); a provider reversal after `paid` sets trip payment back to `failed` only through a `reversal` journal of `driver_trip_earning`, which may take the driver's earnings negative (open question F-Q4) and opens a finance case.

### Flow (c) · Driver withdrawal

| # | Step | Surface | Records | Ledger | Status | Notification |
|---|---|---|---|---|---|---|
| 1 | Driver chooses verified bank account (name enquiry passed) and amount ≤ available | Driver D15 | | | | |
| 2 | `POST /driver/payouts {amountKobo}` with `Idempotency-Key` | Server | `WithdrawalRecord` (`requested`, bank account snapshot, history) | `withdrawal_reserve` (`wd-reserve:{id}`): earnings → reserve | `requested` | Driver: "Withdrawal requested" |
| 3 | Checks: account verified, amount ≥ minimum (Q-031), no open payment dispute, velocity limits. If `needsApproval('withdrawal', amount)` (≥ ₦100,000 placeholder) → review | Server, Admin `/finance/withdrawals`, `/approvals` | `ApprovalRequest` (`withdrawal`) when reviewed | none | `under_review` (or straight to step 4) | Finance queue badge |
| 4 | Approved (or no review needed): transfer submitted to the provider | Server (`withdrawals.submit` job), Provider | `provider`, `transferReference` | none (money not yet gone) | `processing` | Driver: "Sent to your bank. Waiting for the bank to confirm." |
| 5a | Provider **success** event (verified) | Server | history entry by provider | `withdrawal_payout` (reference = transfer reference) | `successful` | Driver: "₦25,000 paid to GTBank ••••1234" |
| 5b | Provider **failure** event | Server | history entry | `withdrawal_release` (`wd-release:{id}`) | `failed` | Driver: "Withdrawal failed. ₦25,000 is back in your earnings." |
| 5c | Provider **reversal** event, after success | Server | history entry | `reversal`: provider_clearing −W · driver_earnings +W (reference = provider reversal reference) | `reversed` | Driver: "Your bank returned ₦25,000. It is back in your earnings." |
| — | Rejected in review | Admin | history, review note | `withdrawal_release` | `rejected` | Driver: reason in plain words |

Rules: **submitted is not completed**; nothing shows "Paid" until 5a. Success, failure and reversal are separate provider events and each is processed once by reference. A withdrawal can be `processing` for a long time; job `withdrawals.status-poll` queries the provider and raises a finance alert after a placeholder 24 h. Earnings cannot be withdrawn twice because the reserve journal moves them first. A driver may have one open withdrawal at a time (placeholder rule).

### Flow (d) · Direct transfer to a driver's personal account

| Aspect | Rule |
|---|---|
| Record | A distinct `DirectPaymentReport` (proposed record: `{ id, tripId, passengerId, driverId, amountKobo, reportedBy, reportedAt, driverConfirmedAt?, status: reported \| driver_confirmed \| disputed }`). `TripRecord.directToDriver = true` |
| Ledger | **None.** The money never passes through GoBye. It is never credited to `driver_earnings`, so it cannot be withdrawn, and it is never counted as collections |
| Confirmation | Cannot be verified automatically. Showing the driver's personal account details is not verification. Automatic confirmation needs a supported provider collection arrangement (for example a provider account issued in the driver's name with event notifications), which is not specified for launch |
| Trip payment state | Proposed new value `reported_direct` (not "paid") until the driver confirms receipt in the driver app; then `paid_direct`. Disputes go to care |
| Reports | Counted in trip value; shown as its own line "Paid directly to drivers (not verified by GoBye)" |
| Refunds | GoBye cannot refund money it never held; any goodwill credit is a separate approved refund with its own funding source |

---

## Part 3 · Modules

Shared permission facts (from `ROLE_PERMISSIONS`): `finance.view` = owner, care, finance, auditor. `ledger.view` = owner, finance, auditor. `ledger.adjust`, `withdrawals.review`, `withdrawals.process`, `reconciliation.work` = finance. `refunds.request` = care, finance. `refunds.approve` = owner, finance. `reports.view` = owner, admin, finance, marketing, auditor. `reports.export` = owner, finance. All finance lists respect the global city and date filter and the staff city scope.

Common states for every finance list (concrete copy given per module where it differs):
- **Loading:** table skeleton; "Loading …".
- **Empty for filters:** "Nothing matches these filters." + Clear filters.
- **Test data banner (prototype):** "Test data. No real money moves."
- **Provider degraded:** banner "Payment provider checks are failing. New payments may stay pending." linking to `/developer`.

### Module 1 · Collections (`/finance/collections`)

#### 1. Users and permissions

View: `finance.view`. Mark for reconciliation, request status check: `reconciliation.work`. Role home for finance.

#### 2. Screens and navigation

`/finance/collections` list with tabs All · Pending · Failed · Duplicates seen; filters purpose (`wallet_funding`, `package_purchase`, `trip_payment`), status, provider, payer type, city, date. Row → drawer with timeline of provider events. Links: payer (passenger or driver panel), trip (for `trip_payment`), ledger journal.

#### 3. Fields and data source

| Field | Source | Notes |
|---|---|---|
| Reference | `CollectionRecord.reference` | Copyable |
| Purpose | `purpose` | |
| Payer | `payerType`, `payerId` → record | |
| Amount | `amount` (kobo) | |
| Fee | `fee` (kobo) | Who bears it shown from payments config |
| Provider | `provider` | Kept forever |
| Status | `status` | `COLLECTION_FLOW` |
| Created, verified | `createdAt`, `verifiedAt` | |
| Provider events | `events[]` (`event`, `at`, `duplicate`) | Duplicates shown greyed with "Duplicate, ignored" |
| Ledger journal | entries with `reference` = collection reference | |

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Check status with provider | `reconciliation.work` | No | Enqueues `payments.verify-pending` for this reference; result may move status |
| Flag for reconciliation | `reconciliation.work` | No | Adds to reconciliation exceptions with note |
| Open case | `cases.work` (care) | No | Case linked to payer and collection |
| Export | `reports.export` | No | CSV |

No action edits a collection status by hand.

#### 5. Validation and approval rules

Status changes only from verified provider events or the verification job. A `successful` collection must have exactly one matching journal; the reconciliation job flags otherwise.

#### 6. Status transitions

Transition table: `COLLECTION_FLOW`. `initiated` → `pending` · `abandoned` · `failed`; `pending` → `successful` · `failed` · `abandoned`; `successful` → `reversed`; `failed`, `abandoned`, `reversed` final (see F-3).

#### 7. Effects on other screens and apps

Wallet funding success → Rider R22 balance and transaction; package purchase success → driver access active (D17, [09-connections.md](09-connections.md)); trip payment success → trip paid. Owner overview collections total.

#### 8. Notifications and background jobs

Jobs `payments.verify-pending`, `collections.expire`, `reconciliation.daily`. Finance alert when pending count older than 1 h exceeds a placeholder threshold.

#### 9. Loading, empty, pending, error and success states

Empty: "No collections in this period." Pending pill "Pending at provider"; check running: "Checking with provider". Error: "Couldn’t reach the provider. Status unchanged." Success: "Status checked. Still pending." / "Payment confirmed and credited."

#### 10. Acceptance checks

1. Given a `wallet_funding` collection with two `charge success` events for one reference, when viewed, then one event is marked duplicate and exactly one `wallet_funding` journal exists.
2. Given a `pending` collection, when a finance user clicks Check status and the provider still has nothing, then status stays `pending` and an audit entry is written.
3. Given a care user, when they open Collections, then no action other than Open case is available.
4. Given a collection made with a provider later replaced, then its provider column still shows the original provider.

**Backend needs.** Commands `StartWalletFunding`, `StartPackagePurchase`, `StartTripTransfer`, `RequestCollectionStatusCheck`; events `collection.initiated`, `collection.pending`, `collection.succeeded`, `collection.failed`, `collection.abandoned`, `collection.reversed`, `provider_event.duplicate`; jobs above.

### Module 2 · Passenger wallets (`/finance/wallets`)

#### 1. Users and permissions

View: `finance.view`. Ledger lines: `ledger.view`. Adjust: `ledger.adjust` + owner approval. Refund to wallet: via Refunds.

#### 2. Screens and navigation

List of passengers with wallet balance (derived), reserved (if adopted), last movement; sort by balance. Drawer: wallet statement (all `passenger_wallet` entries for the passenger), pending fundings, refunds, link to passenger panel.

#### 3. Fields and data source

| Field | Source |
|---|---|
| Available | `balanceOf(passenger_wallet:{id})` minus reserved |
| Reserved | `balanceOf(passenger_wallet_reserve:{id})` (proposed; zero until adopted) |
| Pending deposits | `CollectionRecord` `wallet_funding` with status `pending` (not in balance) |
| Deposits, charges, refunds, rewards | entries by kind: `wallet_funding`, `trip_charge`, `refund`, `referral_reward`, `adjustment`, `reversal` |
| Totals | sum across passengers = wallet liability |

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Request adjustment | `ledger.adjust` | Yes, owner (`ledger_adjustment`) | Approval request with lines and reason; journal posted on approval |
| Request refund to wallet | `refunds.request` | Yes (refund) | See Module 5 |
| Passenger wallet withdrawal | none | n/a | Not offered. Open policy decision |
| Export statement | `reports.export` | No | CSV/PDF |

#### 5. Validation and approval rules

Adjustment lines must balance, name a counter account (never `company_revenue` for a wallet credit), and carry a reason ≥ 10 chars. A wallet cannot be made negative by staff action.

#### 6. Status transitions

Wallet has no status; entries are immutable. Related: collection and refund flows.

#### 7. Effects on other screens and apps

Rider R22 balance and transaction list; R29 "available balance" on the payment sheet; owner overview wallet liability (never revenue).

#### 8. Notifications and background jobs

Passenger notified of every credit (funding, refund, reward, adjustment). Job `reconciliation.daily` checks the sum of wallets against collections minus charges.

#### 9. Loading, empty, pending, error and success states

Empty: "No wallet activity yet." Pending deposit pill "Waiting for provider". Error: "Couldn’t load this statement." Success: "Adjustment sent for owner approval."

#### 10. Acceptance checks

1. Given a passenger with entries +₦5,000 funding and −₦4,100 charge, then the shown balance is ₦900 and there is no editable balance field anywhere.
2. Given a pending funding of ₦10,000, then it is listed as pending and not included in available.
3. Given a finance user requests a ₦500 adjustment, then nothing changes until a different person with the owner role approves; then one `adjustment` journal with the reason exists.
4. Given the wallet total, then it appears on reports as a liability and never in revenue.

**Backend needs.** Queries for wallet statement by passenger; command `RequestLedgerAdjustment`; events `wallet.credited`, `wallet.debited`.
**Open question:** passenger withdrawal of unused wallet funds (brief §5; Q-032 wallet regulatory status).
**Open question:** whether to reserve funds at booking (would add `passenger_wallet_reserve`).

### Module 3 · Driver earnings (`/finance/earnings`)

#### 1. Users and permissions

View: `finance.view`. Adjustments: `ledger.adjust` + owner approval.

#### 2. Screens and navigation

List of drivers: pending, available, reserved, withdrawn (period), packages bought (period, shown separately, not netted). Drawer: earnings statement, trips paid, withdrawals, direct payments reported.

#### 3. Fields and data source

| Field | Source |
|---|---|
| Pending | Agreed fares of the driver's trips in `payment_pending` (from trips; not in ledger) |
| Available | `withdrawable(entries, driverId)` = `balanceOf(driver_earnings)` |
| Reserved | `balanceOf(driver_withdrawal_reserve)` |
| Withdrawn | sum of `withdrawal_payout` in period |
| Trip earnings | `trip_charge` and `driver_trip_earning` credits |
| Direct to driver | `DirectPaymentReport` (not money held) |
| Packages bought | collections `package_purchase` for the driver (company revenue, never deducted from earnings) |
| Bank account | `DriverRecord.bankAccount` (masked, verified flag) |

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Request adjustment | `ledger.adjust` | Yes, owner | Journal on approval |
| Hold withdrawals for driver | `withdrawals.review` | No (reason) | Proposed flag; new requests go to `under_review` |
| Export | `reports.export` | No | CSV |

#### 5. Validation and approval rules

Earnings come only from verified trip payments. Direct transfers never create earnings. A hold needs a reason and appears to the driver as "Withdrawals paused. Contact support."

#### 6. Status transitions

None on the account; trip and withdrawal flows apply.

#### 7. Effects on other screens and apps

Driver D14 trip complete shows "Paid" or "Waiting for payment"; D15 shows pending, available, reserved (copy "On its way to your bank").

#### 8. Notifications and background jobs

Driver notified on each credit (batched daily summary optional). Job `reconciliation.daily` checks earnings vs trips paid.

#### 9. Loading, empty, pending, error and success states

Empty: "No earnings in this period." Error: "Couldn’t load earnings." Success: "Adjustment sent for owner approval."

#### 10. Acceptance checks

1. Given a wallet paid trip of ₦4,100, then the driver's available rises by ₦4,100 exactly once, with commission ₦0.
2. Given a trip with `directToDriver`, then available is unchanged and the trip appears under Direct to driver.
3. Given a driver bought a ₦1,500 package, then earnings are unchanged and the package appears in company revenue.
4. Given a withdrawal request of ₦20,000, then available falls and reserved rises by ₦20,000 at once.

**Backend needs.** Earnings query by driver and period (`GET /driver/earnings` keeps `commissionKobo: 0` and `accessPackagesKobo` separate); events `earnings.credited`, `earnings.adjusted`.
**Open question:** hold period before trip earnings become available (needed for transfer reversals).

### Module 4 · Withdrawals (`/finance/withdrawals`)

#### 1. Users and permissions

View: `withdrawals.view` (owner, finance, auditor). Review decision: `withdrawals.review` + `canDecide` on the `withdrawal` approval. Submit transfer, retry status: `withdrawals.process`.

#### 2. Screens and navigation

Tabs: Requested · Under review · Processing · Successful · Failed · Reversed · Rejected. Badge = requested + under review. Drawer: driver, amount, bank snapshot (masked), checks, history timeline (`history[]`), provider reference, ledger journals.

#### 3. Fields and data source

`WithdrawalRecord`: `id`, `driverId`, `amount` (kobo), `bankAccount` snapshot, `status`, `requestedAt`, `provider`, `transferReference`, `reviewNote`, `history[]`. Checks (proposed computed): bank verified, amount within available at request, open disputes, account age, previous failures.

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Start review | `withdrawals.review` | n/a | `requested` → `under_review` |
| Approve | `withdrawals.review` | Is the approval (finance; never the requester) | Then submit (below) |
| Reject | `withdrawals.review` | No (reason required) | `rejected`, `withdrawal_release` |
| Submit transfer | `withdrawals.process` | Needs approval when ≥ threshold | `processing`, provider call, reference stored |
| Check status | `withdrawals.process` | No | Provider status query |
| Mark failed / successful by hand | none | n/a | Not offered. Only provider events change these |

#### 5. Validation and approval rules

`needsApproval('withdrawal', amount)`: ≥ ₦100,000 (10,000,000 kobo, placeholder) requires review; below can go `requested` → `processing` automatically. Bank account must be verified at submission time; if changed since request, reject with "Bank account changed. Ask the driver to request again." Payout fees (Q-031) are shown separately and never taken silently.

#### 6. Status transitions

Transition table: `WITHDRAWAL_FLOW`. `requested` → `under_review` · `processing` · `rejected`; `under_review` → `processing` · `rejected`; `processing` → `successful` · `failed`; `successful` → `reversed`; `failed`, `reversed`, `rejected` final.

#### 7. Effects on other screens and apps

Driver D15 history and balances; owner overview payouts; `/approvals` item; ledger.

#### 8. Notifications and background jobs

Driver notified at requested, under review (only if it takes longer than a placeholder 2 h), submitted, successful, failed, reversed, rejected. Jobs `withdrawals.submit` (idempotent per withdrawal id), `withdrawals.status-poll`, finance alert for `processing` older than 24 h.

#### 9. Loading, empty, pending, error and success states

Empty: "No withdrawals waiting." Pending pill "Processing at provider". Error: "Couldn’t submit the transfer. Nothing was sent. Try again." (only if the provider confirmed no transfer was created; otherwise "Transfer status unknown. Checking with provider."). Success: "Transfer submitted. It is not paid until the provider confirms."

#### 10. Acceptance checks

1. Given a ₦150,000 request, then it cannot reach `processing` without an approval decided by someone other than the requester.
2. Given a `processing` withdrawal and a provider success event delivered twice, then one `withdrawal_payout` journal exists and status is `successful`.
3. Given a provider failure event, then status `failed`, a `withdrawal_release` journal exists, and the driver's available is restored.
4. Given a reversal event after success, then status `reversed` and earnings rise by the amount once.
5. Given a finance user, then no button sets `successful` or `failed` by hand.

**Backend needs.** Commands `RequestWithdrawal` (driver), `StartWithdrawalReview`, `DecideWithdrawal`, `SubmitWithdrawalTransfer`, `CheckWithdrawalStatus`; events `withdrawal.requested`, `withdrawal.review_started`, `withdrawal.approved`, `withdrawal.rejected`, `withdrawal.submitted`, `withdrawal.succeeded`, `withdrawal.failed`, `withdrawal.reversed`.
**Open question:** review threshold (placeholder ₦100,000), minimum amount, schedule and fees (Q-031).

### Module 5 · Refunds and disputes (`/finance/refunds`)

#### 1. Users and permissions

View: `finance.view`. Request: `refunds.request` (care, finance). Decide: `refunds.approve` (finance, owner) via `canDecide`. Execute is automatic after approval.

#### 2. Screens and navigation

Tabs: Requested · Approved · Processing · Completed · Failed · Rejected. Drawer: reason, amount, destination, linked trip, case, collection, provider result, approval decision, journals.

#### 3. Fields and data source

`RefundRecord`: `id`, `tripId`, `caseId`, `passengerId`, `amount`, `reason`, `destination` (`wallet` \| `original_method`), `status`, `requestedBy`, `approvedBy`, `requestedAt`, `providerResult`. Proposed: `fundingSource` (`driver_earnings` \| `promotions_expense` \| `goodwill_expense` \| `provider_clearing`), `disputeId` for provider disputes.

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Request refund | `refunds.request` | Yes | `requested` + `ApprovalRequest` (`refund`) |
| Approve | `refunds.approve` | Is the approval | `approved` → system sets `processing` |
| Reject | `refunds.approve` | No (reason) | `rejected`; case timeline updated |
| Retry failed | `refunds.approve` | No | `failed` → `processing` |

#### 5. Validation and approval rules

Every refund needs approval (`thresholdKobo: 0`). Amount ≤ refundable remainder of the linked payment. `original_method` only for provider collected payments and only when the provider integration is `live` with a refund capability; wallet paid trips refund to wallet. The funding source must be chosen at approval: a duplicate or wrong charge reverses the original journal (`reversal`, may claw back driver earnings, with driver notified); goodwill uses an expense account.

#### 6. Status transitions

Transition table: `REFUND_FLOW`. `requested` → `approved` · `rejected`; `approved` → `processing`; `processing` → `completed` · `failed`; `failed` → `processing`.

#### 7. Effects on other screens and apps

Wallet refund: Rider R22 "Refund" credit; case timeline ([05-care-safety.md](05-care-safety.md)); trip payment state `refunded` or `partly_refunded`; driver earnings if clawed back.

#### 8. Notifications and background jobs

Passenger notified at approval and completion; case owner notified at each change. Job `refunds.execute` (provider call for `original_method`, idempotent by refund id), `refunds.status-poll`.

#### 9. Loading, empty, pending, error and success states

Pending pill "Waiting for approval" / "Refund in progress". Error: "The provider declined this refund. You can try again." Success: "Refund approved. ₦1,500 added to the passenger’s wallet."

#### 10. Acceptance checks

1. Given a refund requested by Ruth, then Ruth cannot approve it even with the finance role.
2. Given an approved wallet refund of ₦1,500, then one `refund` journal (reference `refund:{id}`) credits the wallet and the case timeline shows "Refund completed".
3. Given a provider refund that fails, then status `failed`, no wallet credit, and retry moves it to `processing`.
4. Given a trip paid directly to the driver, then `original_method` is not offered.

**Disputes (provider chargebacks or bank complaints):** proposed `DisputeRecord { id, collectionId, provider, amountKobo, reason, status: open | evidence_submitted | won | lost, dueAt }`, created from provider events, shown in this module's Disputes tab; a lost dispute posts a `reversal` of the collection journal. Not in code yet (backend need).

**Backend needs.** Commands `RequestRefund`, `DecideRefund`, `RetryRefund`; events `refund.requested`, `refund.approved`, `refund.rejected`, `refund.processing`, `refund.completed`, `refund.failed`, `dispute.opened`, `dispute.closed`.
**Open question:** funding source for goodwill refunds (test data uses `promotions_expense`).

### Module 6 · Settlements (`/finance/settlements`)

#### 1. Users and permissions

View: `finance.view`. Record bank confirmation: `reconciliation.work`.

#### 2. Screens and navigation

One row per provider settlement period; drawer shows collections included, fees, settled amount, bank reference, difference to ledger.

#### 3. Fields and data source

`SettlementRecord`: `provider`, `periodStart`, `periodEnd`, `collected`, `fees`, `settled`, `settledAt`, `bankReference`, `ledgerTotal`; difference = `collected − ledgerTotal`.

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Import provider settlement | system job | No | Creates or updates record |
| Confirm bank receipt | `reconciliation.work` | No | Sets `bankReference`; proposed settlement journal to `company_bank` |
| Send difference to reconciliation | `reconciliation.work` | No | Creates exception |

#### 5. Validation and approval rules

`settled = collected − fees` must hold per provider statement; otherwise flagged. Settlement destination is owned by Payments setup ([07-payments-and-integrations.md](07-payments-and-integrations.md)); changing it needs owner approval.

#### 6. Status transitions

Proposed `expected → reported → received` (by `settledAt` and `bankReference`); not in `workflows.ts` yet.

#### 7. Effects on other screens and apps

Reconciliation module; owner overview processing costs.

#### 8. Notifications and background jobs

`settlements.import` (daily), alert when an expected settlement is late by a placeholder 2 working days.

#### 9. Loading, empty, pending, error and success states

Pending pill "Not settled yet". Empty: "No settlements for this period." Error: "Couldn’t import the provider statement." Success: "Bank receipt recorded."

#### 10. Acceptance checks

1. Given a period where collected ₦100,000 and ledger ₦98,500, then the row shows a difference of ₦1,500 and a link to reconciliation.
2. Given a period with no `settledAt`, then it shows "Not settled yet" and is excluded from settled totals.

**Backend needs.** Job `settlements.import`; event `settlement.reported`, `settlement.received`; account `company_bank`.
**Open question:** settlement account owner and bank (who holds the business account; Q-009 legal entity).

### Module 7 · Reconciliation (`/finance/reconciliation`)

#### 1. Users and permissions

View: `finance.view`. Work exceptions: `reconciliation.work`. Post corrections: `ledger.adjust` + owner approval.

#### 2. Screens and navigation

Three way view per day and provider: provider records ↔ bank settlements ↔ ledger. Exceptions list with type, amount, age, owner.

#### 3. Fields and data source

Derived from `CollectionRecord`, `SettlementRecord`, `LedgerEntry`, withdrawal records. Exception types (proposed): `missing_in_ledger`, `missing_at_provider`, `amount_mismatch`, `duplicate_credit`, `late_success`, `unsettled`, `payout_unconfirmed`.

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Assign exception | `reconciliation.work` | No | Owner set |
| Explain and close | `reconciliation.work` | No | Note required; no money change |
| Propose correction | `ledger.adjust` | Yes, owner | Adjustment or reversal journal on approval, linked to exception |

#### 5. Validation and approval rules

An exception closes only with a note, or with a linked correction journal.

#### 6. Status transitions

Proposed `open → investigating → resolved`.

#### 7. Effects on other screens and apps

Ledger, owner overview risk count, audit.

#### 8. Notifications and background jobs

`reconciliation.daily` (creates exceptions), finance daily summary.

#### 9. Loading, empty, pending, error and success states

Empty: "Everything matches for this period." Error: "Reconciliation didn’t run today. Last run: …" Success: "Exception resolved."

#### 10. Acceptance checks

1. Given the seeded week with a ₦1,500 difference, then one `amount_mismatch` exception exists.
2. Given a correction proposed by finance, then the journal posts only after owner approval and the exception links to it.

**Backend needs.** Job `reconciliation.daily`; events `reconciliation.exception_opened`, `reconciliation.exception_resolved`.

### Module 8 · Ledger (`/finance/ledger`)

#### 1. Users and permissions

View: `ledger.view` (owner, finance, auditor). Request adjustment or reversal: `ledger.adjust` (finance). Approve: owner (`ledger_adjustment`).

#### 2. Screens and navigation

Journal list (grouped by `journalId`), filters by account kind, owner, kind, reference, provider, date. Journal drawer: lines, links (trip, withdrawal, refund, case, collection), created by, reason, reversal link.

#### 3. Fields and data source

`LedgerEntry` fields as in `types.ts`; balances by account via `balanceOf`.

#### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Request adjustment | `ledger.adjust` | Yes, owner | Lines + reason → approval |
| Request reversal of journal | `ledger.adjust` | Yes, owner | `reverseJournal` on approval |
| Export | `reports.export` | No | CSV |

#### 5. Validation and approval rules

Balanced, non empty, reason required, single reversal, no edits or deletes ever (append only storage).

#### 6. Status transitions

Entries have none. Adjustment approvals: `pending` → `approved` / `rejected`.

#### 7. Effects on other screens and apps

Every balance in both apps and every finance screen.

#### 8. Notifications and background jobs

Owner notified of adjustment requests. Job `ledger.integrity` (daily: every journal sums to zero; no account below zero except allowed cases).

#### 9. Loading, empty, pending, error and success states

Empty: "No journals for these filters." Error: "This journal doesn’t balance." (refused before sending). Success: "Adjustment sent for owner approval."

#### 10. Acceptance checks

1. Given any journal, then the sum of its lines is 0.
2. Given a reversal of an already reversed journal, then it is refused with "This journal has already been reversed."
3. Given an adjustment without a reason, then it is refused.
4. Given an auditor, then the ledger is readable and no action is available.

**Backend needs.** Append only `ledger_entries` table with unique (`reference`, `kind`); command `RequestLedgerAdjustment`, `RequestJournalReversal`; event `ledger.journal_posted`.

### Module 9 · Reports (financial content of `/reports`)

#### 1. Users and permissions

View: `reports.view`. Export: `reports.export`. Marketing sees growth reports only; finance figures need `finance.view`.

#### 2. Screens and navigation

`/reports` sections: Revenue, Money held, Costs, Payouts, Outstanding, Trips (value). City (Abuja, Lagos) and date filters. Receipts lookup by trip ref.

#### 3. Fields and data source

| Line | Source |
|---|---|
| Trip value (completed trips) | Sum `agreedFare`, split by: paid by wallet, paid by transfer through GoBye, paid directly to driver (not verified), outstanding |
| Company revenue | `company_revenue` credits (`package_purchase`), split daily and monthly packages, renewals |
| Wallet deposits | `wallet_funding` credits (shown as money received for future use, not revenue) |
| Wallet liability | Sum of passenger wallets at period end |
| Driver earnings | `trip_charge` + `driver_trip_earning` credits |
| Driver earnings owed | Sum of `driver_earnings` + `driver_withdrawal_reserve` at period end |
| Payouts | `withdrawal_payout`; failed and reversed counts |
| Refunds | `refund` journals by funding source |
| Promotional spend | `promotions_expense` |
| Processing costs | `processing_costs` |
| Outstanding trip payments | trips in `payment_pending` with age buckets |

#### 4. Available actions

Export CSV/PDF (`reports.export`, audited); download a passenger receipt (finance).

#### 5. Validation and approval rules

Every report states its basis (ledger date vs trip completion date) and never sums lines from different rows of the table above into one "revenue" figure.

#### 6. Status transitions

None.

#### 7. Effects on other screens and apps

Feeds owner overview ([02-oversight.md](02-oversight.md)).

#### 8. Notifications and background jobs

`reports.export` job for large exports; link sent in admin notifications.

#### 9. Loading, empty, pending, error and success states

Loading: "Preparing report". Empty: "No activity for this period." Error: "Couldn’t prepare the export. Try again." Success: "Export ready."

#### 10. Acceptance checks

1. Given a ₦10,000 wallet funding and no trips, then revenue is ₦0 and wallet deposits are ₦10,000.
2. Given a direct to driver trip of ₦3,000, then trip value includes ₦3,000, driver earnings and collections do not.
3. Given package sales of ₦26,500, then revenue is ₦26,500 and driver earnings are unchanged.

---

## Open questions (finance)

| # | Question |
|---|---|
| F-Q1 | Passenger withdrawal of unused wallet funds: allowed, to which account, minimums, fees (brief §5; Q-032) |
| F-Q2 | Funding source for goodwill refunds |
| F-Q3 | Withdrawal review threshold (placeholder ₦100,000), minimum, schedule, fees (Q-031) |
| F-Q4 | Whether a provider reversal of a trip transfer may take driver earnings negative, or is absorbed by GoBye |
| F-Q5 | Settlement account owner and destination (Q-009) |
| F-Q6 | Whether to reserve wallet funds at booking (would need `passenger_wallet_reserve`; selector stays after the trip) |
| F-Q7 | Who bears the wallet funding fee (test data records a 1.5% fee on the collection but posts no fee journal) |
| F-Q8 | Hold period before transfer paid earnings become withdrawable |

## Inconsistencies found between the brief, decisions and code

| # | Where | Finding | Proposed resolution |
|---|---|---|---|
| F-1 | `types.ts` comment "+ increases the account" vs `mockPlatform.ts` | `promotions_expense` is posted negative when spent, but the package `processing_fee` journal posts `processing_costs` positive and `provider_clearing` negative, so the two expense accounts use opposite signs and the fee makes clearing look like more money received | Adopt §1.2 convention; fee journal = processing_costs −f, provider_clearing +f; update the comment |
| F-2 | `releaseWithdrawal` comment says "failed, rejected or reversed" | After a success the reserve is already empty; the mock correctly posts a separate `reversal` from `provider_clearing` | Fix the comment; use the reversal journal in flow (c) 5c |
| F-3 | `COLLECTION_FLOW` | `abandoned` and `failed` are final, but a provider can confirm money after we gave up | Allow `abandoned → successful` from a verified provider event only |
| F-4 | Rider app `TransferSheet` pays to the driver's payout account; D-030 says transfers "go straight to the driver" and "I’ve transferred" starts a check | Brief §5: a personal account cannot be verified automatically and must not credit withdrawable earnings. `API_CONTRACTS` §7 instead proposes a provider virtual account | Launch transfer payments through a GoBye collection account (flow b), keep direct to driver as flow (d) with its own record |
| F-5 | Mock sets `payment = 'paid'` for `directToDriver` trips | Unverifiable payment shown as paid; `TripPaymentState` has no direct state | Add `reported_direct` / `paid_direct` |
| F-6 | BR-106, D-023 and BACKEND_HANDOVER §5 say the wallet is checked before booking and charged automatically at trip end | D-030 and D-036 (later): no wallet check on pricing; "Choosing Wallet never charges; Pay ₦X does" | Follow D-030/D-036 and the brief; update BR-106 and API §7 rule text |
| F-7 | Rider wallet shows "reserved" | No reserve account in `LedgerAccount` | Keep at ₦0 until F-Q6 is decided |
| F-8 | Package prices: D-024 and API say ₦2,000 daily / ₦60,000 monthly; `cfg-pkg-1` and announcement test data say ₦1,500 / ₦25,000 | Provisional either way | Align test data with D-024 or record a new decision |
| F-9 | Test integration lists "Card and transfer collection" | D-023: no cards | Show cards as unused capability |
| F-10 | `API_CONTRACTS` `POST /driver/payouts` returns "Payout processing" | `WITHDRAWAL_FLOW` starts at `requested` and may need review | Return `requested`; driver copy follows statuses |
