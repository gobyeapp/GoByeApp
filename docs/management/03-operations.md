# 03. Operations

Modules: [Passengers](#module-passengers) (`/passengers`), [Drivers and verification](#module-drivers-and-verification) (`/drivers`), [Trips](#module-trips) (`/trips`), [Live operations](#module-live-operations) (`/live`). Shared rules: [01-foundation.md](01-foundation.md). Back to [README.md](README.md).

All four modules open the **shared record panels** (`RecordLink`, `apps/admin/src/data/records.tsx`): the passenger, driver or trip panel is the same from every workspace, tailored by permission (README §3).

---

## Module: Passengers

### 1. Users and permissions

| Permission | Holders | Allows |
|---|---|---|
| `passengers.view` | owner, admin, operations, care, safety, finance, auditor | List, profile, trips, cases summary |
| `passengers.contact_details` | care, safety | Phone and email |
| `passengers.restrict` | admin, safety | Restrict, lift restriction |
| `finance.view` or `ledger.view` | owner, care (`finance.view`), finance, auditor | Wallet balance |
| `cases.view` | owner, admin, operations, onboarding, care, safety, auditor | Support history |

### 2. Screens and navigation

`/passengers`: search (name, phone for contact holders, passenger id, trip ref), filters (status, city via global filter), table (name, city, joined, trips, last trip, rating, status). Row opens the passenger panel: status, restriction, contact (masked by role), trips (latest 8, link to trip panel; "All trips" opens `/trips?passenger=`), wallet balance, support history (cases list, link to `/cases`), Activity (audit). Actions in the panel footer.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Id | string | `passenger.id` | `pas-0001` |
| Name | string | `passenger.name` | |
| Phone | string | `passenger.phone` | `passengers.contact_details` only; searchable by those holders only |
| Email | string | `passenger.email` | optional; same permission |
| City | CityId | `passenger.city` | Home city; trips carry their own city |
| Joined | time | `passenger.joinedAt` | Date filter field for the list |
| Status | enum | `passenger.status` | active, restricted, closed |
| Restriction | object | `passenger.restriction` | reason, until (optional), by |
| Trips | number | `passenger.trips` | Completed trips (target: derived from trips) |
| Last trip | time | `passenger.lastTripAt` | |
| Rating | number | `passenger.rating` | Average from drivers, one decimal |
| Wallet balance | Kobo | `balanceOf(ledger, passenger_wallet:{id})` | Finance permissions only; liability |
| Outstanding payment | Kobo | trips with `status = payment_pending` | "Payment outstanding ₦3,200" |
| Support cases | list | `case.links.passengerId` | Care cases; safety cases only with `safety.view` |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Restrict | `passengers.restrict` | No (reason required) | `status → restricted`; `restriction = { reason, until?, by }`; audit `passenger.restricted` |
| Lift restriction | `passengers.restrict` | No (reason required) | `status → active`; restriction cleared; audit `passenger.unrestricted` |
| Close account (target) | `passengers.restrict` | No (reason required) | `status → closed`; only on the passenger's request or a confirmed fraud case |
| Open case for passenger | `cases.work` | No | New care case linked to passenger ([05-care-safety.md](05-care-safety.md)) |
| Request refund | `refunds.request` | `refund` | See [06-finance.md](06-finance.md) |

Staff can never edit a passenger's wallet balance, rating or trip count.

### 5. Validation and approval rules

Reason 5 to 300 characters; `until`, if set, must be in the future; a passenger on an active trip can be restricted but the trip continues (the restriction applies to new bookings). Closing an account with a wallet balance above ₦0 is refused until the balance is resolved. **Open question:** passenger wallet withdrawal policy (refund of unused balance on closure or on request), brief §5.

### 6. Status transitions

**Proposed** (`PassengerRecord.status`, add to `workflows.ts`):
- `active → restricted | closed`
- `restricted → active | closed`
- `closed`: final

### 7. Effects on other screens and apps

- **Rider app:** restricted passengers cannot request a trip; Home shows "Your account is restricted. Contact support." with the support entry. They can still pay an outstanding trip, see receipts and their wallet. Closed: signed out; sign in shows "This account is closed."
- **Care:** restriction and reason appear in case context. **Operations:** restricted passengers do not appear in matching.

### 8. Notifications and background jobs

Restriction and lift: push and inbox message to the passenger (copy without internal reason: "Your account is restricted while we review a recent trip."). **Job `passengers.restriction_expiry`** (every 15 min): lifts restrictions past `until`, audit actor `system`.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Table skeleton; panel skeleton |
| Empty | "No passengers match your search." / "No trips yet" in panel |
| Pending | Restriction with `until`: "Restricted until 24 Oct" |
| Error | "Couldn't restrict this passenger. Nothing was changed." |
| Success | "Passenger restricted" / "Restriction lifted" |

### 10. Acceptance checks

1. Given an operations user, when they open a passenger, then phone and email show "Hidden for your role".
2. Given a care user, when they search by phone, then matching passengers appear; given an operations user, then phone search is not offered.
3. Given an admin restricts `pas-0003` with a reason, then status is `restricted`, the panel shows the reason and an audit event `passenger.restricted` exists.
4. Given a restriction without a reason, then the dialog refuses with "Add a reason".
5. Given a restricted passenger, when they request a trip in the rider app (backend), then the request is refused with `passenger_restricted`.
6. Given a Lagos scoped staff member, when they open an Abuja passenger by id, then the API returns not found.
7. Given the auditor, then the panel is read only and the wallet balance is visible.

### Backend needs

- `GET /admin/passengers?q=&status=&city=`; `GET /admin/passengers/{id}`; `POST /admin/passengers/{id}/restrict`, `/unrestrict`, `/close`.
- Events `passenger.restricted`, `passenger.unrestricted`; rider API check on trip request. Job `passengers.restriction_expiry`.

---

## Module: Drivers and verification

### 1. Users and permissions

| Permission | Holders | Allows |
|---|---|---|
| `drivers.view` | owner, admin, operations, onboarding, care, safety, finance, auditor | List, profile, vehicle, documents, access |
| `drivers.verify` | admin, onboarding | Review queue, document decisions, approve, reject, request documents |
| `drivers.restrict` | admin, safety | Suspend, reinstate |
| `drivers.contact_details` | onboarding, safety | Phone |
| `finance.view` | owner, care, finance, auditor | Withdrawable earnings, payout account (also `drivers.verify` for the account) |

### 2. Screens and navigation

`/drivers` (homepage for onboarding) with tabs:
- **Review queue**: `applied`, `documents_pending`, `in_review`, oldest first, with waiting time. Badge = `applied` + `in_review`.
- **Expiring documents**: approved drivers with a document expired or expiring within 30 days, soonest first.
- **All drivers**: search (name, plate, id, phone for contact holders), filters (verification, access, online).

Row opens the driver panel: status pills (verification, access, online), vehicle, documents (each with status, expiry, preview image, Accept / Reject for `drivers.verify`), access package, earnings (finance), cases, Activity. Footer actions per status.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Id, name | string | `driver.id`, `driver.name` | |
| Phone | string | `driver.phone` | `drivers.contact_details` |
| City | CityId | `driver.city` | |
| Applied | time | `driver.appliedAt` | Date filter field for the queue |
| Verification | enum | `driver.verification` | applied, documents_pending, in_review, approved, rejected, suspended |
| Rejection reason | string | `driver.rejectionReason` | Shown to the driver |
| Documents | list | `driver.documents[]` | kind, status, expiresAt, note |
| Vehicle | object | `driver.vehicle` | make, model, colour, year, plate, category (`go` = GoBye Car) |
| Access | object | `driver.access` | packageId (daily, monthly), expiresAt; null = none |
| Access active | boolean | `access.expiresAt > now` | |
| Eligible to go online | boolean | computed | approved AND access active AND no required document expired |
| Online | boolean | `driver.online` | |
| Rating, trips, acceptance | number | `driver.rating`, `trips`, `acceptanceRate` | |
| Withdrawable | Kobo | `withdrawable(ledger, id)` | `finance.view` |
| Payout account | object | `driver.bankAccount` | bank, masked number, name, verified |

**Required documents** (`DocumentKind`): all six must be `accepted` to approve.

| Document | Expires | Notes |
|---|---|---|
| `licence` (driver's licence) | Yes | |
| `vehicle_registration` | Yes | |
| `insurance` | Yes | |
| `roadworthiness` | Yes | |
| `id_card` (government ID) | No | |
| `photo` (profile photo) | No | Shown to passengers |

**Open question:** whether a guarantor, police check or an identity verification provider is required (identity provider not chosen, `int-idv`).

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Start review | `drivers.verify` | No | `applied | documents_pending → in_review` |
| Accept document | `drivers.verify` | No | document `submitted → accepted` |
| Reject document | `drivers.verify` | No (note required) | document `→ rejected` with note; driver asked to resubmit |
| Request documents | `drivers.verify` | No (note) | `in_review → documents_pending` |
| Approve driver | `drivers.verify` | No | `in_review → approved`; audit `driver.approved` |
| Reject application | `drivers.verify` | No (reason required) | `→ rejected`, `rejectionReason` set |
| Reopen rejected | `drivers.verify` | No | `rejected → in_review` after resubmission |
| Suspend | `drivers.restrict` | No (reason required) | `approved → suspended`; forced offline |
| Reinstate | `drivers.restrict` | No (reason required) | `suspended → approved` |
| Remove permanently | `drivers.restrict` | No (reason required) | `suspended → rejected` |

Staff cannot grant, extend or cancel an access package here; packages are bought by the driver ([04-configuration.md](04-configuration.md#module-driver-packages)). **Open question:** complimentary or compensation access (for example after an outage) and who may grant it.

### 5. Validation and approval rules

- Approve only when every required document is `accepted`, no expiring document expires within 7 days (placeholder), vehicle fields complete, vehicle year at least 2010 (placeholder), and the vehicle category is enabled in the version in force.
- Reviewer and approver may be the same person (no approval rule); **Open question:** four eyes on driver approval.
- A person cannot review a driver application in a city outside their scope.
- Suspending a driver who is on a trip: the trip continues unless Operations or Safety intervenes; no new requests.

### 6. Status transitions

From `VERIFICATION_FLOW` (`workflows.ts`):
- `applied → documents_pending | in_review | rejected`
- `documents_pending → in_review | rejected`
- `in_review → approved | documents_pending | rejected`
- `approved → suspended`
- `rejected → in_review`
- `suspended → approved | rejected`

Document status, **proposed** (add to `workflows.ts`):
- `missing → submitted`
- `submitted → accepted | rejected`
- `rejected → submitted`
- `accepted → expired` (job only)
- `expired → submitted`

### 7. Effects on other screens and apps

- **Driver app:** approval shows "You're approved" and the path to buy an access package; eligibility to go online is recalculated (brief §9). Rejection shows the reason and how to resubmit. Document rejected: the document row asks for a new upload. Suspension: driver forced offline, "Your account is suspended. Contact support."; Go online refused (`driver_suspended`).
- **Document expiry:** driver becomes ineligible (BR-071): Go online refused with "Your insurance has expired. Upload a new document." Verification stays `approved`.
- **Operations:** only eligible drivers count as available. **Finance:** payout account verification is shown; suspension does not freeze earnings (**Open question:** whether withdrawals pause during suspension).

### 8. Notifications and background jobs

- Push, inbox and SMS (when chosen) to the driver on: documents requested, document rejected, approved, rejected, suspended, reinstated.
- **Job `drivers.document_expiry`** (daily 06:00 WAT): marks `accepted` documents past `expiresAt` as `expired` (actor `system`), notifies the driver at 30, 7 and 1 days before expiry and on expiry, and forces an online driver offline after any active trip.
- **Job `drivers.review_sla`** (hourly): flags applications waiting more than 48 hours (placeholder) in the queue.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Queue skeleton; document image placeholders |
| Empty | Review queue: "No applications waiting." Expiring: "No documents expire in the next 30 days." |
| Pending | "In review", "Documents pending" pills (warning); Approve disabled with "2 documents not accepted yet" |
| Error | "Couldn't approve this driver. Nothing was changed." Conflict: "This driver was updated by someone else. Refresh." |
| Success | "Driver approved. They can go online once they have access." / "Application rejected. The driver has been told why." |

### 10. Acceptance checks

1. Given a driver `in_review` with all six documents accepted, when an onboarding user approves, then verification is `approved`, an audit event `driver.approved` exists and the driver app shows the next step.
2. Given a driver with `insurance` missing, then Approve is disabled with the count of documents not accepted.
3. Given an `approved` driver, then Approve and Reject are not offered; Suspend is offered only to `drivers.restrict` holders.
4. Given a rejection without a reason, then it is refused.
5. Given an approved driver whose insurance `expiresAt` passes, when `drivers.document_expiry` runs, then the document is `expired`, the driver is ineligible, and Go online is refused.
6. Given an approved driver without active access, then "Eligible to go online" is No with "No active access package".
7. Given an onboarding user, then the payout account is visible and withdrawable earnings show "Hidden for your role".
8. Given `stf-ops-abj` (operations + onboarding, Abuja), then the queue shows Abuja drivers only and they can approve them.
9. Given an attempted transition not in `VERIFICATION_FLOW` (for example `applied → approved`), then the API returns `invalid_transition`.

### Backend needs

- `GET /admin/drivers?tab=&q=&verification=`; `GET /admin/drivers/{id}`; `POST /admin/drivers/{id}/review`, `/approve`, `/reject`, `/request-documents`, `/suspend`, `/reinstate`; `POST /admin/drivers/{id}/documents/{kind}/accept`, `/reject`.
- Secure document storage with signed, short lived URLs (storage provider not chosen).
- Events `driver.approved`, `driver.rejected`, `driver.suspended`, `driver.reinstated`, `driver.document_expired`. Jobs `drivers.document_expiry`, `drivers.review_sla`.

---

## Module: Trips

### 1. Users and permissions

| Permission | Holders | Allows |
|---|---|---|
| `trips.view` | owner, admin, operations, care, safety, finance, auditor | Search, trip panel |
| `trips.intervene` | operations | Cancel on behalf, end trip, check payment again, raise case |
| `ledger.view` | owner, finance, auditor | Ledger entries in the trip panel |

### 2. Screens and navigation

`/trips`: search by trip ref (`#0001A3`), trip id, passenger, driver, place; filters: status, payment state, mode (Quick Match, Negotiate), payment method, city and date (global; date field `requestedAt`). Table: ref, city, requested, route (pickup to destination), status, payment, fare. Row opens the trip panel: status and payment pills, route, mode, suggested and agreed fare, method, passenger and driver links, cancellation, pickup delay, direct to driver notice, status timeline, ledger entries (`ledger.view`), linked cases (care with `cases.view`, safety with `safety.view`), Activity.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Id, ref | string | `trip.id`, `trip.ref` | Ref is what passengers quote |
| City | CityId | `trip.city` | |
| Passenger, driver | ref | `trip.passengerId`, `trip.driverId` | Driver empty until matched |
| Pickup, destination | string | `trip.pickup`, `trip.destination` | |
| Requested, completed | time | `trip.requestedAt`, `trip.completedAt` | |
| Status | TripStatus | `trip.status` | Labels from `TRIP_STATUS` |
| Mode | enum | `trip.mode` | quick_match, negotiate |
| Suggested fare | Kobo | `trip.suggestedFare` | From fare version in force (BR-020) |
| Agreed fare | Kobo | `trip.agreedFare` | Locked at booking (BR-031, BR-046); "Negotiated" when mode is negotiate |
| Payment method | enum | `trip.paymentMethod` | wallet, bank_transfer (D-023); chosen after the trip (D-030) |
| Payment state | TripPaymentState | `trip.payment` | Labels from `PAYMENT_STATE` |
| Paid directly to driver | boolean | `trip.directToDriver` | Recorded only; not credited to earnings; cannot be verified automatically |
| Cancellation | object | `trip.cancellation` | by, reason, fee (Kobo) |
| Pickup delay | seconds | `trip.pickupDelaySeconds` | Beyond first estimate |
| Timeline | list | `trip.timeline[]` | at, label |
| Fare version | id | **missing**: `trip.fareConfigVersionId` | Needed to preserve terms (04 §Versioning) |
| Ledger entries | list | `ledger` where `links.tripId = id` | `ledger.view` |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Cancel on behalf | `trips.intervene` | No (reason required) | Status `→ cancelled`, `cancellation.by = system`, fee ₦0; allowed up to `arrived` (BR lifecycle, D-019) |
| End trip on behalf | `trips.intervene` | No (reason required) | `in_progress → payment_pending` when the driver app cannot (for example phone died) |
| Check payment again | `trips.intervene` | No | Asks the provider for the current result of the trip's collection; never marks paid without a verified result |
| Raise care case | `trips.intervene` or `cases.work` | No | New care case linked to the trip |
| Request refund | `refunds.request` | `refund` | [06-finance.md](06-finance.md) |

Staff can never change a fare, mark a trip paid by hand, or edit the timeline.

### 5. Validation and approval rules

Cancel only from `searching`, `matched`, `en_route`, `arrived`; not once `in_progress` (D-019). End trip only from `in_progress`. Reason 5 to 300 characters. Conflict if the trip changed status since it was opened.

### 6. Status transitions

**Proposed** `TRIP_FLOW` (not yet in `workflows.ts`; follows BUSINESS_RULES §9 and D-030):
- `searching → matched | no_driver | cancelled`
- `matched → en_route | cancelled`
- `en_route → arrived | cancelled`
- `arrived → in_progress | cancelled`
- `in_progress → payment_pending`
- `payment_pending → completed`
- `completed`, `cancelled`, `no_driver`: final

**Proposed** `TRIP_PAYMENT_FLOW` (`TripPaymentState`):
- `not_due → pending` (trip ended; also a cancellation fee due)
- `pending → processing | paid`
- `processing → paid | failed | pending` (transfer not seen yet returns to pending, never failed, D-030)
- `failed → processing | pending`
- `paid → refunded | partly_refunded`
- `partly_refunded → refunded`

`paid` only from a server verified result (wallet journal posted, or provider confirmation). **Open question:** how a direct transfer to the driver's own account is marked settled (driver confirms receipt in the driver app?) and whether it then counts as `paid` with `directToDriver = true`.

### 7. Effects on other screens and apps

- Cancel on behalf: rider and driver apps show "This trip was cancelled by GoBye" with the support entry; no fee; the driver returns to available.
- End trip on behalf: rider app moves to the payment stage (`trip-complete`).
- Payment confirmed: rider app shows payment success then summary (D-036); driver earnings update; Finance sees the journal.
- Live operations and the overview update from the same trip.

### 8. Notifications and background jobs

Push and inbox to both parties on cancel or end on behalf. **Job `trips.payment_watch`** (every minute): asks the provider about `processing` payments older than 2 minutes (placeholder) and moves stale `pending` trips into the Live "Stuck payments" queue after 30 minutes.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Table skeleton; panel skeleton |
| Empty | "No trips match these filters. Try All time." |
| Pending | "Payment due", "Confirming" (warning); "Transfer not seen yet" |
| Error | "Couldn't cancel this trip. Nothing was changed." / "The trip has already started, so it can't be cancelled." |
| Success | "Trip cancelled. Both apps have been told." / "Payment confirmed" / "Still waiting for the payment. We'll keep checking." |

### 10. Acceptance checks

1. Given trip ref `#0001A3`, when any role with `trips.view` searches it, then the same trip id opens with the same status from `/trips`, a case and a ledger entry.
2. Given a care user, then the trip panel shows linked care cases and no ledger entries; given finance, then ledger entries show.
3. Given a negotiated trip, then both suggested and agreed fares show and "Negotiated fare" is labelled.
4. Given a trip `in_progress`, then Cancel on behalf is not offered.
5. Given an operations user cancels a `matched` trip with a reason, then status is `cancelled`, `cancellation.by = system`, fee ₦0, and an audit event exists.
6. Given a bank transfer trip not yet seen, then payment shows "Pending", never "Failed".
7. Given a `directToDriver` trip, then the panel explains it is recorded only and no `driver_trip_earning` entry exists for it.
8. Given "Check payment again" with no provider result, then the payment state does not change to paid.

### Backend needs

- `GET /admin/trips?q=&status=&payment=&mode=&method=`; `GET /admin/trips/{id}`; `POST /admin/trips/{id}/cancel`, `/end`, `/check-payment`, `/raise-case`.
- Store `fareConfigVersionId` and `cancellationConfigVersionId` on each trip. Events `trip.cancelled_by_ops`, `trip.ended_by_ops`. Job `trips.payment_watch`.

---

## Module: Live operations

Shows **problems first**, not general statistics (brief §3).

### 1. Users and permissions

| Permission | Holders | Allows |
|---|---|---|
| `live.view` | owner, admin, operations, auditor | See queues and availability |
| `live.dispatch` | operations | Re-dispatch, offer to a driver |
| `trips.intervene` | operations | Cancel on behalf, end trip, check payment, raise case, alert safety |

### 2. Screens and navigation

`/live` (operations homepage). Refreshes every 15 seconds (target, server push or polling; prototype simulated, labelled "Simulated live data"). Layout:

1. **Problem queues** (each a list sorted by severity then age, with count):
   - Delayed pickups: `en_route` with `pickupDelaySeconds > 300` (placeholder 5 min).
   - Matching failures: `searching` longer than 60 s (BR-032) and `no_driver` in the last hour.
   - Stuck payments: `payment_pending` longer than 30 min, `processing` longer than 5 min (placeholders).
   - Cancellations: cancellations in the last hour per city, flagged when above 2× the same hour last week (placeholder).
2. **Driver availability** per city: online and free, on a trip, eligible but offline, access expiring in 24 hours, ineligible because of expired documents.
3. **Active journeys**: all trips in `matched`, `en_route`, `arrived`, `in_progress`, with elapsed time.

The sidebar badge counts `searching` trips plus pickups delayed more than 5 minutes. Global city filter applies; date filter does not ("Now").

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Problem item | trip | `trip` | ref, city, status, age = now − last timeline time |
| Delay | seconds | `trip.pickupDelaySeconds` | "9 min late" |
| Searching for | seconds | now − `trip.requestedAt` | |
| Payment waiting | seconds | now − `trip.completedAt` | |
| Cancellations last hour | count | trips `cancelled` with cancel time in last hour | by city, by party |
| Online free | count | drivers `online` with no active trip | |
| On trip | count | distinct `driverId` of active journeys | |
| Eligible offline | count | approved, access active, no expired document, not online | |
| Access expiring | count | `access.expiresAt` within 24 h | |
| Driver location | point | **target** live location service | Not in the data model; simulated only (D-026) |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Re-dispatch | `live.dispatch` | No | Restarts matching for a `searching` trip with a wider radius (placeholder +2 km) |
| Offer to a driver | `live.dispatch` | No | Sends the request to one chosen eligible, free driver in the same city; driver may decline |
| Cancel on behalf | `trips.intervene` | No (reason) | As in Trips |
| End trip on behalf | `trips.intervene` | No (reason) | As in Trips |
| Check payment again | `trips.intervene` | No | As in Trips |
| Raise care case | `trips.intervene` | No | Care case linked to trip, unassigned |
| Alert safety | `trips.intervene` | No | Creates an urgent safety case with trip context and notifies responders ([05-care-safety.md](05-care-safety.md)) |
| Acknowledge | `live.dispatch` | No | Marks a problem as being handled by me (shown to others); clears when the trip moves on |

**Open question:** operations does not hold contact permissions, so dispatchers cannot phone a late driver or waiting passenger. Options: give operations `drivers.contact_details`, or add an in platform masked call or message relay (provider not chosen).

### 5. Validation and approval rules

Offer to a driver only if the driver is eligible (BR-070, BR-072), online, free, same city and category; never to a driver already offered this trip in the last 2 minutes. No driver can be assigned to two active trips (BR-047). Interventions follow the Trips rules.

### 6. Status transitions

Uses the proposed `TRIP_FLOW` and `TRIP_PAYMENT_FLOW` (Trips §6). Re-dispatch keeps `searching`. Offer to a driver: `searching → matched` only when the driver accepts.

### 7. Effects on other screens and apps

- Re-dispatch: rider app keeps "Finding your driver" (no new screen). Offer: driver app receives a normal request.
- Alert safety: Safety queue gains an urgent case; the trip panel shows it.
- Every action appears on the trip timeline as "GoBye support: …" in both apps where relevant.

### 8. Notifications and background jobs

- **Job `live.problem_detector`** (every 30 s): computes queues, raises an in app alert to on duty operations staff for the city when a new delayed pickup or matching failure appears.
- **Proposed:** SMS or push to the operations lead when a queue exceeds 10 items (placeholder).

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Queue skeletons |
| Empty | Per queue: "No delayed pickups right now." All clear: "Nothing needs action in Lagos right now." |
| Pending | Acknowledged: "Kunle is handling this". Offer sent: "Offered to Tunde Okafor. Waiting for a reply." |
| Error | "Couldn't refresh live data. Showing data from 2 min ago." (stale banner) / action errors as Trips |
| Success | "Matching restarted" / "Safety team alerted" |

### 10. Acceptance checks

1. Given a trip `en_route` with `pickupDelaySeconds = 540`, then it appears in Delayed pickups as "9 min late" and is counted in the sidebar badge.
2. Given a trip `searching` for 90 s, then it appears in Matching failures.
3. Given a bank transfer trip `payment_pending` for 40 min, then it appears in Stuck payments with "Check payment again".
4. Given a Lagos scoped dispatcher, then no Abuja items appear in any queue or count.
5. Given an admin (`live.view` only), then the queues are visible and no intervention is enabled.
6. Given "Offer to a driver" for a driver already on a trip, then it is refused with "This driver is on a trip".
7. Given "Alert safety" on a trip, then a safety case is created with the trip linked and responders are notified.
8. Given the live data fails to refresh, then the last data stays with a stale banner, never a blank page.

### Backend needs

- `GET /admin/live?city=` (queues, availability, active journeys) plus a server push channel (WebSocket or server sent events, not chosen).
- `POST /admin/trips/{id}/redispatch`, `/offer` (`driverId`), `/alert-safety`, `/acknowledge`.
- Matching service hooks; driver location service (map provider proposed only, D-025). Job `live.problem_detector`.
