# 02. Oversight

Modules: [Owner overview](#module-owner-overview) (`/overview`), [Approvals](#module-approvals) (`/approvals`), [Staff and access](#module-staff-and-access) (`/staff`), [Activity and audit](#module-activity-and-audit) (`/audit`), [Reports](#module-reports) (`/reports`). Shared rules: [01-foundation.md](01-foundation.md). Back to [README.md](README.md).

---

## Module: Owner overview

Answers three questions (brief §2): how is the business performing, what needs attention, what decisions are waiting.

### 1. Users and permissions

| Role | Access |
|---|---|
| owner | `overview.view`; every money figure (holds `finance.view`, `ledger.view`) |
| admin, operations | `overview.view`; money tiles shown only to holders of `finance.view` or `ledger.view`, otherwise replaced by "Hidden for your role" |
| finance | `overview.view`, all money tiles |
| auditor | `overview.view`, read only |

No action on this page changes data; every tile links to the module that owns the action.

### 2. Screens and navigation

`/overview`, a single page in five bands, top to bottom:

1. **Needs attention**: pending approvals (count, oldest first, link to `/approvals`), integration alerts (link to `/developer`), unresolved safety cases (link to `/safety`), stuck payments (link to `/live`).
2. **Activity**: completed trips, active drivers, active passengers, repeat usage, daily completed trips chart.
3. **Money, kept apart**: four separate tiles that are never added together: Trip value, Company revenue, Wallet deposits, Driver earnings. Each has its explanation under the number.
4. **Money flows**: collections, payouts, refunds, promotional spending, processing costs.
5. **Service quality**: cancellation rate, matching success, unresolved support cases, unresolved safety cases; city breakdown table (Lagos, Abuja) for the activity and quality metrics.

Global city and date filters apply (01 §6). Each tile states its period ("Last 30 days") or "Now".

### 3. Fields and data source

**Separation rule.** Trip value, company revenue, wallet deposits and driver earnings are **different money** and are **never summed** on any screen or report:

- **Trip value** is what passengers paid for completed trips. With 0% commission (D-024, BR-060) it belongs to drivers.
- **Company revenue** is driver access package sales only (D-024).
- **Wallet deposits** are money passengers hold for future trips: a **liability**, not revenue (brief §2).
- **Driver earnings** are trip money credited to drivers' GoBye earnings; direct transfers to drivers' own accounts are counted separately and never credited (brief §5).

Definitions. "In range" means the record's stated time falls inside the date filter; "city" means the stated city field matches the city filter and the viewer's scope. Money in kobo, shown as naira.

| Metric | Type | Formula | Source | Time field | City from |
|---|---|---|---|---|---|
| Completed trips | count | trips with `status ∈ {completed, payment_pending}` and `completedAt` in range; sub line "N awaiting payment" = those `payment_pending` | `trip.status`, `trip.completedAt` | `completedAt` | `trip.city` |
| Active drivers | count | distinct `trip.driverId` over completed trips in range | trips | `completedAt` | `trip.city` |
| Drivers with access now | count | drivers with `verification = approved` and `access.expiresAt > now`; sub line "N online now" (`online`) | `driver.access`, `driver.online` | now | `driver.city` |
| Active passengers | count | distinct `trip.passengerId` over completed trips in range | trips | `completedAt` | `trip.city` |
| Repeat usage | percent | active passengers with 2 or more completed trips in range ÷ active passengers; 0% when none | trips | `completedAt` | `trip.city` |
| Trip value | Kobo | Σ `agreedFare` (or `suggestedFare` for Quick Match without `agreedFare`) over completed trips in range; sub line "includes ₦X paid directly to drivers" | `trip.agreedFare` | `completedAt` | `trip.city` |
| Company revenue | Kobo | Σ `amount` of ledger entries on `company_revenue` with `kind = package_purchase`, plus their reversals | `ledger_entry` | `at` | paying driver's city |
| Package sales | count | successful collections with `purpose = package_purchase` in range | `collection` | `verifiedAt` | `driver.city` of `payerId` |
| Package renewals | count, percent | purchases in range by a driver who had an earlier successful package purchase (any date); percent = renewals ÷ package sales | `collection` | `verifiedAt` | driver city |
| Wallet deposits | Kobo | Σ positive `passenger_wallet` entries with `kind = wallet_funding` in range | `ledger_entry` | `at` | passenger city |
| Wallet balances held | Kobo | Σ balance of every `passenger_wallet` account now (liability) | ledger | now | passenger city |
| Driver earnings | Kobo | Σ positive `driver_earnings` entries with `kind ∈ {trip_charge, driver_trip_earning}` in range | ledger | `at` | trip city |
| Paid directly to drivers | count, Kobo | completed trips with `directToDriver = true`; recorded only | `trip.directToDriver` | `completedAt` | `trip.city` |
| Collections | Kobo, count | Σ `amount` of collections with `status = successful`, by purpose (wallet funding, package purchase, trip payment); sub line counts of `pending` and `failed` | `collection` | `verifiedAt` (successful), `createdAt` (others) | payer city |
| Payouts | Kobo | Σ of `withdrawal_payout` amounts leaving `driver_withdrawal_reserve` (as positive) in range; sub line "N processing (₦X)" from withdrawals `processing` | ledger, `withdrawal` | `at` | driver city |
| Refunds | Kobo, count | Σ `amount` of refunds `completed` in range; sub line pending count (`requested`, `approved`, `processing`) | `refund` | completion time | passenger city |
| Promotional spending | Kobo | Σ of debits to `promotions_expense` in range with `kind ∈ {referral_reward}` plus promotion funded discounts (none yet), shown positive | ledger | `at` | beneficiary city |
| Processing costs | Kobo | Σ `processing_costs` entries in range | ledger | `at` | payer city |
| Cancellation rate | percent | trips `cancelled` ÷ trips requested in range that reached an end state (`completed`, `payment_pending`, `cancelled`, `no_driver`) | trips | `requestedAt` | `trip.city` |
| Matching success | percent | trips that got a driver (`driverId` set) ÷ (those + `no_driver`), over trips requested in range, excluding passenger cancellations before a match | trips | `requestedAt` | `trip.city` |
| Unresolved support cases | count | care cases with `status ∉ {resolved, closed}` now; sub line urgent and high | `case` | now | `case.city` |
| Unresolved safety cases | count | safety cases with `status ∉ {resolved, closed}` now; sub line urgent | `case` (team safety) | now | `case.city` |
| Pending approvals | count | approvals `pending`; sub line age of oldest | `approval` | now | not city filtered |
| Integration alerts | count | integrations `degraded`, plus unresolved failures; sub line "N not live yet" | `integration` | now | not city filtered |
| Stuck payments | count | trips `payment_pending` for more than 30 minutes (placeholder) plus collections `pending` for more than 15 minutes (placeholder) | trips, collections | now | trip or payer city |

City behaviour: the city breakdown table repeats activity and quality metrics for Lagos and Abuja side by side regardless of the city filter (within the viewer's scope). Ledger entries without a city (company level) count under "All cities" only.

**Open question:** whether refunds funded by the company should count as promotional spending, as a separate "goodwill and refunds cost" line, or be charged back to the driver (see refund funding source in [06-finance.md](06-finance.md)).

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Change city or date filter | any viewer | No | Recomputes every tile |
| Open a tile | per target page | No | Navigates to the owning module with the same filters |
| Open approval from Needs attention | `approvals.view` | No | Opens `/approvals` with the request selected |

### 5. Validation and approval rules

Read only. Percentages show "Not enough data" when the denominator is below 10 (placeholder) instead of 0% or 100%.

### 6. Status transitions

None. Uses statuses from trips, cases, approvals and integrations as read only.

### 7. Effects on other screens and apps

None directly. Numbers must equal the totals in Reports and the finance views for the same filters.

### 8. Notifications and background jobs

- **Job `metrics.rollup`** (target, every 5 minutes): precomputes daily aggregates per city; the page reads aggregates for past days and live data for today.
- **Daily owner summary** (proposed, optional): email at 08:00 WAT with yesterday's numbers and pending approvals. **Open question:** whether the owner wants it.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Tile skeletons in the final grid |
| Empty | Per tile: "No completed trips in this period." Needs attention when clear: "Nothing needs your attention right now." |
| Pending | Stuck payments tile: "3 payments waiting more than 30 minutes" with a warning pill |
| Error | "Couldn't load the overview. Try again." Partial: a tile that fails says "Couldn't load this number" while others show |
| Success | Not applicable (read only) |

### 10. Acceptance checks

1. Given the test data, when the owner opens `/overview`, then Trip value, Company revenue, Wallet deposits and Driver earnings appear as four separate tiles and no tile or total adds two of them.
2. Given a passenger funds their wallet with ₦10,000 (verified), when the overview refreshes, then Wallet deposits rises by ₦10,000 and Company revenue does not change.
3. Given a driver buys a daily package, when the overview refreshes, then Company revenue and Package sales rise and Trip value does not change.
4. Given a completed trip paid directly to the driver, then Trip value includes it, Driver earnings does not, and "Paid directly to drivers" counts it.
5. Given the city filter is Lagos, then every activity, money and quality tile counts only Lagos records, and the city breakdown still shows both cities.
6. Given a staff member scoped to Abuja, when they choose All cities, then no Lagos record is counted.
7. Given an operations user without `finance.view`, when they open `/overview`, then money tiles show "Hidden for your role".
8. Given 3 pending approvals, then Needs attention shows 3 and the oldest first.
9. Given a denominator below 10, then the percentage tile shows "Not enough data".
10. Given the same filters, then Company revenue on the overview equals the revenue total in Reports.

### Backend needs

- `GET /admin/overview?city=&from=&to=` returning every metric above with its definition version.
- Aggregation tables per day and city; job `metrics.rollup`.
- Events consumed: `trip.completed`, `collection.succeeded`, `ledger.journal_posted`, `case.*`, `approval.*`, `integration.state_changed`.

---

## Module: Approvals

### 1. Users and permissions

`approvals.view`: owner, admin, finance, auditor. Deciding: active staff in the request's `approverRoles` who are not the requester, holding the domain permission (01 §3 rule 6). Approvals also appear inside each owning module (for example a refund's drawer).

### 2. Screens and navigation

`/approvals`: tabs **Waiting for me** (I can decide), **All pending**, **Decided**. Table with kind, title, requester, requested, amount, age. Row opens a drawer with the request, the target record summary (link to the record), the diff or amount, the approver roles, and Approve / Reject. Badge in the sidebar = pending count.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Kind | enum | `approval.kind` | Label, for example "Publish configuration" |
| Title | string | `approval.title` | "Publish fares v3 (effective in 5 days)" |
| Requested by | Actor | `approval.requestedBy` | May be a driver for withdrawals |
| Requested | time | `approval.requestedAt` | Age shown ("4 h") |
| Target | record ref | `approval.target` | Opens the shared record or module |
| Amount | Kobo | `approval.amount` | Refunds, withdrawals |
| Approver roles | StaffRole[] | `approval.approverRoles` | Copied from `APPROVAL_RULES` at request time |
| Status | enum | `approval.status` | pending, approved, rejected |
| Decided by, at, note | Actor, time, string | `approval.decidedBy`, `decidedAt`, `note` | |
| Change detail | diff | the target, for example `ConfigVersion.value` vs version in force | Computed |
| Blocking checks | list | for `payments_activation`: `integration.checks` | Approve disabled while any fails |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Approve | approver role, not requester, domain permission | This is the approval | `status → approved`; applies the target change (below); audit `approval.approved` |
| Reject | same | | `status → rejected`, note required; target returns to its pre request state; audit `approval.rejected` |
| Withdraw (proposed) | requester | | Pending request removed from queue (`status → rejected` with note "Withdrawn by requester") |

Effects of approval by kind: `config_publish` → version `scheduled` (future `effectiveFrom`) or `active` and the previous `superseded`; `refund` → refund `approved` (then processing, see 06); `ledger_adjustment` → journal posted; `withdrawal` → withdrawal `processing` when finance submits; `payments_activation` → integration `live` only if `canGoLive(checks)`; `announcement` → `scheduled` or `sending`; `staff_role` → role granted.

### 5. Validation and approval rules

`canDecide` must be true; target must still be in the state it was in when requested (otherwise "This request is out of date"); reject needs a note of at least 5 characters; `payments_activation` cannot be approved while a required check fails ("Blocked until live checks pass").

### 6. Status transitions

**Proposed** (`ApprovalRequest.status`, no table in `workflows.ts` yet):
- `pending → approved`
- `pending → rejected`
- `approved`, `rejected`: final

### 7. Effects on other screens and apps

Owning module shows the new state (config page, refund drawer, withdrawals queue, announcement, integration, staff). Rider and driver apps see the change only when its own effect applies (for example a published fare at its effective date). Overview "Pending approvals" decreases.

### 8. Notifications and background jobs

- New request: in app badge and email to every eligible approver (excluding the requester).
- Decision: email and in app notice to the requester.
- **Job `approvals.reminder`** (proposed, daily 09:00 WAT): reminds approvers of requests older than 24 hours.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Table skeleton |
| Empty | Waiting for me: "Nothing waiting for your decision." All pending: "No pending approvals." |
| Pending | Pill "Pending" (warning). Own request: Approve disabled with "You can't approve your own request". Blocked activation: "Blocked until live checks pass" |
| Error | "Couldn't save your decision. Nothing was changed." Out of date: "This request is out of date. Refresh to see the latest." |
| Success | "Approved. Fares v3 takes effect on 26 Oct." / "Rejected. The requester has been told." |

### 10. Acceptance checks

1. Given care agent Ruth requested refund `ref-0001`, when Ruth opens it, then Approve and Reject are disabled with "You can't approve your own request".
2. Given finance user Grace, when she approves `apr-0002`, then the approval is `approved`, refund `ref-0001` is `approved`, and an audit event `approval.approved` names Grace.
3. Given `apr-0004` (switch Paystack to live) and failing live checks, when the owner opens it, then Approve is disabled with "Blocked until live checks pass".
4. Given a marketing user (no `approvals.view`), then `/approvals` is not in the sidebar and opening it shows "You don't have access to this page".
5. Given the auditor, then all tabs are visible and no action is enabled.
6. Given a rejection without a note, then the dialog refuses with "Add a reason".
7. Given two approvers decide the same request, when the second submits, then they see "This request is out of date" and nothing changes.

### Backend needs

- `GET /admin/approvals?status=&kind=`; `POST /admin/approvals/{id}/approve`, `/reject` (idempotent, re-check `canDecide` and target state in one transaction).
- Events: `approval.requested`, `approval.approved`, `approval.rejected`. Job `approvals.reminder`.

---

## Module: Staff and access

### 1. Users and permissions

`staff.view`: owner, auditor. `staff.manage`: owner. Granting `owner`, `finance` or `developer` needs `staff_role` approval.

### 2. Screens and navigation

`/staff`: table of staff (name, email, roles, city scope, status, last sign in). Drawer: profile, roles (checkboxes with `ROLE_LABELS` and a preview of the resulting permission union), city scope, sessions and devices (target), audit history for this person. Buttons: Invite staff, Suspend, Reinstate, Resend invite. A "Permissions" tab shows the matrix from [01-foundation.md](01-foundation.md#22-role--permission-matrix).

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Name | string | `staff.name` | |
| Email | string | `staff.email` | Work email |
| Roles | StaffRole[] | `staff.roles` | Labels from `ROLE_LABELS` |
| Permissions | Permission[] | `permissionsOf(staff)` | Computed union; empty unless active |
| City scope | CityId[] | `staff.cities` | Empty shown as "All cities" |
| Status | enum | `staff.status` | invited, active, suspended |
| Read only | boolean | `isReadOnly(staff.roles)` | Badge "Read only" |
| Last sign in, devices | time, list | sessions table (target) | Not in the prototype |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Invite staff | `staff.manage` | `staff_role` if roles include owner, finance or developer | Creates `invited` record; sends invite |
| Change roles | `staff.manage` | same rule for added roles | Roles updated; sessions refresh permissions on next request |
| Change city scope | `staff.manage` | No | Scope updated |
| Suspend | `staff.manage` | No (reason required) | `status → suspended`; sessions ended; owned cases unassigned |
| Reinstate | `staff.manage` | No (reason required) | `status → active` |
| Resend invite | `staff.manage` | No | New link; old link invalid |
| End session (target) | `staff.manage` | No | Session revoked |

### 5. Validation and approval rules

Email unique and valid; at least one role; the last active owner cannot be suspended or lose `owner` ("GoBye needs at least one active owner"); a person cannot change their own roles; a role change that removes every role is refused (use Suspend). Combining `auditor` with any role that changes data is refused ("Auditor access is read only; use a separate account").

### 6. Status transitions

**Proposed** (`StaffMember.status`):
- `invited → active` (invite accepted)
- `invited → suspended` (invite cancelled)
- `active → suspended`
- `suspended → active`

### 7. Effects on other screens and apps

Permissions apply on the next request in every workspace; a suspended person is signed out everywhere. Assigned cases appear unassigned in [05-care-safety.md](05-care-safety.md). Approvals list loses them as an eligible approver. No effect on rider or driver apps.

### 8. Notifications and background jobs

Invite email; new device email; suspension email to the person ("Your access to GoBye Management has been suspended"). **Job `staff.invite_expiry`**: marks invites older than 7 days as expired (link invalid, record stays `invited` with "Invite expired").

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Table skeleton |
| Empty | "No staff yet. Invite your first team member." |
| Pending | Invited: pill "Invited" with "Invite sent 2 days ago". Waiting approval: "Finance access waiting for approval" |
| Error | "Couldn't send the invite. Nothing was changed." Duplicate: "Someone with this email is already on the team." |
| Success | "Invite sent to new.hire@example.test" / "Access suspended. They have been signed out." |

### 10. Acceptance checks

1. Given the owner invites a person with role `care` and scope Lagos, then a staff record with `status: invited` is created and an audit event `staff.invited` exists.
2. Given the owner invites a person with role `finance`, then an approval `staff_role` is created and the role is not active until approved.
3. Given an invited person, when they try to sign in before accepting, then sign in is refused.
4. Given the owner suspends `stf-care`, then `permissionsOf` for that person is empty and every API call is refused.
5. Given the only active owner, when anyone tries to suspend them, then it is refused with "GoBye needs at least one active owner".
6. Given a staff member with `operations` and `onboarding`, then the drawer shows the union of 11 permissions.
7. Given the auditor, then the page is readable and no action is offered.

### Backend needs

- `GET /admin/staff`; `POST /admin/staff/invite`; `PATCH /admin/staff/{id}` (roles, cities); `POST /admin/staff/{id}/suspend`, `/reinstate`, `/resend-invite`; `GET/DELETE /admin/staff/{id}/sessions`.
- Auth service: one time codes, sessions, device records. Events `staff.*`. Job `staff.invite_expiry`.

---

## Module: Activity and audit

### 1. Users and permissions

`audit.view`: owner, admin, finance, developer, auditor. Access log entries (sensitive views) visible to owner and auditor only (proposed).

### 2. Screens and navigation

`/audit`: reverse chronological timeline of `AuditEvent`s. Filters: actor (person or system), action prefix (`driver.`, `config.`, `refund.`), record type, record id, date range. Row expands to the diff and reason. Every record panel also shows its own audit history ("Activity" section).

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Time | time | `audit.at` | |
| Who | Actor | `audit.actor` | Staff name, "System: referrals", "Provider: Paystack (test)" |
| Action | string | `audit.action` | Shown as label |
| Record | ref | `audit.target` | Link to record |
| Summary | string | `audit.summary` | |
| Changes | diff[] | `audit.diff` | Masked secrets |
| Reason | string | `audit.reason` | |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Filter, search | `audit.view` | No | |
| Export (CSV) | `reports.export` | No | File of filtered events; export itself audited |

### 5. Validation and approval rules

Read only, append only. Date range maximum 1 year per export (placeholder).

### 6. Status transitions

None.

### 7. Effects on other screens and apps

None.

### 8. Notifications and background jobs

**Proposed alerts to the owner:** a ledger adjustment, a credential rotation, a role grant, or a live environment change.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Timeline skeleton |
| Empty | "No activity matches these filters." |
| Pending | Not applicable |
| Error | "Couldn't load activity. Try again." |
| Success | Export: "Export ready. 214 events." |

### 10. Acceptance checks

1. Given any successful change in any module, then exactly one audit event with the acting staff member appears at the top of `/audit`.
2. Given a failed change, then no audit event is written.
3. Given the credential rotation `aud-2`, then the diff shows only `••••91c0` and `••••7f2a`.
4. Given the auditor, then no edit or delete control exists for any event.
5. Given filter action `config.`, then only configuration events show.

### Backend needs

- `GET /admin/audit?actor=&action=&type=&id=&from=&to=` (paged); `GET /admin/audit/export`.
- Append only audit table written inside each command's transaction.

---

## Module: Reports

High level only; definitions, exports and receipts are in [06-finance.md](06-finance.md).

### 1. Users and permissions

`reports.view`: owner, admin, finance, marketing, auditor. `reports.export`: owner, finance. Money reports require `finance.view` as well; marketing sees growth reports only.

### 2. Screens and navigation

`/reports` (implemented in the finance workspace): report list with filters (city, date range), each report as a table with totals and Export.

| Report | Audience | Notes |
|---|---|---|
| Business summary | owner, admin, auditor | Same definitions as the overview |
| Revenue (driver packages) | owner, finance, auditor | Company revenue only |
| Wallet liability | owner, finance, auditor | Deposits, spend, refunds, balance held |
| Driver earnings and payouts | owner, finance, auditor | Earned, withdrawn, reserved, outstanding |
| Costs | owner, finance, auditor | Processing costs, promotional spending, refunds absorbed |
| Operations | owner, admin, auditor | Trips, cancellations, matching by city |
| Growth | owner, admin, marketing | Campaigns, announcements, referrals |

### 3. Fields and data source

Per report in [06-finance.md](06-finance.md). Every report uses the overview definitions above for shared metrics, money in kobo, and states its time field and definition version in the header.

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| View report | `reports.view` (+ `finance.view` for money reports) | No | |
| Export CSV | `reports.export` | No | Async file; audited `report.exported` |

### 5. Validation and approval rules

Date range required for exports; maximum 1 year per export (placeholder). Exports never include contact details or full bank numbers.

### 6. Status transitions

**Proposed** export job: `queued → ready | failed`; `ready → expired` after 24 hours (placeholder).

### 7. Effects on other screens and apps

None.

### 8. Notifications and background jobs

Job `reports.export`; in app notice "Your export is ready" with a download link.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Table skeleton |
| Empty | "No data for this period." |
| Pending | "Preparing your export" (info pill) |
| Error | "Couldn't create the export. Try again." |
| Success | "Export ready. 1,240 rows." |

### 10. Acceptance checks

1. Given identical filters, then every total in Reports equals the matching overview tile.
2. Given a marketing user, then money reports are not listed.
3. Given an export, then an audit event names the report, filters and row count.

### Backend needs

`GET /admin/reports/{report}?city=&from=&to=`; `POST /admin/reports/{report}/export` (async job, file link expires in 24 hours, placeholder).
