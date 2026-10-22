# 05 · Care and safety

**Status:** Draft specification, 2026-10-21. PROPOSED. No backend exists; the admin prototype runs on the test dataset in `packages/core/src/platform/mockPlatform.ts`. Nothing here is live, connected to a real provider or tested on a device.
**Source of truth for:** `/cases` (Support cases) and `/safety` (Safety) in `apps/admin`.
**Read with:** [README.md](README.md) · [01-foundation.md](01-foundation.md) (staff, permissions, audit, approvals) · [03-operations.md](03-operations.md) (trips, passengers, drivers) · [06-finance.md](06-finance.md) (refunds, ledger) · [09-connections.md](09-connections.md) (cross workspace triggers) · [10-implementation-and-acceptance.md](10-implementation-and-acceptance.md).

Shared model in code: `CaseRecord`, `CaseMessage`, `CaseCategory`, `CasePriority`, `CaseStatus`, `RefundRecord` (`types.ts`), `CASE_FLOW`, `REFUND_FLOW` (`workflows.ts`), `APPROVAL_RULES.refund` (`approvals.ts`), permission keys in `permissions.ts`.

Conventions used below: money is integer kobo (`amountKobo`) and shown as naira, e.g. ₦1,500. Visible copy follows `apps/admin/BUILDING.md` (sentence case, no hyphens or dashes, no exclamation marks). Commands are named in PascalCase (`OpenCase`); every command follows the shared command pattern in [README.md](README.md) (permission, transition table, approval, audit, `Idempotency-Key`, domain event). The same naming is used in 06, 07 and 09. Events are `<record>.<past_tense>`.

---

## Principles

1. **One case, shared records.** A case links to the same passenger, driver, trip, ledger entry and refund ids that every other workspace uses. Opening the trip from a case opens the shared trip panel (`RecordLink`), not a copy.
2. **Customer conversation and internal notes are separate channels.** `CaseMessage.channel = 'customer'` is visible to the passenger or driver in their app; `'internal'` never leaves the admin. The composer makes the channel explicit before sending.
3. **Care investigates money; it does not move money.** Care can see payment context (`finance.view`) and request a refund (`refunds.request`). Every refund, and every other financial change, goes through an `ApprovalRequest` decided by finance or the owner, and is executed as ledger journals ([06-finance.md](06-finance.md)).
4. **Safety is a separate queue with restricted data.** Safety cases (`team = 'safety'`) are hidden from `/cases`; precise location needs `safety.location`; every view of restricted data is logged.
5. **Honest simulation.** In this build no emergency service and no GoBye responder is contacted. The rider app's emergency action opens the phone dialler for 112 (BR-120). The admin labels safety alerts in the test data as simulated.

---

## Module A · Support cases (`/cases`)

### 1. Users and permissions

| Role | Keys used here | What they can do |
|---|---|---|
| Customer care | `cases.view`, `cases.work`, `cases.assign`, `passengers.view`, `passengers.contact_details`, `drivers.view`, `trips.view`, `finance.view`, `refunds.request` | Work the queue, message customers, add notes, assign, escalate, resolve, request refunds |
| Accounting and finance | `refunds.approve`, `finance.view`, `ledger.view` | Decide refund requests from the case's refund panel or `/approvals` (see open question on `cases.view`) |
| Platform administrator | `cases.view` | Read cases (no changes) |
| Operations and dispatch | `cases.view`, `trips.view` | Read cases linked to trips they handle |
| Driver onboarding | `cases.view` | Read cases about drivers (documents, account) |
| Company owner | `cases.view`, `refunds.approve`, `approvals.decide` | Read; decide refund approvals |
| Auditor | `cases.view` (and every other `.view` except `safety.view`) | Read only, including internal notes |
| Safety | `cases.view`, `safety.*` | Read care cases; receive cases escalated to safety (A5) |

Rules: a staff member sees only cases in their city scope (`inCityScope`). Contact details (phone, email) are masked unless the viewer holds `passengers.contact_details` or `drivers.contact_details`. `/cases` lists `team = 'care'` only; safety cases never appear there, whatever the viewer's permissions.

### 2. Screens and navigation

