# 01. Foundation

Shared rules every module depends on: staff access, permissions, approvals, audit, navigation, filters, design system and standard states. Implementation phase 1 in the owner brief (§11). Back to [README.md](README.md).

Code that already implements this model: `packages/core/src/platform/permissions.ts`, `approvals.ts`, `workflows.ts`, `types.ts` (`AuditEvent`); `apps/admin/src/data/session.tsx`, `store.tsx`, `nav.tsx`.

---

## 1. Staff access and authentication

### 1.1 Prototype (today)

Sign in is **simulated**. The sign in screen lists the test staff accounts from `createPlatformDataset().staff` (`TEST_STAFF` in `session.tsx`); choosing one sets the session in `sessionStorage` for that browser tab. Only accounts with `status: 'active'` can sign in. There are no passwords, codes, devices or sessions on a server. The session decides which links and actions the UI offers; it protects nothing.

### 1.2 Target

| Topic | Rule |
|---|---|
| Sign in | Work email **or** Nigerian mobile number, then a 6 digit one time code (placeholder length) sent to that address or number. Code valid 10 minutes (placeholder), single use, 5 wrong attempts lock sign in for 15 minutes (placeholder). |
| SSO | Optional later: company identity provider (SAML or OpenID Connect) for staff email domains. When enabled for a domain, one time codes are switched off for that domain. **Open question:** whether SSO is needed at launch and which provider (not chosen). |
| Authentication provider | Not chosen (`int-auth` is `prototype`). See [07-payments-and-integrations.md](07-payments-and-integrations.md). |
| Session | Server side session with an opaque token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Idle timeout 30 minutes, absolute timeout 12 hours (placeholders). Finance, owner and developer roles re-enter a code before approving money, rotating credentials or changing staff roles if the last code is older than 15 minutes (placeholder step up). |
| Device and IP logging | Each sign in records time, IP address, approximate city from IP, browser and operating system, and a device id (random, stored in the browser). A new device for a staff member sends an email "New sign in to GoBye Management". Staff see their own active sessions; the owner sees everyone's (`staff.view`) and can end any session (`staff.manage`). |
| Invite | The owner enters name, work email or phone, roles and city scope. The record is created with `status: 'invited'`. An invite link (valid 7 days, placeholder, single use) is sent. Accepting it signs the person in with a one time code and sets `status: 'active'`. Granting `owner`, `finance` or `developer` needs approval (`staff_role`, §3). |
| Suspension | `staff.manage` sets `status: 'suspended'` with a reason. All sessions end immediately; `permissionsOf` returns no permissions for a non active member, so every API call is refused. Suspension never deletes the person's audit history, approvals or case ownership; open cases they own move to the team queue unassigned. |
| Offboarding | Same as suspension, then roles are removed. Records are never deleted. |

---

## 2. Permission groups

### 2.1 Rules

- **Roles are permission groups** (`StaffRole`, `ROLE_LABELS`). A staff member holds one or more roles. Their permissions are the **union** of their roles' permissions (`permissionsOf`), and nothing else. There is no combined or super role.
- Permission keys are `<area>.<action>` (`PERMISSIONS`, 49 keys). A `.view` key reads; every other key changes something. This list is the single source for the UI, the API and tests.
- **City scope.** `StaffMember.cities` lists the cities a person may see; empty means every city. Scope applies to every record that has a city (passengers, drivers, trips, cases, events) and to money derived from them. A Lagos only dispatcher never sees Abuja trips, even by id. Checked by `inCityScope` and, on the server, on every read and command.
- **Read only auditor.** `auditor` holds every `.view` permission except `safety.view`. By construction it holds no permission that changes anything (`isReadOnly(['auditor'])` is true). It never sees contact details or safety location, because those are separate non `.view` permissions.
- **Contact details are separate.** Seeing a passenger or driver record (`passengers.view`, `drivers.view`) does not include phone numbers and email addresses. Those need `passengers.contact_details` or `drivers.contact_details`. Without them the field shows "Hidden for your role".
- **Safety location is separate.** `safety.view` opens safety cases; the last known location shared with a safety alert needs `safety.location` as well. See [05-care-safety.md](05-care-safety.md).
- **Money visibility.** Wallet balances and withdrawable earnings need `finance.view` or `ledger.view`; individual ledger entries need `ledger.view`.
- The UI hides actions a person cannot take. Where knowing an action exists helps (for example a refund that needs approval), it is shown disabled with the reason ("Needs finance approval").

