# 07 · Payments setup and integrations

**Status:** Draft specification, 2026-10-21. PROPOSED. **No integration is live.** In the test dataset the payment test environment is `tested` and every other integration is `prototype` or `configured` (`mockPlatform.ts`). The provider decision is open (Q-042); "Paystack" in the test data is an example used to shape screens, not a selection.
**Source of truth for:** `/payments` (owner facing Payments setup), `/developer` (Integrations) and `/developer/events` (Events and failures).
**Read with:** [README.md](README.md) · [01-foundation.md](01-foundation.md) (staff, approvals, audit) · [02-oversight.md](02-oversight.md) (integration health on the overview) · [06-finance.md](06-finance.md) (ledger, flows, idempotency) · [09-connections.md](09-connections.md) (integration fails trigger) · [10-implementation-and-acceptance.md](10-implementation-and-acceptance.md).

Shared model in code: `IntegrationRecord`, `ConnectionState`, `IntegrationArea` (`types.ts`); `CONNECTION_FLOW`, `canGoLive` (`workflows.ts`); `APPROVAL_RULES.payments_activation` (`approvals.ts`); permissions `payments_setup.*`, `integrations.*`, `logs.view`.

---

## Part 1 · Rules that apply to every integration

### 1.1 Connection states (brief §10)

| State | Meaning | What dependent screens show |
|---|---|---|
| `prototype` | Screens work on simulated responses; nothing configured | "Simulated" badge on every affected screen in admin and apps |
| `configured` | Credentials or connection saved; not yet proven | "Not tested" |
| `tested` | Every required check passed in the **test** environment | "Tested. Not live." |
| `live` | Every required check passed in the **live** environment and activation approved | No badge |
| `degraded` | Was live; a check or health signal is failing | Honest unavailable or pending copy (see [09-connections.md](09-connections.md) "Integration fails") |

Transitions (`CONNECTION_FLOW`): `prototype → configured`; `configured → tested | prototype`; `tested → live | configured`; `live → degraded | configured`; `degraded → live | configured`.

### 1.2 Readiness rule

- `tested → live` requires `canGoLive(checks)` (at least one check, all passed) **for the live environment record**, and for payments an approved `payments_activation` request decided by the owner (never by the requester).
- `live → degraded` is set by the health job, never by hand. `degraded → live` happens automatically when all checks pass again.
- Any credential change (rotation, new key) moves the record back to `configured` until checks pass again; for a live payments record the rotation runs as a staged change: new credential tested in parallel, then swapped, so the record never leaves `live` without a working credential.
- Test and live are separate `IntegrationRecord`s (`environment: 'test' | 'live'`) with separate credentials, webhooks and checks. A test credential can never be saved on a live record (prefix and provider validation where the provider exposes it).

### 1.3 Payment verification requirements (server side)

1. **Payment success is decided server side.** A client tap, redirect or return URL never marks anything paid. The server confirms with the provider (signed event plus, where available, a status query for the reference) and checks amount, currency and reference before posting a journal.
2. **Signed webhook validation.** Every incoming provider event is validated against the provider's signature scheme using a secret held in protected server storage, before parsing the body for business use. Invalid signatures are rejected, stored as processing failures and alerted on.
3. **Duplicate event handling.** Events are deduplicated by provider event id and by business reference. Duplicates are stored (for the event history) and acknowledged, never re applied. Ledger idempotency by reference (06-finance §1.2) is the second guard.
4. **Separate events for payouts.** Transfer success, failure and reversal are processed as separate provider events (the brief cites Paystack as reporting these separately). "Submitted" is never treated as paid.
5. **Out of order events.** A later status never moves a record backwards: e.g. a failure arriving after a recorded success is stored and raised as a reconciliation exception, not applied.
6. **Raw storage.** Every event body is stored with receive time, signature result, processing result and the records it touched, retained per Q-016.

### 1.4 Switching provider

- Each `CollectionRecord`, `WithdrawalRecord`, refund and ledger entry keeps the `provider` and `reference` it was created with. Switching the active provider changes only where **new** payments go.
- The previous provider's live record stays connected for callbacks, status queries, refunds and payouts in flight until its open items reach a final state (`successful`, `failed`, `reversed`, `completed`, `rejected`) and the last settlement is reconciled. Only then can it be retired (state `configured`, webhooks kept for a grace period, placeholder 90 days).
- The switch is a `payments_activation` approval.

### 1.5 Secrets and infrastructure