| Route | Screen | Notes |
|---|---|---|
| `/cases` | Case queue | Role home for care (`ROLE_HOME.care`). Sidebar badge = care cases with status `new`. Tabs: **Mine**, **Unassigned**, **All open**, **Waiting**, **Resolved**. Filters: category, priority, status, city, date (global), linked record type |
| `/cases?id=cas-…` | Case drawer (record page) | Opens over the queue so the list position is kept. Deep linkable from any workspace and from audit entries |
| `/cases?new=1&tripId=…` | New case | Staff opened case, prefilled when started from a trip, passenger or driver panel |
| Shared panels | Trip, passenger, driver, refund | Opened by `RecordLink`; access tailored by the viewer's permissions |

Case drawer layout (top to bottom): header (ref `C-2400`, subject, status pill, priority pill, owner, city, opened by and when); **Linked records** (passenger, driver, trip, payment, refund chips); **Payment context** (trip fare, method, payment state, related collections and ledger entries; read only); **Conversation** tab (customer channel); **Internal notes** tab; **Actions and escalation** timeline; **Attachments**; **Resolution** panel; action bar.

### 3. Fields and data source

| Field | Source (record.field) | Notes |
|---|---|---|
| Reference | `CaseRecord.ref` | `C-` + number, shown to customers |
| Team | `CaseRecord.team` | `care` here |
| Category | `CaseRecord.category` | `payment`, `fare`, `driver_conduct`, `passenger_conduct`, `lost_item`, `app_problem`, `account`. (`safety` moves the case to Module B) |
| Priority | `CaseRecord.priority` | `urgent`, `high`, `normal`, `low`. Default from category (A5) |
| Status | `CaseRecord.status` | `CASE_FLOW` |
| Subject | `CaseRecord.subject` | 1 to 120 characters |
| Owner | `CaseRecord.ownerId` → `StaffMember` | Empty = unassigned |
| Opened | `openedAt`, `openedBy: Actor` | Passenger, driver, staff or system |
| City | `CaseRecord.city` | From the linked trip, else the person's city |
| Linked passenger | `links.passengerId` → `PassengerRecord` | Name, masked phone, status, trips, restriction |
| Linked driver | `links.driverId` → `DriverRecord` | Name, vehicle, verification, access |
| Linked trip | `links.tripId` → `TripRecord` | Ref, status, timeline, `agreedFare` (kobo), `paymentMethod`, `payment`, `directToDriver`, cancellation |
| Linked payment | `links.ledgerEntryId` → `LedgerEntry`; trip's `CollectionRecord` by reference | Amount (kobo), kind, provider, reference, status, webhook events incl. duplicates |
| Linked refund | `links.refundId` → `RefundRecord` | Amount (kobo), destination, status, approver |
| Conversation | `messages[channel='customer']` | Author, time, body (≤ 2,000 chars) |
| Internal notes | `messages[channel='internal']` | Never sent to apps |
| Actions | `actions[]` (`at`, `by`, `label`) | Append only; includes assignment, status changes, escalations, refund requests |
| Attachments | **Proposed** `attachments[]`: `{ id, name, contentType, sizeBytes, uploadedBy, at, channel }` | Not yet in `CaseRecord` (backend need). Stored in protected file storage; signed short lived URLs; `channel` decides customer visibility |
| Resolution | `resolution.summary`, `resolution.at`, `resolution.followUpAt` | Summary required to resolve |
| First response due, resolution due | **Proposed** SLA fields derived from priority | Placeholders for the owner to set (open question) |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Open case for a person or trip | `cases.work` | No | Creates `CaseRecord` (status `new`), audit `case.opened` |
| Assign to me / assign to colleague | `cases.assign` (self assign: `cases.work`) | No | Sets `ownerId`; action entry; notifies the assignee |
| Change priority | `cases.work` | No | Updates `priority`; reason required when lowering `urgent` or `high` |
| Change category | `cases.work` | No | Updates `category`; choosing `safety` triggers **Move to safety** (below) |
| Reply to customer | `cases.work` | No | Adds `customer` message; app inbox and push to the person; first reply moves `new` → `in_progress` |
| Add internal note | `cases.work` | No | Adds `internal` message; no notification outside staff |
| Add attachment | `cases.work` | No | Uploads to file storage; virus scan job; customer visible only if attached to a customer message |
| Mark waiting for customer | `cases.work` | No | `in_progress` → `waiting`; reminder job scheduled |
| Escalate | `cases.work` | No | → `escalated` with target (Finance, Operations, Onboarding, Safety, Owner) and reason; target team notified |
| Move to safety | `cases.work` | No | Creates a linked safety case (Module B) with the same links; care case gets action "Moved to safety" and is resolved with summary "Handled by safety" (the safety case is the record of work) |
| Request refund | `refunds.request` | **Yes**, `APPROVAL_RULES.refund` (finance or owner, never the requester) | Creates `RefundRecord` (`requested`) and `ApprovalRequest` (`refund`); links both to the case; no ledger change yet |
| Request cancellation fee waiver | `refunds.request` | **Yes** (refund) | Modelled as a refund of the fee amount (A5) |
| Request ledger correction | none in care | n/a | Care escalates to finance; finance raises `ledger_adjustment` ([06-finance.md](06-finance.md)) |
| Restrict passenger or driver | not in care | n/a | Shown disabled: "Needs Operations or Safety". Escalate instead |
| Resolve | `cases.work` | No | → `resolved`, resolution summary required, optional follow up date |
| Reopen | `cases.work` | No | `resolved` → `in_progress`, reason required |
| Close | `cases.work` | No | `resolved` → `closed`; also automatic after the follow up window (job) |
| Export case | `reports.export` | No | PDF or CSV of the case including internal notes; audit `case.exported` |

