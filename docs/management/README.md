# GoBye management platform: specification

> **Status (2026-10-21):** specification for the staff web app in `apps/admin`. The backend does not exist. Every screen runs on the deterministic test dataset in `packages/core/src/platform/mockPlatform.ts` with simulated latency and failures. Nothing described here is live, connected to a provider, or tested on devices. Numbers marked *placeholder* are not business policy.

## 1. Purpose

The owner asked for a complete dashboard specification before the backend exists (owner brief 2026-10-21, §10). This folder is that specification. It is the **source of truth** the prototype screens follow and the contract the backend will implement. Where a screen and this document disagree, the screen is wrong; where this document and the code in `packages/core/src/platform/` disagree, the difference is listed as an inconsistency and resolved by a decision, not silently.

It answers, for every module: who can use it, what it shows, where each field comes from, what can be changed, by whom, with whose approval, which status changes are allowed, what else changes as a result, which jobs and notifications run, what every state looks like, and how to check it works.

## 2. One platform, separate workspaces

GoBye has **one** management platform. Teams work in **separate workspaces** that read and change the **same records** by the same ids. A workspace is a set of screens and permissions, never a separate copy of the data.

Staff roles are **permission groups** (brief §1). One person may hold several roles; their access is the **union** of those roles' permissions, never a merged super role (`permissionsOf` in `permissions.ts`). See [01-foundation.md](01-foundation.md#2-permission-groups).

### 2.1 Workspace map

| Workspace | Primary users (roles) | Homepage route (`ROLE_HOME`) | Other routes | Main records |
|---|---|---|---|---|
| Oversight | Company owner (`owner`), Auditor (`auditor`) | `/overview` (owner), `/audit` (auditor) | `/approvals`, `/staff`, `/reports` | All, read; `approval`, `staff`, `audit` |
| Administration | Platform administrator (`admin`) | `/overview` | `/passengers`, `/drivers`, `/trips`, `/config/*` | `passenger`, `driver`, `trip`, `config` |
| Operations | Operations and dispatch (`operations`) | `/live` | `/trips`, `/drivers`, `/passengers` | `trip`, `driver` |
| Driver onboarding | Driver onboarding (`onboarding`) | `/drivers` | | `driver` |
| Customer care | Customer care (`care`) | `/cases` | `/passengers`, `/drivers`, `/trips`, `/finance/*` (read) | `case`, `trip`, `refund` |
| Safety | Safety (`safety`) | `/safety` | `/trips`, `/passengers`, `/drivers` | `case` (team `safety`), `trip` |
| Finance | Accounting and finance (`finance`) | `/finance/collections` | `/finance/*`, `/reports`, `/approvals` | `collection`, `ledger_entry`, `withdrawal`, `refund` |
| Growth | Marketing and partnerships (`marketing`) | `/comms` | `/promos`, `/events`, `/config/referrals` | `announcement`, `campaign`, `event` |
| Technical | Developer and technical (`developer`) | `/developer` | `/developer/events`, `/payments` | `integration` |

The sidebar is generated from `NAV` in `apps/admin/src/nav.tsx`: an item shows only if the staff member holds one of its `anyOf` permissions, so a link is never shown for a page the person cannot open.

### 2.2 Module to file index