- Secrets live only in protected server side storage (a secrets manager or encrypted configuration). They are never sent to the admin browser, the apps, logs or analytics. Supabase, for example, warns against exposing secret or service role keys in frontend code; the same rule applies to every provider.
- The UI shows a masked hint only (`credentialHint`, last 4), plus who changed it and when (`credentialRotatedAt`). Entering a secret is write only: after saving, it cannot be read back.
- Every change (secret saved, rotated, webhook URL changed, state change, activation) writes an `AuditEvent` with a masked diff (`from: '••••91c0', to: '••••7f2a'`).
- Database administration and migrations happen only through controlled deployment (reviewed migration files, applied by the release pipeline, with backup first). There is no settings form to change the database connection or run migrations; `/developer` shows database health and migration version read only.

---

## Module A · Payments setup (`/payments`)

### 1. Users and permissions

| Role | Keys | Can do |
|---|---|---|
| Company owner | `payments_setup.view`, `payments_setup.approve`, `approvals.decide` | Choose provider, review settlement destination, approve activation, test/live changes, provider switch |
| Accounting and finance | `payments_setup.view` | Read status, capabilities, settlement destination, problems |
| Developer | `payments_setup.view` (+ `integrations.*` on `/developer`) | Read; request activation from `/developer` |
| Auditor | `payments_setup.view` | Read |

### 2. Screens and navigation