Refund decision (shown inside the case for those who can decide): **Approve** / **Reject** need `refunds.approve` and `canDecide` (not the requester). Effects are defined in [06-finance.md](06-finance.md) § Refunds and disputes.

### 5. Validation and approval rules

- Subject required; category required; at least one link (passenger, driver or trip) required for staff opened cases.
- Default priority: `payment` and `fare` → `high`; `driver_conduct`, `passenger_conduct`, `lost_item` → `normal`; `app_problem`, `account` → `low`. Staff can raise priority freely; lowering from `urgent`/`high` needs a reason.
- Status changes only along `CASE_FLOW`; the UI offers only `nextStatuses`. The backend rejects others with `409 INVALID_TRANSITION`.
- Resolve requires `resolution.summary` (10 to 1,000 chars). If a refund on the case is `requested`, `approved` or `processing`, resolve is blocked: "A refund on this case is still open."
- A customer message cannot be sent on a `closed` case; the person opens a new case, linked as "Follow up of C-…".
- Refund request: amount > 0 and ≤ the refundable amount of the linked payment (paid amount minus refunds already `completed` or in flight). Without a linked trip or collection, the request needs a reason category and goes to finance as a goodwill request (funding source is an open question). Destination: `wallet` or `original_method` (the latter only if the provider integration lists a refund capability and is `live`).
- Every refund needs approval (`thresholdKobo: 0`). Approver roles: `finance`, `owner`; the requester can never decide.
- Payment investigation is read only: care sees ledger entries linked to the trip or collection through `finance.view`, but has no button that posts a journal or edits a payment state.
- Bank transfer paid directly to a driver's personal account (`TripRecord.directToDriver`) is not money GoBye holds. Care cannot refund it from GoBye funds by default; it is a dispute between passenger and driver, routed to finance for a decision (see [06-finance.md](06-finance.md) flow d).

### 6. Status transitions

Transition table: `CASE_FLOW`.

| From | Allowed to | Typical trigger |
|---|---|---|
| `new` | `in_progress`, `escalated`, `resolved` | First reply or assignment; immediate escalation; duplicate resolved |
| `in_progress` | `waiting`, `escalated`, `resolved` | Waiting for customer; escalate; resolve |
| `waiting` | `in_progress`, `escalated`, `resolved` | Customer replies (automatic → `in_progress`) |
| `escalated` | `in_progress`, `resolved` | Target team hands back or resolves |
| `resolved` | `closed`, `in_progress` | Follow up window ends (job) or reopen |
| `closed` | none | Final. New contact opens a new linked case |

Refund status on the linked `RefundRecord` follows `REFUND_FLOW` (`requested` → `approved`/`rejected`; `approved` → `processing` → `completed`/`failed`; `failed` → `processing`).

### 7. Effects on other screens and apps