| Module | Route | Spec |
|---|---|---|
| Owner overview | `/overview` | [02-oversight.md](02-oversight.md#module-owner-overview) |
| Approvals | `/approvals` | [02-oversight.md](02-oversight.md#module-approvals) |
| Staff and access | `/staff` | [02-oversight.md](02-oversight.md#module-staff-and-access) |
| Activity and audit | `/audit` | [02-oversight.md](02-oversight.md#module-activity-and-audit) |
| Reports | `/reports` | [02-oversight.md](02-oversight.md#module-reports) (details in [06-finance.md](06-finance.md)) |
| Passengers | `/passengers` | [03-operations.md](03-operations.md#module-passengers) |
| Drivers and verification | `/drivers` | [03-operations.md](03-operations.md#module-drivers-and-verification) |
| Trips | `/trips` | [03-operations.md](03-operations.md#module-trips) |
| Live operations | `/live` | [03-operations.md](03-operations.md#module-live-operations) |
| Service areas | `/config/areas` | [04-configuration.md](04-configuration.md#module-service-areas) |
| Vehicle categories | `/config/categories` | [04-configuration.md](04-configuration.md#module-vehicle-categories) |
| Fare settings | `/config/fares` | [04-configuration.md](04-configuration.md#module-fare-settings) |
| Driver packages | `/config/packages` | [04-configuration.md](04-configuration.md#module-driver-packages) |
| Rewards and referrals | `/config/referrals` | [04-configuration.md](04-configuration.md#module-rewards-and-referrals) |
| Events (configuration) | `/events` | [04-configuration.md](04-configuration.md#module-events) |
| Support cases, Safety | `/cases`, `/safety` | [05-care-safety.md](05-care-safety.md) |
| Collections, wallets, earnings, withdrawals, refunds, settlements, reconciliation, ledger | `/finance/*` | [06-finance.md](06-finance.md) |
| Payments setup, Integrations, Events and failures | `/payments`, `/developer`, `/developer/events` | [07-payments-and-integrations.md](07-payments-and-integrations.md) |
| Announcements | `/comms` | [08-growth.md](08-growth.md#module-announcements) |
| Promotions | `/promos` | [08-growth.md](08-growth.md#module-promotions) |
| Referral campaigns | `/config/referrals` (performance tab) | [08-growth.md](08-growth.md#module-referral-campaigns) |
| Event partnerships (marketing) | `/events` | [08-growth.md](08-growth.md#module-event-partnerships) |
| Cross workspace connections | | [09-connections.md](09-connections.md) |
| Implementation order and acceptance | | [10-implementation-and-acceptance.md](10-implementation-and-acceptance.md) |

## 3. Shared records and ids

Every record has one id, used in every workspace, the rider app, the driver app and the backend. Record types are the `RecordType` union in `packages/core/src/platform/types.ts`:

| `RecordType` | Record (type) | Id pattern in test data | Owned by (writes) | Read by |
|---|---|---|---|---|
| `passenger` | `PassengerRecord` | `pas-0001` | Rider app, Administration, Safety | Care, Operations, Finance, Auditor |
| `driver` | `DriverRecord` | `drv-0001` | Driver app, Onboarding, Administration, Safety | Operations, Care, Finance, Auditor |
| `trip` | `TripRecord` | `trp-0001` (`ref` `#0001A3` shown to users) | Rider and driver apps, Operations | Everyone with `trips.view` |
| `case` | `CaseRecord` | `cas-0001` (`C-2400`), `saf-0001` (`S-310`) | Care, Safety | Operations, Onboarding (care only) |
| `ledger_entry` | `LedgerEntry` | `le-…`, grouped by `journalId` `jr-…` | Payments backend, Finance | Finance, Owner, Auditor |
| `withdrawal` | `WithdrawalRecord` | `wdr-0001` | Driver app, Finance | Finance, Owner, Auditor |
| `refund` | `RefundRecord` | `ref-0001` | Care (request), Finance (approve) | Care, Finance |
| `collection` | `CollectionRecord` | `col-…` with provider `reference` | Payments backend | Finance |
| `config` | `ConfigVersion` | `cfg-fares-2` | Administration, Owner (publish) | Everyone with `config.view` |
| `package` | Driver access package (config key `packages`) | `daily`, `monthly` | Administration | Finance, Drivers |
| `campaign` | `PromoCampaign` | `referral`, `wallet-topup` | Growth | Owner, Admin |
| `announcement` | `Announcement` | `ann-0001` | Growth | Owner, Admin |
| `integration` | `IntegrationRecord` | `int-pay-test` | Technical | Owner, Finance (payments only) |
| `staff` | `StaffMember` | `stf-owner` | Owner | Auditor |
| `approval` | `ApprovalRequest` | `apr-0001` | Requesters, approvers | Owner, Admin, Finance, Auditor |
| `event` | `EventPartnership` | `evt-0001` | Growth, Administration | Operations, Owner |

**Same record, tailored access.** A trip opened from a support case is the trip Operations sees on `/trips` and Finance sees through its ledger entries. The shared record panel (`RecordLink` / `useOpenRecord` in `apps/admin/src/data/records.tsx`) is the only way to open a trip, passenger or driver, so the same panel opens from every workspace. What the panel shows depends on permissions, not on where it was opened from:

| Section of the trip panel | Shown when the viewer holds |
|---|---|
| Route, status, timeline, fares, method, payment state | `trips.view` |
| Passenger and driver phone, email | `passengers.contact_details`, `drivers.contact_details`; otherwise "Hidden for your role" |
| Ledger entries for the trip | `ledger.view` |
| Wallet balance, withdrawable earnings | `finance.view` or `ledger.view` |
| Linked care cases | `cases.view` |
| Linked safety cases | `safety.view` |
| Last known location in a safety case | `safety.location` |

A hidden field is shown as "Hidden for your role" with a lock icon, never as an empty value, so staff know the data exists and who to ask.

## 4. Connection states

Every integration and every screen that depends on one uses exactly these states (`ConnectionState`, `CONNECTION_FLOW` in `workflows.ts`):

| State | Meaning | What dependent screens show |
|---|---|---|
| `prototype` | Screen exists; no provider is connected. Test data and simulated responses only. | A "Test data" banner and "Simulated" labels on every result |
| `configured` | Credentials or connection entered for an environment; not yet verified | "Not verified yet"; actions that need the provider stay disabled |
| `tested` | All required checks passed in the **test** environment | "Test mode"; no real money moves |
| `live` | All required checks passed in the **live** environment and the owner approved activation (`canGoLive`, `payments_activation`) | Normal behaviour |
| `degraded` | Was live; at least one check now fails or errors exceed the alert threshold | An honest "Unavailable" or "Pending" state on dependent actions; a technical alert |

Allowed changes: `prototype → configured`; `configured → tested | prototype`; `tested → live | configured`; `live → degraded | configured`; `degraded → live | configured`.

**A completed looking screen is never a working integration.** Today every integration in the test data is `prototype`, `configured` or `tested`; none is `live`. The prototype app shows a persistent test data banner. Details: [07-payments-and-integrations.md](07-payments-and-integrations.md).

## 5. Backend contract

The prototype changes data only through `mutate(spec)` (`apps/admin/src/data/store.tsx`, used through `useAction`). Each `mutate` call becomes **one authenticated API command** with the same inputs. The pattern is the same for every action in every module:

1. **Authenticate.** The request carries the staff session (see [01-foundation.md](01-foundation.md#1-staff-access-and-authentication)). Suspended or invited staff are refused (`permissionsOf` returns nothing for a non active member).
2. **Re-check permission on the server.** The UI hiding a button is a convenience; the server checks the same permission key from `ROLE_PERMISSIONS` and the staff member's city scope (`inCityScope`) against the target record. Refusal: `403 forbidden` with the missing permission key.
3. **Validate the workflow transition.** The server loads the record, checks `canTransition(<FLOW>, from, to)` with the tables in `workflows.ts`, and refuses with `409 invalid_transition` (including the current status) if another person changed it first.
4. **Apply approval rules.** If `needsApproval(kind, amount)` is true, the command creates an `ApprovalRequest` instead of applying the change. Deciding re-checks `canDecide` (never the requester).
5. **Write the change, any ledger journal and the audit event in one database transaction.** Either all three are stored or none is. Money changes post balanced journals (`postJournal`); balances are never written directly.
6. **Be idempotent by key.** Every command carries an `Idempotency-Key` (a UUID created when the person opens the action, reused on retries). A repeat with the same key returns the first result and changes nothing. Provider webhooks use the provider reference as the key (`postJournal` returns `duplicate: true`).
7. **Return the updated record** so the screen refreshes from the server's version, then publish a domain event (for example `driver.approved`) that background jobs and other apps consume ([09-connections.md](09-connections.md)).

Standard error shape: `{ error: { code, message, field?, currentStatus? } }`, where `message` is staff facing copy that follows the copy rules in [01-foundation.md](01-foundation.md#7-design-system). On any error the screen keeps the person's input and the old record ("Nothing was changed").

Reads are `GET` endpoints that filter by the global city and date filters and by the staff member's city scope **on the server**, and that omit fields the viewer is not allowed to see (they are not merely hidden in the browser).

## 6. How to read a module spec

Every module in files 02 to 08 uses the same ten numbered subheadings, then two extra lists:

1. **Users and permissions**: roles and the exact permission keys from `PERMISSIONS`.
2. **Screens and navigation**: routes, tabs, drawers, and where the module links to.
3. **Fields and data source**: table of field, type, source (`record.field`), notes. Money is integer kobo (`Kobo`) and shown with `money()` as ₦1,500.
4. **Available actions**: table of action, permission, whether approval is needed, effect.
5. **Validation and approval rules**.
6. **Status transitions**: rendered from the tables in `workflows.ts`. Where no table exists yet, the list is marked **Proposed** and must be added to `workflows.ts` before the backend is built.
7. **Effects on other screens and apps**: rider app, driver app, other workspaces.
8. **Notifications and background jobs**.
9. **Loading, empty, pending, error and success states**: concrete copy.
10. **Acceptance checks**: numbered Given / When / Then lines that can be tested against the prototype and later the backend.

**Backend needs** lists commands, queries, domain events and jobs. **Open question** lines mark decisions the owner has not made; the prototype uses a placeholder and labels it.

## 7. File index

| File | Contents | Writer |
|---|---|---|
| [README.md](README.md) | This overview, shared records, contract, glossary | This half |
| [01-foundation.md](01-foundation.md) | Authentication, permission groups, approvals, audit, navigation, filters, design system, standard states | This half |
| [02-oversight.md](02-oversight.md) | Owner overview, Approvals, Staff and access, Activity and audit, Reports | This half |
| [03-operations.md](03-operations.md) | Passengers, Drivers and verification, Trips, Live operations | This half |
| [04-configuration.md](04-configuration.md) | Service areas, Vehicle categories, Fare settings, Driver packages, Rewards and referrals, Events; versioning | This half |
| [05-care-safety.md](05-care-safety.md) | Support cases, Safety | Other half |
| [06-finance.md](06-finance.md) | Collections, wallets, earnings, withdrawals, refunds, settlements, reconciliation, ledger, finance reports | Other half |
| [07-payments-and-integrations.md](07-payments-and-integrations.md) | Payments setup, integrations inventory, webhooks, credentials | Other half |
| [08-growth.md](08-growth.md) | Announcements, Promotions, Referral campaigns, Event partnerships | This half |
| [09-connections.md](09-connections.md) | Cross workspace triggers and outcomes | Other half |
| [10-implementation-and-acceptance.md](10-implementation-and-acceptance.md) | Implementation phases, end to end acceptance | Other half |

Related existing documents: `docs/BUSINESS_RULES.md` (BR ids), `docs/DECISIONS.md` (D ids), `docs/API_CONTRACTS.md`, `docs/BACKEND_HANDOVER.md`, `docs/SECURITY_PRIVACY.md`, `apps/admin/BUILDING.md` (screen conventions).

## 8. Glossary

| Term | Meaning |
|---|---|
| **Kobo** | The unit every amount is stored in: ₦1 = 100 kobo (BR-001). Type `Kobo`. ₦1,500 is stored as `150000`. Never a floating point naira value. |
| **Ledger** | The double entry record of every money movement (`LedgerEntry`, `ledger.ts`). Balances are sums of entries; nobody edits a balance. Corrections are new `adjustment` or `reversal` entries with a reason. |
| **Journal** | A set of ledger entries posted together with one `journalId`; their amounts sum to zero (for example wallet −₦2,000, driver earnings +₦2,000). |
| **Account** | A ledger bucket (`LedgerAccount`): `passenger_wallet`, `driver_earnings`, `driver_withdrawal_reserve`, `company_revenue`, `provider_clearing`, `promotions_expense`, `processing_costs`. |
| **Reserve** | Driver earnings moved into `driver_withdrawal_reserve` when a withdrawal is requested, so the same money cannot be withdrawn twice. Released back on rejection, failure or reversal. |
| **Collection** | A payment attempt received through the provider (`CollectionRecord`): wallet funding, package purchase or trip payment, identified by a provider `reference`. Only a server verified result credits anything. |
| **Settlement** | What the provider paid into the company bank account for a period: collected minus fees (`SettlementRecord`). |
| **Payout** | Money sent from GoBye to a driver's verified bank account to complete a withdrawal. *Submitted* (`processing`) is not *paid* (`successful`). |
| **Approval** | A request that a second, authorised person must decide before a sensitive change applies (`ApprovalRequest`, `APPROVAL_RULES`). The requester can never approve their own request. |
| **Trip value** | The fare of completed trips. With 0% commission (D-024) this is the drivers' money, not company revenue. |
| **Company revenue** | Driver access package sales (`company_revenue` account). |
| **Wallet deposit** | Money a passenger adds to their wallet for future trips. A liability held for the passenger, never revenue. |
| **Driver earnings** | Trip money credited to a driver's GoBye earnings (`driver_earnings`). Direct transfers to a driver's own account are recorded but not credited. |
| **Config version** | One effective dated version of a setting (`ConfigVersion`). Records store the id of the version that applied to them. |
| **City scope** | The cities a staff member may see (`StaffMember.cities`; empty means all). |