### 2.2 Role × permission matrix

Generated from `ROLE_PERMISSIONS` in `packages/core/src/platform/permissions.ts` (2026-10-21). If the code changes, regenerate this table; the code wins until the table is updated.

| Permission | owner | admin | operations | onboarding | care | safety | finance | marketing | developer | auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `overview.view` | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |
| `staff.view` | ✓ |  |  |  |  |  |  |  |  | ✓ |
| `staff.manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `approvals.view` | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |
| `approvals.decide` | ✓ |  |  |  |  |  |  |  |  |  |
| `audit.view` | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |
| `reports.view` | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  | ✓ |
| `reports.export` | ✓ |  |  |  |  |  | ✓ |  |  |  |
| `passengers.view` | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  | ✓ |
| `passengers.restrict` |  | ✓ |  |  |  | ✓ |  |  |  |  |
| `passengers.contact_details` |  |  |  |  | ✓ | ✓ |  |  |  |  |
| `drivers.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |
| `drivers.verify` |  | ✓ |  | ✓ |  |  |  |  |  |  |
| `drivers.restrict` |  | ✓ |  |  |  | ✓ |  |  |  |  |
| `drivers.contact_details` |  |  |  | ✓ |  | ✓ |  |  |  |  |
| `trips.view` | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  | ✓ |
| `trips.intervene` |  |  | ✓ |  |  |  |  |  |  |  |
| `live.view` | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `live.dispatch` |  |  | ✓ |  |  |  |  |  |  |  |
| `config.view` | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ |
| `config.edit` |  | ✓ |  |  |  |  |  |  |  |  |
| `config.publish` | ✓ |  |  |  |  |  |  |  |  |  |
| `cases.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  | ✓ |
| `cases.work` |  |  |  |  | ✓ |  |  |  |  |  |
| `cases.assign` |  |  |  |  | ✓ |  |  |  |  |  |
| `safety.view` | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `safety.work` |  |  |  |  |  | ✓ |  |  |  |  |
| `safety.location` |  |  |  |  |  | ✓ |  |  |  |  |
| `finance.view` | ✓ |  |  |  | ✓ |  | ✓ |  |  | ✓ |
| `ledger.view` | ✓ |  |  |  |  |  | ✓ |  |  | ✓ |
| `ledger.adjust` |  |  |  |  |  |  | ✓ |  |  |  |
| `refunds.request` |  |  |  |  | ✓ |  | ✓ |  |  |  |
| `refunds.approve` | ✓ |  |  |  |  |  | ✓ |  |  |  |
| `withdrawals.view` | ✓ |  |  |  |  |  | ✓ |  |  | ✓ |
| `withdrawals.review` |  |  |  |  |  |  | ✓ |  |  |  |
| `withdrawals.process` |  |  |  |  |  |  | ✓ |  |  |  |
| `reconciliation.work` |  |  |  |  |  |  | ✓ |  |  |  |
| `payments_setup.view` | ✓ |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| `payments_setup.approve` | ✓ |  |  |  |  |  |  |  |  |  |
| `integrations.view` | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |
| `integrations.configure` |  |  |  |  |  |  |  |  | ✓ |  |
| `integrations.secrets` |  |  |  |  |  |  |  |  | ✓ |  |
| `logs.view` | ✓ |  |  |  |  |  |  |  | ✓ | ✓ |
| `comms.view` | ✓ | ✓ |  |  |  |  |  | ✓ |  | ✓ |
| `comms.draft` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `comms.publish` | ✓ |  |  |  |  |  |  | ✓ |  |  |
| `promos.manage` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `referrals.manage` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `events.manage` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| **Total** | 26 | 19 | 9 | 4 | 9 | 11 | 18 | 8 | 6 | 18 |

Notes on the matrix as coded:

- The owner holds every `.view` permission (including `safety.view`), plus `staff.manage`, `approvals.decide`, `reports.export`, `payments_setup.approve`, `config.publish`, `refunds.approve`, `comms.publish`. The owner does **not** hold contact details, `safety.location`, `config.edit`, or any operational change permission. An owner who also runs a team is given that team's role as well (union).
- Example of union and scope from the test data: `stf-ops-abj` holds `operations` + `onboarding` with scope `['abuja']`: 11 distinct permissions, Abuja records only.

---

## 3. Approvals (four eyes)

Sensitive changes are **requested** by one person and **decided** by another. Rules are in `APPROVAL_RULES` (`approvals.ts`). The thresholds are **placeholders** for the owner to set.

| `ApprovalKind` | Approver roles | Threshold | Covers | Requested from |
|---|---|---|---|---|
| `config_publish` | owner | always | Fares, packages, categories, referrals and cancellation rules (and service areas, payment methods: every `ConfigKey`) | [04-configuration.md](04-configuration.md) |
| `refund` | finance, owner | every refund (≥ ₦0) | Any refund to wallet or original method | [05-care-safety.md](05-care-safety.md), [06-finance.md](06-finance.md) |
| `ledger_adjustment` | owner | always | Manual correction to any balance | [06-finance.md](06-finance.md) |
| `withdrawal` | finance | at or above ₦100,000 (`10_000_000` kobo) | Driver withdrawal review | [06-finance.md](06-finance.md) |
| `payments_activation` | owner | always | Switching a payment provider to live, or changing settlement destination | [07-payments-and-integrations.md](07-payments-and-integrations.md) |
| `announcement` | owner, admin | always when required | Messages to all users of a type across all cities, or any SMS | [08-growth.md](08-growth.md#module-announcements) |
| `staff_role` | owner | always | Granting `owner`, `finance` or `developer` | [02-oversight.md](02-oversight.md#module-staff-and-access) |

Rules (`needsApproval`, `canDecide`):

1. `needsApproval(kind, amount)` is true when the rule has no threshold, or when no amount is given, or when `amount >= thresholdKobo`.
2. Only a **pending** request can be decided, only by an **active** staff member, who holds at least one of `approverRoles`.
3. **The requester can never approve their own request**, even if they hold an approving role. A person who holds two roles still needs someone else.
4. A decision records `decidedBy`, `decidedAt` and a note. Rejection requires a note.
5. Deciding re-checks the target's current status (for example, a refund already rejected elsewhere cannot then be approved).
6. **Target rule (this spec):** to decide, the approver must also hold the domain permission for the change: `config.publish`, `refunds.approve`, `ledger.adjust` is not enough on its own (owner decides), `withdrawals.review`, `payments_setup.approve`, `comms.publish`, `staff.manage`. **Open question:** `canDecide` today checks roles only, and `approvals.decide` is held only by the owner, while finance and admin are listed approvers. Decide whether `approvals.decide` gates the Approvals screen actions, or whether the domain permissions do (recommended: domain permissions; keep `approvals.decide` for the owner's cross area queue).
7. **Open question:** with one owner, kinds whose only approver role is `owner` cannot be approved when the owner is the requester (for example the owner granting `finance` to someone). Options: a second owner or a nominated deputy, or allow the owner to self approve with a mandatory reason and an alert to the auditor.
8. Requests do not expire in the code. **Proposed:** a pending request older than 7 days (placeholder) shows "Waiting 7 days" and is listed first on the owner overview.

---

## 4. Audit records

Every change made through the platform creates one `AuditEvent` in the same transaction as the change (README §5).

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique id |
| `at` | number (ms) | Server time of the change |
| `actor` | `Actor` | `staff` (id, name), `system` (job name), `provider` (webhook source), `passenger` or `driver` (id, name) |
| `action` | string | `<record>.<verb>`, for example `driver.approved`, `config.published`, `refund.approved`, `integration.credential_rotated`, `staff.invited` |
| `target` | `{ type: RecordType, id, label }` | The shared record changed |
| `summary` | string | One line in plain words, for example "Approved ₦2,000 refund to wallet" |
| `diff` | `{ field, from, to }[]` optional | Before and after for settings and record fields |
| `reason` | string optional | Required for corrections, rejections, restrictions, suspensions and reversals |

**Always audited:** sign in, sign out, failed sign in and session ended by someone else (backend, not in the prototype); staff invited, role changed, scope changed, suspended, reinstated; every approval requested and decided; every config draft, submission, publish, schedule and rejection; driver verification decisions, document decisions, restrictions and reinstatements; passenger restrictions; trip interventions; case assignment, escalation and resolution; every refund, withdrawal and ledger adjustment or reversal; announcement and campaign status changes; integration configuration, credential rotation, environment switch and connection tests; exports (who, which report, filters, row count); viewing a safety location or contact details (access log, see below).

**Access log.** Reading sensitive fields (`safety.location`, contact details, full bank account details) writes an access event (`action: '<record>.viewed_sensitive'`) so the auditor can see who looked. Ordinary page views are not audited.

**Masking.** Secrets never appear in an audit event: a credential diff shows only a hint such as `••••91c0 → ••••7f2a` (as in the test data). Bank account numbers appear masked (`******1234`). Contact details in a diff are masked unless the viewer holds the matching contact permission.

**Integrity.** Audit events are append only: no update or delete endpoint exists. Corrections are new events.

**Retention.** Placeholder: keep audit events at least as long as the financial records they relate to. **Open question:** the retention period for audit, access logs and ledger records (owner and legal adviser to decide).

---

## 5. Navigation and role homepages

- One sidebar, grouped as in `NAV` (`nav.tsx`): Oversight, Operations, Care and safety, Finance, Configuration, Growth, Technical. Each item shows only if the person holds one of its `anyOf` permissions; a group with no visible items is hidden.
- **Badges** show counts needing action, from the same data as the page: Approvals (pending), Live operations (searching trips plus pickups delayed more than 5 minutes), Drivers (`in_review` or `applied`), Support cases (new care cases), Safety (open safety cases), Withdrawals (`requested` or `under_review`), Integrations (`degraded`).
- **Homepage after sign in** is `ROLE_HOME` for the person's first role in this priority order: owner, admin, finance, operations, safety, care, onboarding, marketing, developer, auditor (proposed; the prototype uses the first role in the staff record).

| Role | Homepage | Answers |
|---|---|---|
| owner | `/overview` | How is the business doing, what needs attention, what decisions wait |
| admin | `/overview` | Same, without money detail beyond what `overview.view` shows |
| operations | `/live` | What is going wrong right now |
| onboarding | `/drivers` | Which applications and documents need review |
| care | `/cases` | Which cases are mine and which are new |
| safety | `/safety` | Which urgent cases are open |
| finance | `/finance/collections` | What came in, what is stuck |
| marketing | `/comms` | What is drafted, scheduled, failing |
| developer | `/developer` | Which integrations are not healthy |
| auditor | `/audit` | What changed and who did it |

- Opening a route the person lacks permission for shows "You don't have access to this page" with their roles and "Ask the owner for access". It never shows partial data.
- Records open in a side panel over the current page (shared record panel). Panels stack; Back closes the top one.

---

## 6. Shared filters

Two global filters sit in the top bar and apply to every list and dashboard (`FilterProvider`, `useScopedFilter`):

| Filter | Values | Default | Behaviour |
|---|---|---|---|
| City | All cities, Lagos, Abuja (`CityId`) | All cities | Combined with the staff city scope: a Lagos scoped person sees only Lagos, and "All cities" means all of *their* cities. |
| Date range | Today, Last 7 days, Last 30 days, All time (`RangeKey`) | Last 30 days | Applied to the record's main time (each module names it). Records without a time (for example a driver's current status) ignore the date filter. |

Rules: the filters persist while navigating; each page states which time field it filters on; counts "right now" (open cases, online drivers, pending approvals) ignore the date range and say "now". **Target:** "Today" means the calendar day in Africa/Lagos time (WAT). The prototype uses a rolling 24 hours (`RANGE_MS.today`) and must be changed. **Proposed:** a custom date range for Reports.

---

## 7. Design system

Follows D-034 and `docs/DESIGN_SYSTEM.md`, applied to the web admin in `apps/admin/src/styles.css`.

- **Colour.** Monochrome: white pages (`#FFFFFF`) in light mode, black (`#000000`) in dark mode, neutral greys for surfaces and borders, black primary buttons in light mode (white in dark). Brand aubergine `#351A40` and tangerine `#FF751F` only for the logo mark, active navigation and illustrations; never for status or large fills.
- **Status colours** are separate and **always paired with an icon or a text label** (the `Pill` component). Never colour alone.