| Where | Effect |
|---|---|
| Rider app R26 Support, R18 Ride detail | Customer messages and status appear as a support conversation (API `GET /support/tickets/{id}`). Mapping of case status to the app's `open \| pending \| resolved`: `new`, `in_progress`, `escalated` → open; `waiting` → pending (copy "Waiting for your reply"); `resolved`, `closed` → resolved. Internal notes never sent |
| Driver app D17 Account → Support (planned) | Same as rider for cases opened by or about the driver where the driver is the customer |
| Trip panel (all workspaces) | "Cases" section lists linked cases with status |
| Passenger and driver panels | Support history count and list |
| `/finance/refunds`, `/approvals` | Refund request appears with case link |
| `/overview` | Unresolved case count by city ([02-oversight.md](02-oversight.md)) |
| `/audit` | Every change listed (`case.*`, `refund.requested`) |

### 8. Notifications and background jobs

| Trigger | Recipient | Channel |
|---|---|---|
| Case opened by passenger or driver | Care queue (badge); owner if `urgent` | Admin |
| Assigned | Assignee | Admin notification |
| Customer reply from staff | Passenger or driver | In app inbox + push (subject to preferences) |
| Customer replied | Owner of case | Admin |
| Escalated | Target team queue | Admin |
| Refund requested | Approvers (`finance`, `owner`) | `/approvals` badge |
| Refund decided or completed | Case owner (admin); customer (app inbox: "Your refund of ₦1,500 was approved" / "…has been added to your wallet") | Admin, app inbox, push |
| Resolved | Customer | In app inbox |

Jobs: `cases.sla-timer` (flags first response and resolution overdue; placeholder targets), `cases.waiting-reminder` (reminds customer after 24 h, auto `in_progress` alert to owner after 72 h; placeholders), `cases.auto-close` (closes `resolved` after the follow up date or 7 days), `files.scan` (attachment scanning), `notifications.send` (with retry; failures listed in `/developer/events`).

### 9. Loading, empty, pending, error and success states

| State | Copy and behaviour |
|---|---|
| Loading | Skeleton rows shaped like the table. Drawer: skeleton header and two message bubbles. Screen reader: "Loading cases" |
| Empty (no cases) | "No open cases. New cases from the apps appear here." |
| Empty (filters) | "No cases match these filters." Button: "Clear filters" |
| Empty (Mine) | "Nothing assigned to you. Pick a case from Unassigned." |
| Pending | Refund panel pill "Waiting for finance approval"; message pill "Sending"; refund `processing` pill "Refund in progress". Resolve disabled with reason "A refund on this case is still open." |
| Error (action) | Toast with the server message, drawer stays open and the draft is kept, e.g. "Couldn’t send the reply. Check your connection and try again." / "This case changed while you were working. Reload to see the latest." (409) |
| Error (linked record unavailable) | "Trip details are unavailable right now." The rest of the case stays usable |
| Restricted | "Contact details hidden. Needs passenger contact access." |
| Success | Toasts: "Reply sent", "Note added", "Case assigned to Ruth", "Refund requested. Finance will review it.", "Case resolved" |

### 10. Acceptance checks

1. Given a care agent, when they open `/cases`, then only `team = 'care'` cases in their city scope are listed and the badge equals the count of `new` care cases.
2. Given a case linked to trip T, when the agent opens the trip chip, then the shared trip panel opens with the same id that `/trips` and `/finance/collections` show for T.
3. Given an internal note, when the passenger opens Support in the rider app, then the note is not present in any API response to the app.
4. Given a case in `new`, when the agent sends a customer reply, then status becomes `in_progress`, an action entry and audit event are written, and the customer receives one inbox item.
5. Given a care agent on a paid trip, when they choose Request refund for ₦1,500, then a `RefundRecord` with status `requested` and an `ApprovalRequest` of kind `refund` exist, and no ledger entry is posted.
6. Given that same agent also holds the finance role, when they open the approval, then Approve is disabled with "You can’t approve your own request."
7. Given a refund amount above the refundable amount, when submitted, then it is refused with "Amount is more than what can be refunded (₦…)" and nothing is created.
8. Given an open refund on a case, when the agent tries to resolve, then resolve is blocked with "A refund on this case is still open."
9. Given a case in `closed`, when the customer writes again, then a new case is created and linked as a follow up.
10. Given an operations user, when they open a case, then they can read it but every action button is hidden or disabled with a reason.
11. Given an auditor, when they open a case, then all content including internal notes is readable and no action is available.
12. Given a category change to `safety`, when confirmed, then a safety case is created with the same links, the care case shows "Moved to safety", and the care agent cannot open the safety case unless they hold `safety.view`.
13. Given any change, then an `AuditEvent` with actor, action, target and (for priority lowering, reopen) reason is recorded.

