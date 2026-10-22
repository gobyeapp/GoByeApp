# 04. Configuration

Modules: [Service areas](#module-service-areas) (`/config/areas`), [Vehicle categories](#module-vehicle-categories) (`/config/categories`), [Fare settings](#module-fare-settings) (`/config/fares`), [Driver packages](#module-driver-packages) (`/config/packages`), [Rewards and referrals](#module-rewards-and-referrals) (`/config/referrals`), [Events](#module-events) (`/events`). Shared rules: [01-foundation.md](01-foundation.md). Back to [README.md](README.md).

Every value below that is a number is a **placeholder** unless a decision says otherwise (BUSINESS_RULES status note). Decided: 0% per trip commission and driver access packages with provisional prices (D-024); one car category at launch (D-029); payment after the trip (D-030).

---

## Versioning (applies to every configuration module)

Brief §3: "Configuration changes need effective dates and a record of who changed them. Existing bookings, purchased passes, and earned rewards should preserve their applicable terms."

### Model

Each setting is a series of `ConfigVersion` records (`types.ts`), one series per `ConfigKey`: `fares`, `categories`, `packages`, `referrals`, `cancellation`, `service_areas`, `payment_methods`.

| Field | Meaning |
|---|---|
| `id` | Version id, for example `cfg-fares-2`; stored on records that used it |
| `key`, `version` | Series and sequence number (1, 2, 3) |
| `value` | The full setting (never a partial patch). **Money in kobo.** |
| `status` | draft, pending_approval, scheduled, active, superseded, rejected |
| `effectiveFrom` | When it applies |
| `createdBy`, `createdAt` | Who drafted it, when |
| `approvedBy` | Who approved publication |
| `note` | Why (required), for example "Fuel price change" |

**Version in force** at time *t* = `versionInForce(versions, t)`: the latest `active`, `scheduled` or `superseded` version whose `effectiveFrom ≤ t` (ties broken by higher `version`). Past dates therefore resolve to the version that applied then.

### Status transitions

**Proposed** `CONFIG_FLOW` (not yet in `workflows.ts`):
- `draft → pending_approval` (submit)
- `pending_approval → draft` (requester withdraws, or reject with "send back")
- `pending_approval → scheduled` (approved, `effectiveFrom` in the future)
- `pending_approval → active` (approved, `effectiveFrom` now or past)
- `pending_approval → rejected`
- `scheduled → active` (job at `effectiveFrom`)
- `scheduled → draft` (cancelled before taking effect; needs `config.publish`)
- `active → superseded` (when the next version becomes active)
- `rejected → draft` (copied into a new draft; the rejected version stays for history)

### Rules

1. **Edit only drafts.** A version that left `draft` is never changed. To change a published setting, copy it to a new draft.
2. **Approval to publish.** Every publish needs `config_publish` approval by the owner (`APPROVAL_RULES`). The approval drawer shows the diff against the version in force at the new `effectiveFrom`.
3. **Effective date.** Cannot be in the past at the time of approval. Fares, cancellation and packages must be at least 1 hour after approval (placeholder) so apps receive the new values first. One `scheduled` version per key at a time.
4. **Who changed what.** Draft, submit, approve, reject, schedule, activate and supersede each write an audit event (`config.drafted`, `config.submitted`, `config.published`, `config.rejected`, `config.activated`) with the diff.
5. **Preservation of terms.** Records store the version id they were created under and keep using it:

| Record | Stores | Fixed at | Code status |
|---|---|---|---|
| Trip (booking) | `fareConfigVersionId`, `cancellationConfigVersionId`, `categoryConfigVersionId` | Quote shown (fare locked at submission, BR-031) | **Missing** on `TripRecord` |
| Package purchase (pass) | `packageConfigVersionId`, price paid, duration | Payment verified | **Missing** on `DriverRecord.access` and the `package_purchase` journal |
| Referral invite | `referralConfigVersionId` | Friend signs up with the code | **Missing** |
| Earned reward | `referralConfigVersionId`, value, expiry | Qualifying trip paid | **Missing** on the `referral_reward` journal |
| Event booking | `eventId` | Booking created | **Missing** on `TripRecord` |

6. **Apps read configuration from the server**, never from code: the rider and driver apps fetch the version in force (today `MOCK_SERVICE_CONFIG`, `MOCK_PRICING_CONFIG` in `@gobye/core`) and cache it with its id.

### Shared permissions

| Permission | Holders | Allows |
|---|---|---|
| `config.view` | owner, admin, operations, marketing, auditor | Read every configuration page and history |
| `config.edit` | admin | Draft and submit `fares`, `cancellation`, `categories`, `packages`, `service_areas` |
| `referrals.manage` | admin, marketing | Draft and submit `referrals` |
| `config.publish` | owner | Approve publication; cancel a scheduled version |
| `events.manage` | admin, marketing | Create and change events (not versioned, see Events) |

`payment_methods` (enabled methods and processing fee rules, BR-105) is versioned the same way and edited in Payments setup ([07-payments-and-integrations.md](07-payments-and-integrations.md)).

### Shared screen pattern

Each configuration page shows: **In force now** (values, version, effective since, approved by), **Scheduled** (if any, with countdown), **Drafts and pending** (with Edit, Submit, Withdraw), **History** (every version with status, dates, who, note; open to compare any two). Global city filter applies where the value is per city.

### Shared states

| State | Copy |
|---|---|
| Loading | Skeleton of the In force card and history table |
| Empty | History: "No earlier versions." Drafts: "No drafts. Copy the version in force to start a change." |
| Pending | "Waiting for owner approval" (warning pill); "Takes effect 26 Oct, 00:00" (info pill) |
| Error | "Couldn't submit this change. Nothing was changed." Validation: field level message. Conflict: "Another draft is already scheduled for this setting." |
| Success | "Sent for approval" / "Published. Takes effect 26 Oct, 00:00." / "Draft saved" |

### Shared backend needs

`GET /admin/config/{key}` (in force, scheduled, drafts, history); `POST /admin/config/{key}/drafts`; `PATCH /admin/config/drafts/{id}`; `POST /admin/config/drafts/{id}/submit`, `/withdraw`; approval through `/admin/approvals`; `POST /admin/config/versions/{id}/cancel`. Public read for apps: `GET /config/{key}?city=` returning value and version id. Job **`config.activate`** (every minute): moves `scheduled` to `active` at `effectiveFrom`, supersedes the previous one, publishes `config.activated`. Events `config.*`.

---

## Module: Service areas

### 1. Users and permissions

`config.view` read; `config.edit` (admin) drafts; `config.publish` (owner) approves. Key `service_areas`.

### 2. Screens and navigation

`/config/areas`: cities list (Lagos, Abuja) with status and zone count; city detail with operating zones (list now; map drawing when a map provider is chosen, D-025), availability rules, and category availability per zone. Versioning panels as above.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| City | CityId, name | `value.cities[]` | Today `['Lagos', 'Abuja']` as names; target ids `lagos`, `abuja` |
| City status | enum | `value.cities[].status` (target) | live, paused, coming_soon |
| Zone | id, name, polygon | `value.zones[]` (target) | Polygon needs the map provider |
| Zone type | enum | target | service, airport, event, restricted (no pickups) |
| Operating hours | ranges | target | Placeholder 24 hours |
| Categories available | ids | target | Must be enabled in `categories` |
| Pickup rules | text | target | For example airport meeting point |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Draft change (city, zone, hours, rules) | `config.edit` | | New draft |
| Submit | `config.edit` | `config_publish` | `pending_approval` |
| Pause a city now | `config.edit` | `config_publish` (urgent, effective now) | No new requests in the city |

### 5. Validation and approval rules

Zone names unique per city; polygons must not overlap other zones of the same type; at least one category per live zone; a city cannot be paused while it has active trips without the confirmation "Active trips will finish; no new requests". **Open question:** whether a city pause for an emergency should bypass approval (with owner alert).

### 6. Status transitions

Version: `CONFIG_FLOW`. City status, **proposed**: `coming_soon → live`; `live → paused`; `paused → live`.

### 7. Effects on other screens and apps

Rider app: pickups outside a live zone show "GoBye isn't available here yet"; paused city shows "Rides in Abuja are paused. Try again later." Driver app: drivers in a paused city cannot go online. Live operations and the overview list only configured cities; the global city filter is built from this list.

### 8. Notifications and background jobs

`config.activate`. Optional announcement to affected users on pause ([08-growth.md](08-growth.md#module-announcements)).

### 9. Loading, empty, pending, error and success states

Shared states. Map area when no provider: "Map drawing is available once a map provider is chosen. Zones are listed below."

### 10. Acceptance checks

1. Given Abuja is paused (approved, effective now), when a passenger in Abuja requests a trip (backend), then it is refused with `service_unavailable` and the rider app shows the paused copy.
2. Given an active trip in Abuja at pause time, then it completes normally.
3. Given a draft by an admin, then it does not affect any app until approved and effective.
4. Given an operations user, then the page is read only.

### Backend needs

Shared, plus geospatial check of pickup and destination against zones in the matching and quote services.

---

## Module: Vehicle categories

### 1. Users and permissions

`config.view` read; `config.edit` drafts; `config.publish` approves. Key `categories`.

### 2. Screens and navigation

`/config/categories`: list of categories (name, seats, enabled, cities, sort order) with the vehicle requirements for each; Edit opens a draft form. Versioning panels.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Id | VehicleCategoryId | `CategoryConfig.id` (`config.ts`) | `go`, `comfort`, `xl`, `keke` |
| Name | string | `CategoryConfig.name` | `go` is "GoBye Car" (D-029) |
| Enabled | boolean | `CategoryConfig.enabled` | Launch: only `go` |
| Seats | number | `CategoryConfig.seats` | |
| Description | string | `CategoryConfig.description` | Shown on ride options |
| Image | enum | `CategoryConfig.image` | `sedan` render |
| Sort order | number | `CategoryConfig.sortOrder` | |
| Cities | CityId[] | target | Where offered (BR-010) |
| Vehicle requirements | object | target | Minimum year (placeholder 2010), seats, allowed body types |
| Fare | link | Fare settings for this category | |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Create category | `config.edit` | `config_publish` | New category, disabled by default |
| Edit fields | `config.edit` | `config_publish` | |
| Enable or disable | `config.edit` | `config_publish` | Shown or hidden on booking screens from `effectiveFrom` |
| Reorder | `config.edit` | `config_publish` | |

### 5. Validation and approval rules

Unique id and name; seats 1 to 8; at least one category enabled; a category cannot be enabled without fare values in force for every city it is offered in and without at least one approved driver in that category (warning, not block). Disabling a category with active trips: they finish under their terms. **Open question:** Keke and other categories (Q-004).

### 6. Status transitions

Version: `CONFIG_FLOW`. Category enabled flag: `disabled ↔ enabled` through published versions only.

### 7. Effects on other screens and apps

Rider app: ride options show enabled categories (`enabledCategories`), names via `useCategoryName()`; a category unavailable in an area is shown disabled with a reason, never silently hidden (BR-010). Driver app: drivers whose vehicle category is disabled cannot go online (message "Your vehicle category isn't available yet"). Onboarding: category chosen at application must be enabled to approve.

### 8. Notifications and background jobs

`config.activate`; optional driver announcement when a category opens.

### 9. Loading, empty, pending, error and success states

Shared states.

### 10. Acceptance checks

1. Given the version in force, then only GoBye Car is enabled and the rider app offers only it.
2. Given a draft enabling GoBye Comfort without fares, then submit is refused with "Add fares for Comfort first".
3. Given an approved version enabling Comfort effective tomorrow, then the rider app shows Comfort only from tomorrow.
4. Given a trip booked in a category later disabled, then the trip completes with its booked category and fare.

### Backend needs

Shared, plus quote service reads categories from the version in force per city.

---

## Module: Fare settings

### 1. Users and permissions

`config.view` read; `config.edit` drafts; `config.publish` approves. Keys `fares` and `cancellation` (two series, one page).

### 2. Screens and navigation

`/config/fares`: tabs **Suggested fare**, **Negotiation**, **Waiting and cancellation**. Each per category and city. A fare preview calculator: enter distance and minutes, see the suggested fare under the version in force and under the draft. Versioning panels for each key.

### 3. Fields and data source

All money in kobo. Values listed are the current placeholders (`MOCK_PRICING_CONFIG`, BUSINESS_RULES; GoBye Car = `go`).

| Field | Type | Source | Placeholder | Notes |
|---|---|---|---|---|
| Base fare | Kobo | `fares.value.base` | ₦500 | |
| Per km | Kobo | `fares.value.perKm` | ₦180 (v2 in test data: ₦190) | |
| Per minute | Kobo | `fares.value.perMinute` | ₦25 | |
| Minimum fare | Kobo | `fares.value.minimumFare` | ₦1,200 | |
| Rounding step | Kobo | `fares.value.roundingStep` | ₦50 | Rounded up (BR-002) |
| Demand multiplier | number | `fares.value.demandMultiplier` | 1.0 | Any value above 1.0 shown to the passenger before booking (BR-021) |
| Quote validity | seconds | `fares.value.quoteValidity` | 300 | BR-022 |
| Negotiation range | percent | `fares.value.offerMin`, `offerMax` | 75%, 150% | BR-040 |
| Offer step | Kobo | `fares.value.offerStep` | ₦50 | BR-041 |
| Offer window | seconds | | 90 | BR-042 |
| Driver response window | seconds | | 30 | BR-044 |
| Maximum offer rounds | number | | 3 | BR-049 |
| Free cancellation window | seconds | `cancellation.value.freeWindowSeconds` | 120 | BR-080 |
| Free waiting at pickup | seconds | `cancellation.value.waitSeconds` | 300 | BR-081 |
| Cancellation fee | Kobo | `cancellation.value.fee` | ₦500 (test data: ₦300) | Shown before the passenger confirms |
| Waiting fee per minute | Kobo | target | not set | **Open question** |
| Commission | percent | fixed 0% | 0% | Decided (D-024); not editable here |

Formula (BR-020): `suggested = max(minimumFare, base + perKm × km + perMinute × min) × demandMultiplier`, rounded up to the rounding step.

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Draft fare change | `config.edit` | | New `fares` draft |
| Draft cancellation change | `config.edit` | | New `cancellation` draft |
| Submit | `config.edit` | `config_publish` | |
| Preview | `config.view` | | Calculator only |

### 5. Validation and approval rules

All money values integers in kobo, at least ₦0; minimum fare at least base fare; `offerMin < 100% < offerMax`; multiplier 1.0 to 3.0 (placeholder cap); cancellation fee not above minimum fare; free window and waiting 0 to 30 minutes. The diff in the approval drawer shows the effect on three sample trips (5 km 15 min, 12 km 35 min, 25 km 60 min).

### 6. Status transitions

`CONFIG_FLOW` for each key.

### 7. Effects on other screens and apps

Rider app: quotes requested after `effectiveFrom` use the new version; an open quote keeps its version until it expires (BR-022); a booked trip keeps its fare and cancellation terms (stored version ids). Driver app: earnings previews follow the agreed fare (0% commission). Trips: the panel shows the fare version used. Overview: no direct effect.

### 8. Notifications and background jobs

`config.activate`. Optional announcement to drivers on fare changes ([08-growth.md](08-growth.md#module-announcements)).

### 9. Loading, empty, pending, error and success states

Shared states. Preview error: "Enter a distance and time to see the fare."

### 10. Acceptance checks

1. Given fares v3 pending approval (`cfg-fares-3`), then the page shows v2 in force and v3 "Waiting for owner approval", and the rider app still quotes with v2.
2. Given v3 approved with `effectiveFrom` in 5 days, then it is `scheduled` and quotes switch to v3 at that time, and v2 becomes `superseded`.
3. Given a trip booked under v2 that completes after v3 takes effect, then its fare is unchanged and the trip stores `cfg-fares-2`.
4. Given a minimum fare below the base fare, then save is refused with "Minimum fare must be at least the base fare".
5. Given an admin submitted v3, then the admin cannot approve it.
6. Given `versionInForce` for a past date, then the version that applied on that date is returned.

### Backend needs

Shared, plus quote service (`POST /quotes`) returns the fare and the version ids it used.

---

## Module: Driver packages

### 1. Users and permissions

`config.view` read; `config.edit` drafts; `config.publish` approves. Key `packages`. Finance sees package sales in [06-finance.md](06-finance.md).

### 2. Screens and navigation

`/config/packages`: package cards (Daily, Monthly) with price, duration, eligibility, promotion, renewal rules; sales summary for the date range (count, revenue, renewals); versioning panels.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Package id | enum | `packages.value.items[].id` | `daily`, `monthly` (`DriverRecord.access.packageId`) |
| Name | string | | "Daily access", "Monthly access" |
| Price | Kobo | `packages.value.items[].price` | **Provisional** (D-024): Daily ₦2,000, Monthly ₦60,000. Test data uses ₦1,500 and ₦25,000 |
| Duration | hours or days | `durationDays` | 1 day, 30 days |
| Active | boolean | | Offered for purchase |
| Eligibility | rules | | Verification `approved`; city; vehicle category enabled; documents not expired |
| Activation | rule | | On verified payment: `expiresAt = max(now, current expiresAt) + duration` (extends, BR-062) |
| Promotion | object | `promotion` (target) | Promo price, start, end, first purchase only, limit per driver |
| Renewal | rule | | Manual purchase now; reminders before expiry |
| Grace period | duration | target | **Open question** (Q-043) |
| Sales | count, Kobo | `collection` purpose `package_purchase`; `company_revenue` journal | Revenue, not trip value |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Draft price, duration, eligibility, promotion | `config.edit` | | New draft |
| Submit | `config.edit` | `config_publish` | |
| Withdraw a package from sale | `config.edit` | `config_publish` | Not offered after `effectiveFrom`; existing passes run to expiry |

### 5. Validation and approval rules

Price integer kobo above ₦0; duration at least 1 day; promotion price below normal price with start before end; at least one package on sale. Purchases keep the price and duration they were bought at (version id stored on the purchase).

### 6. Status transitions

Version: `CONFIG_FLOW`. Driver access, **proposed** (computed, not stored): `none → active` (verified purchase); `active → active` (extension); `active → expired` (time passes); `expired → active` (purchase).

### 7. Effects on other screens and apps

- Driver app: package list and prices from the version in force; purchase goes through the payment provider (collection `package_purchase`); access activates only after a verified result (brief §9 "Package purchased"); Go online requires active access (BR-072). Expiry during a trip: the trip may finish, no new requests (BR-072 assumption).
- Finance: `collection` and `company_revenue` journal; overview Company revenue and Package renewals.
- Drivers module: access pill and expiry.

### 8. Notifications and background jobs

- **Job `packages.expiry`** (every 5 min): when access expires, force the driver offline after any active trip; push "Your access has ended. Buy a package to go online."
- Reminders 24 hours and 1 hour before expiry (placeholders) for daily and 3 days before for monthly.

### 9. Loading, empty, pending, error and success states

Shared states. Sales empty: "No package sales in this period."

### 10. Acceptance checks

1. Given the Daily price changes from ₦2,000 to ₦2,500 effective 1 Nov, when a driver buys on 31 Oct, then they pay ₦2,000 and the purchase stores the old version id.
2. Given a driver with access expiring in 5 hours buys Daily, then the new expiry is the old expiry plus 1 day.
3. Given a package purchase collection still `pending`, then access is not active and the driver app shows "Payment pending".
4. Given a duplicate provider event for a purchase, then access is extended once and revenue counted once.
5. Given access expires while the driver is on a trip, then the trip completes and the driver then cannot receive requests.

### Backend needs

Shared, plus `POST /driver/packages/{id}/purchase` (creates collection), webhook handling activates access in the same transaction as the `package_purchase` journal (idempotent by reference). Jobs `packages.expiry`, `packages.reminders`. Events `package.purchased`, `driver.access_expired`. **Open question:** auto renewal, refunds of unused access, VAT treatment (Q-043).

---

## Module: Rewards and referrals

Configuration of the referral programme. Performance and campaign spending are in [08-growth.md](08-growth.md#module-referral-campaigns).

### 1. Users and permissions

`config.view` read (nav shows for `config.view` or `referrals.manage`); `referrals.manage` (admin, marketing) drafts and submits; `config.publish` (owner) approves. Key `referrals`.

### 2. Screens and navigation

`/config/referrals`: tabs **Rules** (versioned values), **Performance** (08), **Rewards issued** (list from ledger, `ledger.view` for amounts per passenger).

### 3. Fields and data source

Values are the current placeholders in `MOCK_SERVICE_CONFIG.referral` (`config.ts`).

| Field | Type | Source | Placeholder |
|---|---|---|---|
| Enabled | boolean | `referral.enabled` | true |
| Qualification | enum, text | `referral.qualifyingRule`, `qualifyingDescription` | `first_completed_paid_trip`: friend signs up with the code and completes their first paid trip |
| Reward value (referrer) | Kobo | `referral.referrerReward` | ₦500 |
| Reward to new passenger | Kobo | target | none |
| Limit per referrer | number | `referral.maxRewardedReferrals` | 10 |
| Invite expiry | days | `referral.inviteExpiryDays` | 30 |
| Reward expiry | days | `referral.rewardExpiryDays` | 90 |
| Campaign budget | Kobo | `campaign.budget` (`referral`) | ₦500,000 |
| Budget spent | Kobo | Σ `referral_reward` debits to `promotions_expense` | |
| Share link | url | `referral.link` | placeholder domain |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Draft rule change | `referrals.manage` | | New draft |
| Submit | `referrals.manage` | `config_publish` | |
| Pause programme | `referrals.manage` | `config_publish` | New invites stop; earned rewards stay |

### 5. Validation and approval rules

Reward integer kobo above ₦0; limit at least 1; expiries 1 to 365 days; budget at least the current spend. Fraud rules (target): no reward when referrer and friend share a phone, device or payment account; self referral refused. When spend reaches the budget, new rewards stop and the programme shows "Budget reached".

### 6. Status transitions

Version: `CONFIG_FLOW`. Reward, **proposed**: `pending` (friend signed up) → `earned` (qualifying trip paid) → `expired` (unused after reward expiry) or `used`; `pending → lapsed` (invite expired). **Open question:** rewards are credited into the passenger wallet today (`referral_reward` journal), which mixes promotional credit with deposited money; reward expiry and wallet withdrawal both need rewards held as a separate promotional balance.

### 7. Effects on other screens and apps

Rider app: Account → Referrals and the Home and Wallet promotion card ("Earn ₦500 per friend") use the version in force; earned rewards appear in the wallet history as "Referral reward". Finance: `promotions_expense` and wallet liability. Overview: Promotional spending.

### 8. Notifications and background jobs

Push and inbox "You earned ₦500" when earned; **job `referrals.expiry`** (daily) expires unused rewards and invites; **job `referrals.budget_watch`** alerts marketing at 80% and 100% of budget.

### 9. Loading, empty, pending, error and success states

Shared states. Budget reached: "Budget reached. New rewards are paused." (warning).

### 10. Acceptance checks

1. Given the reward changes from ₦500 to ₦1,000, then rewards for friends who signed up before the change are paid at ₦500.
2. Given a referrer with 10 rewarded referrals, then an 11th qualifying friend earns no reward and the referrer is told the limit.
3. Given spend reaches the budget, then no new `referral_reward` journal is posted.
4. Given a qualifying trip whose payment is reversed, then the reward is reversed with a reason (`reversal` journal).

### Backend needs

Shared, plus referral service: code issue, attribution on sign up, qualification on `trip.paid`, `referral_reward` journal (idempotent by `referral:{friendId}`). Jobs `referrals.expiry`, `referrals.budget_watch`.

---

## Module: Events

Partners, venues, pickup zones, sponsorship, bookings and results for event partnerships (for example a concert). Marketing view: [08-growth.md](08-growth.md#module-event-partnerships).

### 1. Users and permissions

`events.manage` (admin, marketing) create and change; `config.view` read (nav shows for either). Not a `ConfigKey`: events are records (`EventPartnership`, `RecordType` `event`), audited on every change. Pickup zones are also published as zones in Service areas (type `event`), which follows `config_publish`.

### 2. Screens and navigation

`/events`: list (name, partner, city, dates, status, bookings), filters by status and city. Detail: partner and venue, dates, pickup zones, sponsorship, linked promotion and announcement, results.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Name | string | `event.name` | |
| Partner | string | `event.partner` | Organisation; contact person target |
| Venue | string | `event.venue` | |
| City | CityId | `event.city` | |
| Starts, ends | time | `event.startsAt`, `endsAt` | |
| Pickup zones | string[] | `event.pickupZones` | Names; geometry via Service areas |
| Sponsorship | Kobo | `event.sponsorship` | **Open question:** money paid by the partner to GoBye, or by GoBye to the partner |
| Status | enum | `event.status` | planned, live, ended |
| Bookings | number | `event.bookings` | Target: count of trips with `eventId` |
| Results | computed | trips with `eventId` | Completed trips, trip value, cancellations, no driver rate, promo spend |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Create, edit event | `events.manage` | No | Audited `event.created`, `event.updated` |
| Add pickup zones | `events.manage` + `config.edit` | `config_publish` (zones) | Zones live from event start to end |
| Link promotion or announcement | `events.manage`, `promos.manage` or `comms.draft` | as in 08 | Audience `eventId` |
| Cancel event | `events.manage` | No (reason) | **Proposed** status `cancelled` |

### 5. Validation and approval rules

Ends after starts; city in service areas; at least one pickup zone before going live; sponsorship integer kobo; edits to a live event limited to pickup zones and notes.

### 6. Status transitions

**Proposed** `EVENT_FLOW` (not in `workflows.ts`; `cancelled` not in the type):
- `planned → live` (job at `startsAt`)
- `planned → cancelled`
- `live → ended` (job at `endsAt`)

### 7. Effects on other screens and apps

Rider app: during a live event, pickups near the venue are guided to the event pickup zones; linked promotions show to the event audience. Driver app: event zones shown (target). Live operations: event trips can be filtered. Finance: sponsorship recorded per the open question.

### 8. Notifications and background jobs

**Job `events.status`** (every minute) moves planned to live and live to ended. Optional driver announcement before the event.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | List skeleton |
| Empty | "No events yet. Add an event partnership." |
| Pending | "Planned. Starts 20 Nov." (info) |
| Error | "Couldn't save this event. Nothing was changed." |
| Success | "Event saved" / "Pickup zones sent for approval" |

### 10. Acceptance checks

1. Given an event `planned` with pickup zones, when `startsAt` passes, then status is `live`.
2. Given an event without pickup zones, then it cannot go live and shows "Add a pickup zone".
3. Given trips booked with the event's id, then Results counts them; trips without the id are not counted.
4. Given a user with only `config.view`, then the event is read only.

### Backend needs

`GET/POST/PATCH /admin/events`; `eventId` on trips (from pickup zone match or event promotion deep link); job `events.status`; events `event.*`.
