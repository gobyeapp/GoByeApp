# Payment configuration and automation architecture (D-054, D-055)

Owner brief: "GoBye — Payment Configuration and Automation Architecture Update" (2026-10-23).

**Status in one line:** the provider-independent contracts, fee rules, money-movement guards and automation
registry are implemented and tested in `@gobye/core`, and the admin has working screens on test data.
**Nothing is live.** No payment provider is selected (Q-042), no backend or job runner exists (Q-064),
and no fee amount has been set or approved.

---

## 1. Audit: what existed before

| Area | Found | Gap closed here |
|---|---|---|
| Payment methods | `MOCK_PAYMENTS_CONFIG`: wallet + bank transfer, per-method fee rule (placeholder) | Fees moved to versioned schedules with approval |
| Driver packages | `DRIVER_ACCESS_PACKAGES` ₦2,000 / ₦60,000, marked provisional | **Confirmed** (owner, 2026-10-23); `provisional: false` |
| Commission | 0% (BR-060, D-024) | Unchanged |
| Provider | Paystack planned; `PaymentsSetup` readiness, live activation needs owner approval | Adapter contract; capability coverage; safe switching |
| Ledger | Double entry, idempotent by reference; separate wallet, earnings, reserve, revenue, clearing, costs, suspense | New `fee_income` account; full breakdown journal |
| Ledger bug | Provider fees were posted with signs reversed (costs +, clearing −), so each fee *added* to what the provider owed GoBye | **Fixed:** costs −, clearing + (mock data and the admin's package-collection path) |
| Webhooks | Duplicates recorded, never re-applied; events page with retry | Intake rule: event id dedupe, event only triggers a lookup |
| Background work | Listed as "jobs: not chosen" integration; no registry | Automation Centre registry, run model, retry rules |
| Approvals | 7 kinds | + `fee_schedule`, `automation_config`, `gateway_switch` |

## 2. Payment gateway adapters (`packages/core/src/gateway/adapter.ts`)

`PaymentGatewayAdapter` is the only way the backend talks to a provider:

- `initializeCollection(req)`: get payment instructions (virtual account or bank transfer) for **our** reference and the quoted amount.
- `verifyCollection(reference)`: server-to-server lookup. This is **the only thing that can confirm a payment**.
- `createTransfer(req)` / `getTransfer(reference)`: payouts are idempotent by our reference, and a payout can be looked up.
- `parseWebhook({ rawBody, headers })`: checks the signature, then normalises the event. Unsigned events are rejected.

Required capabilities (`REQUIRED_CAPABILITIES`):
- bank-transfer collection
- bank-transfer payout
- webhook signatures
- transaction lookup
- bank account resolve

Cards are out of scope (D-023). `missingCapabilities()` tells the admin what an adapter can't do yet.

Errors carry a class:
- `transient`: retry later.
- `permanent`: fix first.
- `unknown_outcome`: the request may have been processed, so never retry it; look it up by reference.

`createSimulatedGateway()` is the only implementation. It is labelled `simulated: true` and used by tests and the
prototype. A real adapter is written once Q-042 is decided, and must pass the same tests.

**Credentials:**
- Adapters run only on the server and read keys from the backend secret store (Cloudflare `wrangler secret put` or the chosen backend's store).
- Keys never appear in app or admin code, `EXPO_PUBLIC_*` / `VITE_*` variables, `.env.example`, settings screens or git (CLAUDE.md, D-051).
- The admin shows a masked hint (last 4) only. `npm run check:env` rejects secret-shaped values in public variables.

## 3. Fee schedules (`gateway/fees.ts`)

Confirmed pricing stays outside fee schedules and is not configurable here:
- daily package ₦2,000 for 24 hours from successful activation;
- monthly package ₦60,000 for 30 consecutive days;
- trip commission 0%.

Wallet funding and withdrawal fees are **configurable**:

```text
FeeSchedule { id, version, status: draft | pending_approval | scheduled | active | superseded | rejected,
              effectiveFrom, rules[], note, createdBy, createdAt, approvedBy?, approvedAt? }
FeeRule     { operation: wallet_funding | withdrawal, provider: '<key>' | '*',
              gobyeFee: FeeFormula | null,              // null = Not set → operation blocked
              providerChargeEstimate: FeeFormula | null,// for disclosure only; actual comes from provider
              providerChargeBearer: customer | gobye,
              collection: add | deduct,                 // added on top, or taken from the amount
              limits: { min, max, dailyMax? },
              exemptions: [ free_per_month{count} | at_or_below{amount} ] }
FeeFormula  { fixed: kobo, percentBps, min?, cap? }      // integer kobo and basis points only
```

Rules:
1. **Not set means blocked.** `quoteFee()` refuses (`fee_not_set`) when GoBye's fee is `null`. It also refuses with no provider selected, no approved schedule, or outside the limits. Nothing is charged by accident, and no amount is ever guessed.
2. **Versioned and dated.**
   - Finance (`fees.edit`) prepares a draft. `validateSchedule()` requires a future start date, no duplicate rules, non-negative values and sensible limits.
   - Sending the draft creates a `fee_schedule` approval. Only the owner decides, never the person who prepared it.
   - On approval the schedule is `scheduled`; `activateDueSchedules()` makes it `active` on its date and supersedes the previous one.
   - `scheduleInForce()` picks the version for any date, so a fee never applies early or to the past.
3. **Disclosure before confirmation.** Every quote returns these lines to show before the customer confirms (BR-105):
   - the GoBye fee;
   - the provider charge, when the customer pays it;
   - the total the customer pays;
   - the amount that arrives.
4. Provider-specific rules override the `'*'` rule.
5. Starting data: a draft with **every fee Not set** and placeholder limits (Q-073). The dataset test asserts that no amount is invented.

## 4. Money movement and its guards (`gateway/money-movement.ts`)

Each payment is recorded as separate figures:
- gross
- provider charge
- GoBye fee
- wallet or earnings movement
- settlement (gross − provider charge)

`fundingJournalLines()` posts each figure to its own account in one balanced journal:

| Figure | Account | Sign |
|---|---|---|
| Wallet credit | `passenger_wallet` | + |
| GoBye fee | `fee_income` (new) | + |
| Provider charge GoBye absorbs | `processing_costs` | − |
| Expected settlement | `provider_clearing` | − |
| Any gap between the estimate and the actual charge | `suspense` | for finance to look at |

Sign convention: balances owed to people and income are positive; costs and amounts owed by the provider are negative.

| Risk | Guard |
|---|---|
| Unverified confirmation | `decideFundingCredit()` credits only after `verifyCollection` says successful **and** the amount and currency equal the quote. A webhook alone → `wait`; a mismatch → `investigate` (finance). |
| Duplicate credit | Ledger idempotency by provider reference (`postJournal`), plus an `already_credited` check; duplicate webhooks are dropped by event id (`webhookIntake`). |
| Duplicate debit or payout | `payoutGuard()`: no transfer before approval, never while one is processing or already paid, and an **unknown outcome must be looked up first**. Transfers use the withdrawal id as the provider idempotency key. |
| Unsafe gateway switching | `switchReadiness()` requires all of: new provider **live**, every required capability, current provider reconciled, owner approval (`gateway_switch`). Payments in flight **drain** on the old provider, whose webhooks and lookups keep working. |
| Silent retry of money | Financial runs with an unknown outcome become `needs_lookup`; they never retry automatically (§5). |

## 5. Automation Centre (`packages/core/src/automation/`)

`AUTOMATIONS` (registry.ts) declares every background workflow. Each definition has:
- name and purpose, area;
- trigger type (event, schedule, webhook, condition), source and conditions;
- server action steps;
- financial flag and idempotency key;
- retry policy, timeout and escalation;
- owner role, configurable parameters (with bounds and a placeholder/confirmed flag);
- manual retry rule and runtime state.

Every definition runs on the **server only** and is **`not_connected`** today.

| Workflow | Trigger | Money | Owner |
|---|---|---|---|
| Activate driver package | payment verified | yes | finance |
| End expired driver access | every minute | no | operations |
| Package renewal reminders | every 15 min | no | marketing |
| Credit wallet funding | webhook / poll → lookup | yes | finance |
| Send driver withdrawal | withdrawal approved | yes | finance |
| Payment webhook intake | provider webhook | yes | developer |
| Daily reconciliation | daily 02:00 WAT | yes | finance |
| Driver document expiry | daily 06:00 WAT | no | onboarding |
| Expire unmatched bookings | booking timer | no | operations |
| Expire fare offers | offer timer | no | operations |
| Support case escalation | every 5 min | no | care |
| Safety event escalation | safety reported | no | safety |
| Infrastructure alerts | health and error rates | no | developer |

**Runs** (runs.ts): a run moves through these statuses:
- `queued` → `running` → `succeeded`
- `retry_scheduled`
- `failed`
- `needs_lookup`
- `cancelled`

Each run keeps its attempts, failure class, idempotency key, escalation and who handled it.

**Retry policy:**
- `classifyFailure()` treats anything that may have reached the provider in financial work as `unknown_outcome`.
- `afterFailure()` retries **transient** failures only. Delay comes from `retryDelay()`: exponential backoff with ±20% jitter, capped.
- Permanent failures stop as `failed`. Unknown outcomes stop as `needs_lookup`.
- `shouldEscalate()` fires immediately for financial workflows, otherwise after N consecutive failures.

**Protected manual actions** (`manualActionCheck`, which needs `automation.retry`):
- A **succeeded run is never replayed**, financial or not. A new run must come from a new event.
- `needs_lookup` → only **Look up** (ask the provider by reference); Retry is refused.
- Failed financial runs whose last failure was a timeout or unknown outcome → Retry refused.
- Retry of a failed run keeps the **same idempotency key**, needs a reason and is audited.
- Workflows marked `not_allowed` (fare offer expiry) are never retried by hand.

**Settings** (settings.ts): parameters change only within the registry's bounds (`validateParamChange`), with a reason. A change creates an `automation_config` approval (owner or admin, never the requester). `paramValue()` returns the approved value in force. Every value is a **placeholder** until the owner confirms it.

## 6. Admin screens (prototype on test data)

| Group | Route | Purpose |
|---|---|---|
| Payments | `/payments` | Payment providers: readiness, live activation, adapter contract and capability coverage, safe switch panel, secrets notice |
| Payments | `/payments/fees` | Fee configuration: schedule in force (or "none approved"), versions, finance draft editor, customer disclosure preview, confirmed pricing card |
| Payments | `/payments/health` | Gateway health: connection, webhook deliveries and duplicates, money in flight, last reconciliation; response time and uptime say "Needs monitoring (not connected)" |
| Payments | `/payments/operations` | Payment operations: every collection and withdrawal with the five figures apart, stuck items, the safety rule per row |
| Automation | `/automation` | Workflow registry |
| Automation | `/automation/schedules` | Scheduled jobs (Lagos time; "Not scheduled: no job runner" unless a queued run exists) |
| Automation | `/automation/runs` | Execution history with attempt timelines |
| Automation | `/automation/failed` | Failed jobs: unknown results first; Retry, Look up and Cancel follow the protected rules |
| Automation | `/automation/settings` | Automation settings with approval |
| Automation | `/automation/audit` | Audit history for automation, fee and provider changes |

Every automation page states that no job runner is connected and that run history is simulated. Actions in
the prototype only record the request (for example, Look up cannot reach a provider).

**Permissions:**

| Permission | Holders |
|---|---|
| `fees.edit` | finance |
| `automation.view` | owner, admin, operations, finance, developer, auditor |
| `automation.configure` | developer (plus the workflow's owner role when proposing) |
| `automation.retry` | finance, developer |

Decisions sit with the owner (fees, switch) or the owner/admin (automation settings). The backend must
enforce the same table (`permissions.ts` is the single source); the UI only reflects it.

## 7. Backend contract (to build once Q-042 and Q-064 are decided)

1. A **job runner with a durable queue** (e.g. queues + cron triggers on the chosen platform). It runs the registry exactly, with per-run idempotency keys and a run table matching `AutomationRun`.
2. **Payments service:**
   - one adapter per provider;
   - `POST /v1/payments/quotes` returns a `FeeQuote`;
   - `POST /v1/wallet/fundings` takes a quote id and returns instructions;
   - `POST /v1/webhooks/{provider}` (signature, store, dedupe, queue a lookup);
   - `POST /v1/withdrawals/{id}/payout` (approved only, idempotent);
   - lookup endpoints for staff.
3. **Ledger writes in one database transaction** with the run's idempotency key: credit + collection status, or reserve → payout → settle/release.
4. **Daily reconciliation** against the provider report. Differences become items for people; corrections need two people.
5. Fee schedule and automation settings stored as versioned rows with approvals, read by the quote endpoint and the runner.

## 8. Implementation checklist

- [x] Audit existing payments, ledger, approvals and docs
- [x] Fix the provider fee sign bug in the ledger
- [x] Confirm package prices in code, copy and docs (₦2,000 / 24 h, ₦60,000 / 30 days, 0% commission)
- [x] Gateway adapter contract + simulated adapter + capability check
- [x] Versioned fee schedules: quote, disclosure, limits, exemptions, validation, approval, activation
- [x] Separate money figures + balanced breakdown journal + `fee_income` account
- [x] Guards: verified credit, duplicate credit/debit, payout lookup-first, webhook dedupe, safe switching
- [x] Automation registry (13 workflows), run model, failure classes, backoff, escalation, protected manual actions, bounded settings with approval
- [x] Permissions and approval kinds (`fee_schedule`, `automation_config`, `gateway_switch`)
- [x] Admin: 4 payments screens, 6 automation screens, with loading/empty/error/permission/not-connected states
- [x] Tests: core 241 (26 new), admin 326 (63 new); QA at 1440/1024/768/375, light and dark
- [ ] Choose provider (Q-042) and write its adapter against these tests
- [ ] Choose backend and job runner (Q-064, Q-074); implement §7
- [ ] Owner sets fee values and who bears provider charges (Q-073); approve a schedule
- [ ] Confirm automation timings (placeholders) and package renewal behaviour (Q-043)
- [ ] Test webhooks, payouts and reconciliation end to end in the provider's test mode before any live money