### Backend needs

- Commands: `OpenCase`, `AssignCase`, `ChangeCasePriority`, `ChangeCaseCategory`, `PostCaseMessage {channel}`, `AddCaseAttachment`, `ChangeCaseStatus {to, reason?}`, `EscalateCase {target, reason}`, `MoveCaseToSafety`, `ResolveCase {summary, followUpAt?}`, `RequestRefund {caseId?, tripId?, amountKobo, destination, reason}`; app side `POST /support/tickets`, `POST /support/tickets/{id}/messages`.
- Events: `case.opened`, `case.assigned`, `case.message_added`, `case.note_added`, `case.status_changed`, `case.escalated`, `case.moved_to_safety`, `case.resolved`, `case.closed`, `refund.requested`.
- Jobs: `cases.sla-timer`, `cases.waiting-reminder`, `cases.auto-close`, `files.scan`, `notifications.send`.
- Data: add `attachments[]` and SLA due fields to `CaseRecord`; optimistic concurrency `version` (API_CONTRACTS §1); store case status mapping for the apps.

**Open question:** finance approves refunds but does not hold `cases.view`, so it cannot open the case behind a refund. Recommendation: give `finance` `cases.view`, or show a case summary inside the approval.
**Open question:** care holds `finance.view`, which today opens every finance page in `nav.tsx` (settlements, reconciliation). Should care see only payment context on its own cases?
**Open question:** funding source for goodwill refunds (no failed or duplicate charge): promotions expense, a separate goodwill expense, or clawback from driver earnings. The test data books it to `promotions_expense`.
**Open question:** first response and resolution targets per priority.
**Open question:** lost item process (driver contact, return fee) beyond messaging.

---

## Module B · Safety (`/safety`)

### 1. Users and permissions

| Role | Keys | What they can do |
|---|---|---|
| Safety | `safety.view`, `safety.work`, `safety.location`, `trips.view`, `passengers.view`, `passengers.contact_details`, `drivers.view`, `drivers.contact_details`, `passengers.restrict`, `drivers.restrict`, `cases.view` | Full response: acknowledge, contact, view location, escalate, restrict accounts, resolve |
| Company owner | `safety.view` | Read the queue and timeline. **No `safety.location`**: location is masked unless the owner is also given the safety role |
| Auditor | none | `safety.view` is excluded from the auditor by construction; safety cases are not visible. Access logs are visible in `/audit` without location values |
| Everyone else | none | `/safety` hidden; safety cases are excluded from `/cases`, search and exports |

"Designated responders" are staff with the safety role who are marked on call for a city (proposed field `onCall: { cities, from, until }` on `StaffMember`; not yet in code).

### 2. Screens and navigation

| Route | Screen | Notes |
|---|---|---|
| `/safety` | Safety queue | Role home for safety. Sidebar badge = safety cases not `resolved` or `closed`. Sorted by priority, then age; `urgent` and unacknowledged first. Live timer shows minutes since alert |
| `/safety?id=saf-…` | Safety case | Header (ref `S-310`, subject, status, owner, elapsed time), **Trip context** (live status, pickup, destination, driver, vehicle plate, passenger), **Location** (restricted panel), **Responders**, **Escalation timeline**, **Customer contact** and **Internal notes** (same channel rule as care), **Account actions**, **Resolution** |
| Shared panels | Trip, passenger, driver | Location never shown in shared panels; only inside the safety case |

### 3. Fields and data source

| Field | Source | Access |
|---|---|---|
| Ref, subject, status, priority, owner, city | `CaseRecord` with `team = 'safety'`, `category = 'safety'` | `safety.view` |
| Opened by, opened at | `openedBy` (passenger or driver, or system "Safety alert") | `safety.view` |
| Linked trip, passenger, driver | `links.*` | `safety.view` + `trips.view` |
| Passenger and driver phone | `PassengerRecord.phone`, `DriverRecord.phone` | `*.contact_details` |
| Last known location | `safetyContext.lastLocation`, `sharedAt` | **`safety.location`**; masked otherwise ("Location restricted") |
| Responders notified | `safetyContext.responders` | `safety.view` |
| Escalation timeline | `actions[]` | `safety.view` |
| Messages | `messages[]` (`customer`, `internal`) | `safety.view` |
| Resolution | `resolution` | `safety.view` |
| Access log | **Proposed** `SafetyAccessLog { caseId, staffId, field, at, reason }` | Written on every location view or export; readable in `/audit` (no values) |