| Tone | Used for | Example labels |
|---|---|---|
| success (green) | Finished well | Completed, Paid, Approved, Successful, Live |
| warning (amber) | Waiting or needs attention | Pending, Confirming, Under review, Payment due, Tested |
| danger (red) | Failed or blocked | Failed, Rejected, Suspended, No driver found, Degraded |
| info (blue) | In progress, neutral information | Searching, Driver on the way, Processing |
| neutral (grey) | Inactive or historical | Cancelled, Draft, Superseded, Prototype |

- **Typography:** Inter only (400, 500, 600, 700). Numbers use tabular figures (`.num`).
- **Appearance:** Light, Dark or System, chosen in the top bar and remembered per browser (`gobye.admin.theme`); System is the default.
- **Copy:** short, plain, sentence case, British spelling. **No hyphens or dashes in visible text**: write "check again", "email", "Lagos to Abuja", and show an empty value as "Not set" or "None", not a dash. No exclamation marks. Statuses are named exactly as in the workflow tables, formatted with `label()` (`under_review` → "Under review"). Money always as ₦1,500 (`money()`), never kobo, never decimals unless there are kobo.
- **Test data honesty:** a banner on every page reads "Test data. Nothing here is a real person, payment or provider." Simulated results say "Simulated".
- **Accessibility:** every control reachable by keyboard; visible focus ring; icons decorative unless they are the only label; contrast at least WCAG AA in both themes.

---

## 8. Standard states

Every module defines these five states with concrete copy in its section 9. The shared definitions:

| State | Definition | Pattern |
|---|---|---|
| **Loading** | Data for the page or panel is being fetched for the first time | Skeleton shaped like the final layout (`Skeleton`); the shell handles first load of the dataset ("Loading GoBye Management"). Never a blank page. After 10 s: "Still loading. Check your connection." |
| **Empty** | Loaded, and nothing matches | `Empty` with what it means and what to do, naming the active filters: "No trips in Lagos in the last 7 days. Try All time." |
| **Pending** | A record or action is waiting on someone or something else | Status pill in a warning or info tone; actions that would conflict are disabled with the reason; a button that is running shows its own progress ("Approving") and blocks double clicks |
| **Error** | Loading or an action failed | Load: `ErrorState` "Couldn't load this page." with Try again. Action: toast with the server message; the drawer stays open with the person's input; "Nothing was changed." Permission: "You don't have permission to do this." Conflict: "This was changed by someone else. Refresh to see the latest." |
| **Success** | An action completed | Toast naming the result ("Driver approved"); the record updates in place; an audit event appears in Activity. Never a success message before the server confirms. |

Prototype: the "Simulate failures" switch makes loads and actions fail so the error states can be checked.