`/payments` (single page, business language, no credentials):
1. **Status summary**: one line per environment: "Test: Tested. Not live." / "Live: Not set up".
2. **Provider choice**: cards for supported, implemented providers only (a provider appears once its adapter is built and has passed test checks). Each shows collection and payout capabilities.
3. **Capabilities**: table of what GoBye needs vs what the provider offers: wallet funding collection, trip transfer collection (collection account per payment), driver payouts, refunds, settlement reports. Unused capabilities shown as "Not used" (cards, D-023).
4. **Onboarding and connection**: provider business verification steps (from the live record's checks), each with owner and status.
5. **Settlement destination**: bank, masked account number, account name, confirmed by, confirmed at.
6. **Approvals**: pending `payments_activation` requests with Approve / Reject.
7. **Problems**: actionable list (A9).

Links: "Technical details" → `/developer?id=int-pay-live` (if the viewer has `integrations.view`).

### 3. Fields and data source

| Field | Source |
|---|---|
| Provider, environment, state | `IntegrationRecord` where `area = 'payments'` |
| Capabilities | `capabilities[]` vs required list (proposed constant) |
| Onboarding steps | `checks[]` of the live record (`name`, `passed`, `detail`) |
| Last successful test | `lastSuccessfulTestAt` |
| Failures | `failures[]` (unresolved count) |
| Settlement destination | Proposed `IntegrationRecord.settlement { bankName, accountNumberMasked, accountName, confirmedBy, confirmedAt }` (not in code) |
| Pending approvals | `ApprovalRequest` kind `payments_activation` |
| Open items per provider | Counts of collections `pending`, withdrawals `processing`, refunds `processing` by `provider` |
| Processing fee rules | Payments config (`MOCK_PAYMENTS_CONFIG.processingFees`, placeholders) shown read only; changes through [04-configuration.md](04-configuration.md) |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Choose provider for new payments | `payments_setup.approve` | Yes (`payments_activation`, owner; requester cannot approve, so a developer or second owner requests) | Sets active provider once approved; old provider stays for open items |
| Approve live activation | `payments_setup.approve` | Is the approval | Allowed only if `canGoLive(live.checks)`; moves `tested → live` |
| Approve test ↔ live change | `payments_setup.approve` | Is the approval | Switches which environment the apps use |
| Change settlement destination | `payments_setup.approve` | Yes (`payments_activation`) | New destination effective after approval and provider confirmation |
| Reject | `payments_setup.approve` | n/a | Reason required |

### 5. Validation and approval rules

- Approve live is disabled with the reason listing failing checks, e.g. "2 checks not passed: Settlement account confirmed, Live webhook configured."
- A provider without an implemented adapter cannot be chosen ("Not supported yet").
- Settlement destination must be in the legal entity's name (Q-009); name enquiry result shown before approval.
- Retiring a provider is blocked while it has open items: "12 payments still pending with this provider."

### 6. Status transitions

`CONNECTION_FLOW` for each record; approvals `pending → approved | rejected`.

### 7. Effects on other screens and apps

| Change | Effect |
|---|---|
| Payments go live | Rider R22 Add money, R29 payment and driver D15 lose their "Simulated" labels; `/overview` integration health green |
| Payments degraded | Rider: "Add money is unavailable right now"; trip payments stay `pending` with "Payment not confirmed yet"; driver: "Withdrawals are delayed"; finance banner |
| Provider switched | New collections use the new provider; existing records unchanged |

### 8. Notifications and background jobs

Owner notified of new `payments_activation` requests and of `degraded`. Jobs: `integrations.health-check` (scheduled checks), `payments.open-items` (counts per provider for retirement).

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | "Loading payment setup" |
| Empty | "No payment provider is set up. Ask your developer to connect one in Integrations." |
| Pending | "Waiting for your approval" / "Waiting for provider verification" |
| Problems (examples) | "Business verification incomplete. Upload CAC documents with the provider." · "Live webhook not configured. Your developer needs to add it." · "Settlement account not confirmed." · "Webhook signature checks failing since 14:05. Payments may stay pending." |
| Error | "Couldn’t load provider status. Showing the last known state from 10:40." |
| Success | "Live activation approved. New payments use the live provider." |
| Prototype | Banner: "Prototype. No provider is connected and no money moves." |

### 10. Acceptance checks

1. Given the live record has a failing check, when the owner opens the approval, then Approve is disabled and the failing checks are named.
2. Given a developer requested activation, when the same developer opens it, then they cannot approve.
3. Given all live checks pass and the owner approves, then the state becomes `live`, an audit event exists, and dependent screens drop the "Simulated" label.
4. Given provider B becomes active while provider A has 3 pending collections, then those collections still resolve through provider A's webhooks and show provider A.
5. Given a finance user, then the page is readable and no action is available.
6. Given any screen on `/payments`, then no secret or full account number is present in the page or its network responses.

**Backend needs.** Commands `RequestPaymentsActivation {integrationId, change}`, `DecideApproval`, `SetSettlementDestination` (via approval); events `integration.activation_requested`, `integration.activated`, `payments.provider_switched`, `payments.settlement_destination_changed`.
**Open question:** settlement account owner and bank (Q-009, Q-042).
**Open question:** which providers will have adapters at launch (Q-042).

---

## Module B · Integrations (`/developer`)

### 1. Users and permissions

| Role | Keys | Can do |
|---|---|---|
| Developer | `integrations.view`, `integrations.configure`, `integrations.secrets`, `logs.view` | Configure, enter or rotate secrets, run tests, request activation |
| Company owner | `integrations.view`, `logs.view` | Read; approve payments activation on `/payments` |
| Auditor | `integrations.view`, `logs.view` | Read |
| Driver onboarding | none (owner of identity checks integration in test data; proposed: grant `integrations.view` for that record only) | |

### 2. Screens and navigation

`/developer`: inventory table (Part 2) with state pills; badge = `degraded` count. Row → integration page `/developer?id=int-…` with tabs **Overview** (owner, environment, state, capabilities, depends on, used by), **Configuration** (non secret settings, masked secrets, webhook/callback URLs), **Checks** (list with Run), **Failures** (history), **Events** (filtered `/developer/events`). Environment switcher Test | Live on paired records.

### 3. Fields and data source

`IntegrationRecord`: `id`, `area`, `provider`, `environment`, `state`, `owner`, `capabilities`, `credentialHint`, `credentialRotatedAt`, `lastSuccessfulTestAt`, `checks[]`, `failures[]`, `dependsOn[]`, `usedBy[]`. Proposed: `webhookUrl`, `callbackUrl`, `webhookSecretHint`, `config` (non secret key value), `healthSignals` (error rate, latency, last event at).

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Save configuration (non secret) | `integrations.configure` | No | Audit with diff; state → `configured` if it changes behaviour |
| Enter or connect credentials | `integrations.secrets` | No | Write only to server storage; hint stored; `prototype → configured` |
| Rotate credential | `integrations.secrets` | No (payments live: staged, see 1.2) | New hint, `credentialRotatedAt`; checks rerun |
| Copy webhook URL | `integrations.view` | No | |
| Run connection test | `integrations.configure` | No | Runs checks; on all pass in test: `configured → tested` |
| Send test event | `integrations.configure` | No | Provider test event; verifies signature and processing |
| Request live activation | `integrations.configure` | Yes (payments: owner via `/payments`; other areas: proposed owner approval for anything that sends to real users, e.g. SMS) | Creates `ApprovalRequest` |
| Disable integration | `integrations.configure` | Payments: yes | `→ configured`; dependent features show unavailable |
| Mark failure resolved | `integrations.configure` | No | Note required |

### 5. Validation and approval rules

- Secrets: never echoed; minimum shape validation; test keys refused on live records.
- Webhook URL must be HTTPS and on the GoBye API domain.
- A live record cannot be deleted; only disabled.
- Maps keys: platform restrictions required (iOS bundle id, Android package + SHA-1) before test passes (D-025).

### 6. Status transitions

`CONNECTION_FLOW`, with `degraded` set only by the health job.

### 7. Effects on other screens and apps

Each integration's `usedBy` lists the screens that must show an honest state; see the inventory table and [09-connections.md](09-connections.md).

### 8. Notifications and background jobs

Jobs: `integrations.health-check` (per integration schedule, placeholder 5 min for live), `integrations.credential-expiry` (reminds 30 days before a known expiry), `webhooks.process` (queue), `webhooks.retry-processing`. Alerts to the integration owner and `developer` role on: state `degraded`, signature failures, processing failure rate above threshold, queue backlog.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | "Loading integrations" |
| Empty config | "Not set up. Choose a provider and add its credentials." |
| Pending test | "Running checks" (per check spinner with label) |
| Check failed | "Webhook signature verified: failed. The signing secret doesn’t match. Rotate it with the provider and save it here." |
| Error saving secret | "Couldn’t save the key. Nothing was changed." |
| Success | "Key saved. Ending ••••7f2a." · "All checks passed. Test environment is ready." |
| Prototype | "Prototype. This integration is not connected." |

### 10. Acceptance checks

1. Given a developer saves a secret, then the response and the page contain only the masked hint and an audit event with a masked diff exists.
2. Given an auditor, then all integration pages are readable and no input is enabled.
3. Given a live payments record and a failing signature check, then the state becomes `degraded` within one health cycle and the overview shows an integration alert.
4. Given a test credential pasted into a live record, then saving is refused.
5. Given all checks pass in test, then the state is `tested` and never `live` without activation.
6. Given a database integration, then no control exists to change the connection or run a migration.

**Backend needs.** Commands `SaveIntegrationConfig`, `SetIntegrationSecret`, `RotateIntegrationSecret`, `RunIntegrationChecks`, `SendTestEvent`, `RequestIntegrationActivation`, `DisableIntegration`; events `integration.configured`, `integration.credential_rotated`, `integration.check_failed`, `integration.tested`, `integration.degraded`, `integration.recovered`.

---

## Module C · Events and failures (`/developer/events`)

### 1. Users and permissions

View: `logs.view` (developer, owner, auditor). Retry processing: `integrations.configure`.

### 2. Screens and navigation

Event stream with filters: integration, environment, direction (incoming webhook, outgoing call, job), result (`processed`, `duplicate`, `rejected_signature`, `failed`, `retrying`), reference, date. Event drawer: headers (signature redacted), body (personal data masked), processing steps, records touched (links to collection, withdrawal, refund, ledger journal), retries.

### 3. Fields and data source

Proposed `ProviderEvent { id, integrationId, providerEventId, type, receivedAt, signatureValid, duplicateOf?, result, error?, attempts, touched: {type, id}[] }`. Today the only trace is `CollectionRecord.events[]` and `WithdrawalRecord.history[]` in the test data.

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Retry processing | `integrations.configure` | No | Re-runs processing of a stored, signature valid event; idempotent |
| Mark ignored | `integrations.configure` | No | Reason required |
| Open linked record | per record | No | |

There is no action to inject, edit or replay an event body by hand.

### 5. Validation and approval rules

Retry only for `failed` events with a valid signature. Rejected signature events cannot be retried; the fix is the secret.

### 6. Status transitions

Proposed: `received → processed | duplicate | rejected_signature | failed`; `failed → retrying → processed | failed`.

### 7. Effects on other screens and apps

Processed events drive the flows in [06-finance.md](06-finance.md); failures surface on the affected record ("Provider update failed to process. Developer notified.").

### 8. Notifications and background jobs

`webhooks.retry-processing` (backoff placeholder 1, 5, 30 min, then alert); `notifications.send` failures also appear here (email, SMS, push).

### 9. Loading, empty, pending, error and success states

Empty: "No events for these filters." Pending: "Retrying (attempt 2 of 4)". Error: "Processing failed: amount does not match the collection." Success: "Processed. Wallet credited once."

### 10. Acceptance checks

1. Given the same provider event delivered twice, then two rows exist, the second marked `duplicate`, and one ledger journal.
2. Given an event with an invalid signature, then it is `rejected_signature`, touches no record, and an alert is raised.
3. Given a failed event retried after a fix, then it processes once and links to the journal.
4. Given an auditor, then bodies are readable with personal data masked and Retry is absent.

**Backend needs.** `provider_events` table (append only), webhook endpoint `POST /webhooks/payments/{provider}` (API_CONTRACTS §7) generalised to `/webhooks/{area}/{provider}`; events `provider_event.received`, `provider_event.duplicate`, `provider_event.rejected`, `provider_event.failed`.

---

## Part 2 · Integration inventory

Owner, environment and state below are the **test data** values (`mockPlatform.ts`); they are placeholders for real assignments. "Last successful test" and "Failure history" are from the same data. Nothing is live.

| Area (id) | Provider (status) | Configuration and visibility needed | Owner | Environment · State | Last successful test | Failure history | Depends on | Used by |
|---|---|---|---|---|---|---|---|---|
| Payments and payouts (`int-pay-test`, `int-pay-live`) | Example: Paystack (open, Q-042) | Provider status, test and live environments, references, webhook URL and signing secret, events, errors, settlement destination, capabilities | Developer (Sani) | Test: `tested` · Live: `prototype` | Test: 2 h before dataset time · Live: never | One resolved signature mismatch (fixed by rotation) | Database, Background jobs | Wallet funding, trip payments, driver packages, withdrawals, refunds |
| Email (`int-email`) | Not chosen | Sender identity and domain authentication, templates (receipts, staff invites, announcements), delivery events, bounces, failures | Developer | test · `prototype` | Never | None | Background jobs | Receipts, staff invites, announcements |
| SMS / OTP (`int-sms`) | Not chosen | Sender ID approval, OTP flow (rate limits, BACKEND_HANDOVER §12), delivery status, usage and cost | Developer | test · `prototype` | Never | None | Auth, Background jobs | Phone sign in, announcements, safety responder fallback (proposed) |
| Push (`int-push`) | Expo push (proposed, Q-014) | iOS and Android app credentials, device tokens (`POST /devices`), delivery attempts and receipts | Developer | test · `configured` (Android check passed, iOS not) | Never (all checks) | None | Background jobs | Trip updates, payments, announcements, safety |
| Maps, search, routes (`int-maps`) | Google Maps Platform (proposed, D-025) | Approved keys with platform and API restrictions, server side Places/Routes keys, search and routing health, usage and budget alerts (Q-044) | Developer | test · `prototype` | Never | None | none | Search, pricing, live trip map |
| Authentication (`int-auth`) | Not chosen (phone + OTP proposed, D-008) | Enabled methods, session and refresh policies, staff sign in and 2 step requirement for admin, authentication failures | Developer | test · `prototype` | Never | None | SMS, Database | Rider app, driver app, admin |
| Database (`int-db`) | Not chosen | Connection health, migration version (read only), backups and restore tests, job health. No switching from a form | Developer | test · `prototype` | Never | None | none | Everything |
| File storage (`int-storage`) | Not chosen | Buckets for driver documents (restricted, encrypted, access logged), avatars, receipts, case attachments; signed URL expiry; access rules | Developer | test · `prototype` | Never | None | Database | Driver documents, avatars, receipts, case attachments |
| Monitoring (`int-mon`) | Not chosen | App crash reports, backend errors, performance, alert routing, on call | Developer | test · `prototype` | Never | None | none | All apps and backend |
| Background jobs (`int-jobs`) | Not chosen | Queues, retries, dead letter, schedules (announcements, campaigns, package expiry, reconciliation, settlements import) | Developer | test · `prototype` | Never | None | Database | Every job named in 05, 06, 07, 09 |
| Identity checks (`int-idv`) | Not chosen, optional (Q-009) | Provider connection, verification results per driver, cost | Driver onboarding (Tobi) | test · `prototype` | Never | None | File storage | Driver verification |

Every row needs, before launch: a named human owner, both environments where applicable, a health check, a recorded last successful test, failure history, and its dependencies listed. The overview ([02-oversight.md](02-oversight.md)) shows any `degraded` row as an alert.

---

## Inconsistencies found

| # | Finding |
|---|---|
| P-1 | `int-pay-test` capabilities include "Card and transfer collection" although cards are out of scope (D-023). Show as "Not used". |
| P-2 | `IntegrationRecord` has no settlement destination, webhook URL or event history fields; the brief requires them. Proposed fields above. |
| P-3 | The identity checks integration is owned by an onboarding user who has no `integrations.view`, so the owner cannot see their own record. |
| P-4 | `ApprovalKind` covers `payments_activation` only; activating SMS or email to real users has no approval kind. Proposed: reuse `payments_activation` renamed `integration_activation`, or add a kind. |

## Update 2026-10-23 (D-054, D-055)

Payment providers now sit behind a provider-independent adapter. Wallet funding and withdrawal fees are versioned schedules, and the payments workspace has four screens (providers, fees, gateway health, payment operations). Background workflows live in the Automation Centre. See `docs/PAYMENTS_AUTOMATION_ARCHITECTURE.md`.