Location in this build is a text placeholder ("Wuse 2, Abuja (approximate)"); there is no live position stream (D-026: driver location is ingested only while online; rider location is not tracked).

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Acknowledge | `safety.work` | No | Sets owner to self, `new` → `in_progress`; stops the escalation timer; action "Acknowledged by …" |
| Reveal location | `safety.location` | No (reason required) | Shows `lastLocation`; writes access log and audit `safety.location_viewed` |
| Call passenger / driver | `safety.work` + `*.contact_details` | No | Reveals number for dialling; action "Called passenger"; access log |
| Message customer | `safety.work` | No | Customer channel message (app inbox + push) |
| Add internal note | `safety.work` | No | Internal channel |
| Escalate | `safety.work` | No | → `escalated`; target: safety lead on call, owner, or external services (recorded as "Advised to call 112"; GoBye does not contact services itself in this build) |
| Restrict driver | `drivers.restrict` | No (reason required) | Driver `suspended` via `VERIFICATION_FLOW` (`approved` → `suspended`); forced offline; see [09-connections.md](09-connections.md) |
| Restrict passenger | `passengers.restrict` | No (reason required) | Passenger `restricted` with reason and optional end date |
| Request refund | none in safety | n/a | Hand over to care: "Create care case" creates a linked care case |
| Resolve | `safety.work` | No | Summary required; responders notified |
| Close | `safety.work` | No | `resolved` → `closed` |
| Export | `safety.location` + `reports.export` | No | Only for legal or police requests; reason required; access log |

### 5. Validation and approval rules

- Every app safety alert creates a case with `team = 'safety'`, `category = 'safety'`, `priority = 'urgent'`. Priority cannot be lowered below `high` while the linked trip is active.
- Location reveal, phone reveal and export require a reason (preset list: "Responding to alert", "Following up", "Legal request", other with text).
- Restricting an account during an active trip shows a warning: "The trip in progress continues. New requests stop." (aligns with BACKEND_HANDOVER §3 access rules).
- Resolve requires a summary and an outcome code (proposed: `safe_no_action`, `coaching`, `account_restricted`, `referred_to_authorities`, `false_alarm`).
- Two person rule is not applied to safety actions (speed matters); every action is audited instead. Lifting a driver suspension follows `VERIFICATION_FLOW` (`suspended` → `approved`) and is an onboarding or safety decision with reason.

### 6. Status transitions

Same `CASE_FLOW` as care. Safety specific timing rules (placeholders for the owner):

| Rule | Value (placeholder) |
|---|---|
| Unacknowledged `new` safety case escalates to the safety lead | 2 minutes |
| Still unacknowledged, escalate to owner | 5 minutes |
| `waiting` allowed only after the trip has ended | |
| Auto close | Never automatic; a person closes |

### 7. Effects on other screens and apps

| Where | Effect |
|---|---|
| Rider app R13 Trip, HelpSheet, R25 Safety | **Proposed** "Alert GoBye safety" action beside "Emergency: call 112". On send: "Safety team alerted" with time. In this build the app only opens the dialler (BR-120) and must keep saying "GoBye alerts nobody" until the backend exists |
| Driver app D13 Active trip (planned) | Same alert action for drivers |
| Live operations `/live` | Trip shows a safety marker; operations sees "Safety case open" but not location |
| Trip panel | Shows "Safety case S-310" link only to `safety.view` holders; others see "Restricted case" without content |
| Driver panel, driver app | On restriction: driver status `suspended`, forced offline (`driver.availability_forced`, reason `suspended`) |
| `/overview` | Count of open safety cases (no details) |

### 8. Notifications and background jobs

| Trigger | Recipient | Channel |
|---|---|---|
| Safety alert raised | Designated responders for the city | Admin alert with sound, push to staff device (proposed), SMS fallback (proposed) |
| Not acknowledged in 2 min | Safety lead on call | Same |
| Not acknowledged in 5 min | Owner | Same |
| Acknowledged | Alerting passenger or driver | In app: "Our safety team is on it" |
| Resolved | Alerting person | In app inbox |

Jobs: `safety.escalation-timer`, `safety.responder-notify` (fan out with delivery tracking; a failed responder notification is itself an alert in `/developer/events` and on the case: "Responder notification failed for Daniel. Call the on call lead."), `safety.access-log` (append only writer).

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Skeleton queue. "Loading safety cases" |
| Empty | "No open safety cases." (No call to action) |
| Pending | "Waiting for acknowledgement · 1 min" pill; "Notifying responders" while fan out runs |
| Restricted | Location panel: "Location restricted. Needs safety location access." |
| Error | "Couldn’t notify all responders. Call the on call lead." (persistent banner, not a toast) / "Couldn’t load trip details. The case is still open." |
| Simulated | Banner on every safety case in the prototype: "Test data. No one has been alerted." |
| Success | "Acknowledged", "Location viewed and logged", "Driver restricted", "Case resolved" |

### 10. Acceptance checks

1. Given a passenger in an active trip, when they send a safety alert, then within one request a safety case exists with `priority = 'urgent'`, links to that trip, passenger and driver, `safetyContext` filled, and responders for that city notified.
2. Given the same alert delivered twice (retry), then exactly one case exists (idempotency key on the alert).
3. Given no acknowledgement for 2 minutes, then the safety lead is notified and the timeline shows "Escalated automatically".
4. Given a care agent, when they search for the alerting passenger, then the safety case is not listed in `/cases` and the trip panel shows "Restricted case".
5. Given the owner without the safety role, when they open the case, then location shows "Location restricted" and no access log is written for location.
6. Given a safety responder, when they reveal location with a reason, then an access log entry and audit event `safety.location_viewed` exist.
7. Given an auditor, then `/safety` is absent from the sidebar and direct navigation shows "You don’t have access to this page."
8. Given a responder restricts the driver during the trip, then the driver is `suspended`, cannot go online, and the active trip is not cancelled.
9. Given a resolve without an outcome code, then it is refused.
10. Given the prototype, then every safety case shows the simulated banner and the rider app keeps the BR-120 copy.

### Backend needs

- Commands: `RaiseSafetyAlert {tripId?, by, idempotencyKey}` (app), `AcknowledgeSafetyCase`, `RevealSafetyLocation {reason}`, `RevealContact {reason}`, `EscalateSafetyCase {target, reason}`, `RestrictDriver`, `RestrictPassenger`, `ResolveSafetyCase {summary, outcome}`.
- Events: `safety.alert_raised`, `case.opened` (team safety), `safety.responders_notified`, `safety.responder_notification_failed`, `safety.acknowledged`, `safety.escalated`, `safety.location_viewed`, `driver.restricted`, `passenger.restricted`, `case.resolved`.
- Jobs: `safety.escalation-timer`, `safety.responder-notify`, `safety.access-log`.
- Data: `StaffMember.onCall`; `SafetyAccessLog`; location snapshot captured at alert time from the trip's latest driver ping (retention per Q-016).

**Open question:** who is the safety lead and the on call rota per city; is there a 24 hour service at launch.
**Open question:** should the in app alert contact anyone outside GoBye (trusted contact, emergency services)? Today the app only opens the dialler for 112.
**Open question:** should the owner hold `safety.location` by default?
**Open question:** retention period for safety case location data (Q-016).

---

## What is simulated in the prototype

| Part | Prototype behaviour |
|---|---|
| Cases and safety cases | Seeded test data (10 care cases, 3 safety cases) in `createPlatformDataset()`; changes through `act()` in the browser only |
| Customer messages | Not delivered to any app; the rider app's Support (R26) submits a simulated request that does not reach the admin |
| Safety alert from the app | Not connected. Rider app opens the dialler for 112 (BR-120); the three safety cases are invented |
| Responder notifications | Only an action line "responders notified"; nothing is sent |
| Location | Approximate text placeholder, not a position |
| Attachments, SLA timers, escalation timers, access logs | Not built; specified here |
| Refund execution | Approval and ledger journal in the test dataset only; no provider call |
