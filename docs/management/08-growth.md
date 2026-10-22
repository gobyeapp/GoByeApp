# 08. Growth

Modules: [Announcements](#module-announcements) (`/comms`), [Promotions](#module-promotions) (`/promos`), [Referral campaigns](#module-referral-campaigns) (`/config/referrals`, Performance tab), [Event partnerships](#module-event-partnerships) (`/events`, marketing view). Shared rules: [01-foundation.md](01-foundation.md). Back to [README.md](README.md).

No email, SMS or push provider is chosen yet (`int-email`, `int-sms` are `prototype`; push is `configured` with "Expo push (proposed)"). Until a channel's integration is `live`, sending on it is simulated and labelled "Simulated delivery". See [07-payments-and-integrations.md](07-payments-and-integrations.md).

---

## Module: Announcements

Brief §8: draft → audience preview → approval where required → schedule or publish → delivery attempts → results.

### 1. Users and permissions

| Permission | Holders | Allows |
|---|---|---|
| `comms.view` | owner, admin, marketing, auditor | List, detail, results |
| `comms.draft` | admin, marketing | Create and edit drafts, preview audience, submit |
| `comms.publish` | owner, marketing | Schedule or send an announcement that needs no approval; retry failed deliveries; cancel scheduled |
| Approver (`announcement`) | owner, admin, not the requester | Approve or reject when approval is required |

**Open question:** admin is a listed approver but does not hold `comms.publish` or `approvals.decide` (see 01 §3 rule 6).

### 2. Screens and navigation

`/comms` (marketing homepage): tabs **Drafts**, **Waiting approval**, **Scheduled**, **Sent**, **Retry queue**. New announcement opens a page with four steps:

1. **Write**: title, body, purpose (Service or Marketing), optional deep link.
2. **Audience**: type (passengers or drivers), cities, statuses, packages, event; live **audience preview**.
3. **Channels**: inbox, push, email, SMS chosen explicitly (none preselected except inbox), each showing how many recipients it can reach.
4. **Review and send**: preview per channel (inbox card, push banner, email, SMS with character count), schedule time or Send now, and whether approval is needed and why.

Sent announcement page: frozen sent version, delivery results per channel, failures list, Duplicate as new draft.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Id | string | `announcement.id` | |
| Title | string | `announcement.title` | Max 65 characters (placeholder) |
| Body | string | `announcement.body` | Max 500 inbox, 160 SMS segment counter |
| Purpose | enum | target `announcement.purpose` | service, marketing; decides preference rules |
| Audience | AudienceFilter | `announcement.audience` | `type`, `cities`, `statuses?`, `packages?`, `eventId?` |
| Audience size | number | `announcement.audienceSize` | Computed at preview; recomputed at send |
| Channels | Channel[] | `announcement.channels` | inbox, push, email, sms |
| Status | AnnouncementStatus | `announcement.status` | |
| Scheduled for | time | `announcement.scheduledFor` | WAT shown |
| Created by, approved by | Actor | `createdBy`, `approvedBy` | |
| Sent version | snapshot | `announcement.sentVersion` | title, body, at; **immutable** |
| Delivery | per channel | `announcement.delivery[channel]` | attempted, delivered, failed |
| Recipient deliveries | list | target `delivery_attempts` | recipient, channel, status, error, attempts, last attempt |

Audience filters (brief §8): passenger or driver; city or service area; account status (for drivers the verification status, for example `approved`); package (`daily`, `monthly`); event participation (`eventId`); campaign eligibility (target).

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Create, edit draft | `comms.draft` | | Draft saved |
| Preview audience | `comms.draft` | | Counts by city and channel reachability |
| Submit for approval | `comms.draft` | `announcement` when required | `draft → pending_approval` |
| Schedule | `comms.publish` (or on approval) | when required | `→ scheduled` |
| Send now | `comms.publish` (or on approval) | when required | `→ sending` |
| Back to draft | requester or `comms.publish` | | `pending_approval | scheduled → draft` |
| Cancel | `comms.publish` | | `→ cancelled` (before sending) |
| Retry failed | `comms.publish` | No | `partly_failed → sending` for failed recipients only |
| Duplicate as new draft | `comms.draft` | | New draft copied from the sent version |

### 5. Validation and approval rules

- **Approval required** (`APPROVAL_RULES.announcement`): when the audience is everyone of a type (all cities and no status, package or event filter), or when SMS is a channel. Otherwise marketing may schedule or send directly with `comms.publish`.
- Title and body required; at least one channel; audience size at least 1; schedule at least 5 minutes ahead (placeholder); SMS body within 2 segments (placeholder).
- **Channel preferences and purpose:** inbox always delivered. Push needs a device token and notification permission. Email needs a verified email. SMS needs a phone. Marketing purpose respects each person's marketing opt out per channel; Service purpose (for example a city pause, a fare change for drivers) may reach people who opted out of marketing but never a channel they cannot receive. Quiet hours 21:00 to 07:00 WAT for push and SMS marketing (placeholder).
- **Sent messages never change.** At `sending`, the title and body are copied into `sentVersion` and every recipient's inbox item. After that the record cannot be edited; changes require Duplicate as new draft. Moving a scheduled announcement back to draft is allowed only before sending.
- Audience is recomputed at send time; the result shows both the previewed and actual size.

### 6. Status transitions

From `ANNOUNCEMENT_FLOW` (`workflows.ts`):
- `draft → pending_approval | scheduled | sending | cancelled`
- `pending_approval → draft | scheduled | sending | cancelled`
- `scheduled → sending | draft | cancelled`
- `sending → sent | partly_failed`
- `partly_failed → sending | sent`
- `sent`, `cancelled`: final

`draft → scheduled | sending` is allowed only when no approval is required. **Proposed:** `pending_approval → rejected` does not exist; rejection returns the announcement to `draft` with the approver's note.

Delivery attempt, **proposed**: `queued → delivered | failed`; `failed → queued` (retry, maximum 3 automatic attempts with backoff 1, 5, 30 minutes, placeholders); `failed → abandoned` after the last attempt.

### 7. Effects on other screens and apps

- **Rider and driver apps:** an inbox item per recipient (in Activities or the driver inbox, target), push banner if chosen, with the deep link. A cancelled scheduled announcement never reaches the apps.
- **Approvals:** request appears in `/approvals` and on the owner overview.
- **Developer:** delivery failures from providers appear in Events and failures ([07-payments-and-integrations.md](07-payments-and-integrations.md)); a channel `degraded` shows "Email delivery is unavailable. Messages will wait in the retry queue." on step 3.
- **Reports:** Growth report counts.

### 8. Notifications and background jobs

- **Job `comms.scheduler`** (every minute): moves `scheduled` to `sending` at `scheduledFor`.
- **Job `comms.fanout`**: creates inbox records in one batch, then one queued delivery per recipient per channel.
- **Job `comms.deliver.{push,email,sms}`**: sends through the provider, records attempts; provider delivery callbacks update status.
- **Job `comms.retry`**: retries failed deliveries per the backoff; moves the announcement to `sent` when nothing remains queued and no failures, or `partly_failed` otherwise.
- Requester notified on approval decision; marketing notified when an announcement ends `partly_failed`.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | List skeleton; preview "Counting recipients" |
| Empty | Drafts: "No drafts. Write an announcement." Retry queue: "No failed deliveries." |
| Pending | "Waiting for approval", "Scheduled for 22 Oct, 09:00", "Sending: 120 of 480" |
| Error | "Couldn't send. Nothing was sent." Channel: "SMS isn't set up yet. Choose another channel." Approval: "This needs approval because it goes to every passenger." |
| Success | "Scheduled for 22 Oct, 09:00" / "Sent to 48 passengers" / "Sent with problems: 22 SMS failed. See the retry queue." |

### 10. Acceptance checks

1. Given a draft to passengers in Abuja only with inbox and push, when marketing schedules it, then no approval is created and status is `scheduled`.
2. Given a draft to every passenger in all cities, when marketing submits, then an `announcement` approval is created and the status is `pending_approval`.
3. Given any draft with SMS, then approval is required regardless of audience.
4. Given `ann-0002` is `partly_failed` with 22 SMS failures, then the retry queue lists 22 SMS recipients and Retry failed sends only to them.
5. Given a sent announcement, when anyone tries to edit it, then editing is refused and Duplicate as new draft is offered; the sent inbox items keep the original text.
6. Given marketing created `ann-0003`, then marketing cannot approve it.
7. Given a passenger opted out of marketing push, when a marketing announcement with push is sent, then they get the inbox item and no push.
8. Given email is not live, then step 3 shows email as "Simulated delivery" and results are labelled simulated.

### Backend needs

- `GET/POST/PATCH /admin/announcements`; `POST /admin/announcements/{id}/preview-audience`, `/submit`, `/schedule`, `/send`, `/cancel`, `/to-draft`, `/retry-failed`, `/duplicate`.
- Tables: announcements, `announcement_snapshots`, inbox items, delivery attempts, communication preferences.
- Jobs `comms.scheduler`, `comms.fanout`, `comms.deliver.*`, `comms.retry`; provider delivery webhooks. Events `announcement.sent`, `announcement.partly_failed`.

**Open question:** whether drivers get an inbox in the driver app at launch; which email, SMS and push providers (not chosen).

---

## Module: Promotions

Promotional cards on the passenger Home and Wallet carousels (brief §8).

### 1. Users and permissions

`promos.manage` (admin, marketing) create, edit, schedule, pause, end. `comms.view` (owner, admin, marketing, auditor) read (nav shows for either). Approval: see §5.

### 2. Screens and navigation

`/promos`: list grouped by status with placement chips (Home, Wallet), dates, order, impressions, opens, spend. **Carousel preview** per placement shows the cards the rider app would show now for a chosen audience (city, passenger type), in order, with the auto advance interval. Editor: artwork, title, body, CTA label and destination, placements, audience, start and end, order, budget.

### 3. Fields and data source

Campaign records (`PromoCampaign`) are what the backend publishes into the rider app's promotions configuration (`ServiceConfig.promotions` in `packages/core/src/config.ts`, read with `promotionsFor(config, placement)`).

| Field | Type | Source (`PromoCampaign`) | Rider app (`promotions.items[]`) | Notes |
|---|---|---|---|---|
| Id | string | `id` | `id` | |
| Artwork | enum | `art` | `art` | `sedan`, `gift`, `wallet`, `destination` (bundled renders). **Open question:** uploaded artwork (storage provider not chosen) |
| Short copy | string | `title`, `body` | `title`, `body` | Title max 30, body max 60 characters (placeholders) |
| Details | string[] | **missing** | `details` | Shown in the card's detail sheet; add to `PromoCampaign` |
| CTA label | string | `ctaLabel` | `action.label` | |
| CTA destination | route | `ctaRoute` | `action.route` | Must be in the allowed route list (below) |
| Placements | ('home' \| 'wallet')[] | `placements` | `placements` | |
| Audience | AudienceFilter | `audience` | not in app config | Server filters per passenger before sending config |
| Dates | time | `startsAt`, `endsAt?` | not in app config | Server includes only campaigns in their dates |
| Carousel order | number | `sortOrder` | `sortOrder` | Lower first, per placement |
| Interval | seconds | not per campaign | `promotions.autoAdvanceSeconds` | Global, placeholder 6 s; edited on this page as its own setting |
| Status | CampaignStatus | `status` | `enabled` = status `active` | |
| Budget, spent | Kobo | `budget?`, `spent` | | Spend only for campaigns that cost money (rewards, discounts) |
| Impressions, opens | number | `impressions`, `opens` | | Opens = CTA taps; reported by the rider app (target analytics) |

Allowed CTA destinations (rider app routes in use): `/(tabs)` (book a ride), `/(tabs)/wallet?add=1` (add money), `/account/rewards` (referrals). New destinations are added by developers, not typed freely.

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Create, edit draft | `promos.manage` | | Draft |
| Submit | `promos.manage` | see §5 | `draft → pending_approval` |
| Schedule or activate | `promos.manage` | see §5 | `→ scheduled` or `active` |
| Pause, resume | `promos.manage` | No | `active ↔ paused` |
| End | `promos.manage` | No | `→ ended` |
| Reorder | `promos.manage` | No | `sortOrder` changes for active and scheduled cards |
| Change interval | `promos.manage` | No | `autoAdvanceSeconds` (3 to 15 s) |

### 5. Validation and approval rules

- Title, body, CTA label, valid destination, at least one placement, start date required; end after start.
- Campaigns that promise money (a reward or discount, or any budget) must match a live programme (for example the referral version in force) and need approval. **Open question:** `CAMPAIGN_FLOW` has `pending_approval` but `ApprovalKind` has no campaign kind; add `campaign` (approver owner) or reuse `announcement`. Proposed: campaigns with a budget, or audience everyone in all cities, need owner approval.
- No invented discounts (`config.ts` comment): copy must describe a real, configured offer.
- Maximum 5 active cards per placement (placeholder).
- An edit to an active campaign creates a new draft version; the live card stays until the new version is approved (same principle as sent announcements).

### 6. Status transitions

From `CAMPAIGN_FLOW` (`workflows.ts`):
- `draft → pending_approval | scheduled | active`
- `pending_approval → draft | scheduled | active | rejected`
- `scheduled → active | draft | ended`
- `active → paused | ended`
- `paused → active | ended`
- `rejected → draft`
- `ended`: final

`draft → scheduled | active` only when no approval is required.

### 7. Effects on other screens and apps

- **Rider app:** Home and Wallet carousels show `active` campaigns for the passenger's audience, in `sortOrder`, advancing every `autoAdvanceSeconds` (still under Reduce Motion). Pausing or ending removes the card on the next config refresh (target within 5 minutes). Tapping opens the detail sheet then the CTA destination.
- **Finance and overview:** campaign spend appears in promotional spending (`promotions_expense`).
- **Events:** campaigns with `audience.eventId` appear on the event page.

### 8. Notifications and background jobs

**Job `promos.schedule`** (every minute): `scheduled → active` at `startsAt`; `active → ended` at `endsAt`; ends a campaign whose `spent` reaches `budget`. **Job `promos.metrics`**: aggregates impressions and opens from app analytics (provider not chosen). Marketing notified when a campaign ends because of budget.

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Card list skeleton; carousel preview skeleton |
| Empty | "No promotions. Create one to show on Home or Wallet." Preview: "No cards would show for this audience." |
| Pending | "Waiting for approval", "Starts 20 Nov" |
| Error | "Couldn't save this promotion. Nothing was changed." / "Choose a destination from the list." |
| Success | "Promotion active. Passengers will see it within 5 minutes." / "Paused" |

### 10. Acceptance checks

1. Given the three active test campaigns, then the Home preview shows Earn ₦500 per friend, Pay in one tap, Book for someone else in that order and the Wallet preview shows the first two.
2. Given `book-for-others` targets Lagos only, when the preview audience is Abuja, then it is not shown.
3. Given a campaign is paused, then the rider app config no longer includes it after the next refresh.
4. Given a draft with a CTA destination not in the list, then save is refused.
5. Given `detty-december` (draft, starts in 30 days), when scheduled, then it becomes active at `startsAt` and ends at `endsAt`.
6. Given a campaign reaches its budget, then it ends automatically and no further spend is posted.

### Backend needs

- `GET/POST/PATCH /admin/promotions`; `POST /admin/promotions/{id}/submit`, `/schedule`, `/activate`, `/pause`, `/resume`, `/end`; `PATCH /admin/promotions/order`; `PATCH /admin/promotions/settings` (interval).
- Rider API `GET /config/promotions?placement=` filtered per passenger, returning the `promotions` shape in `config.ts`.
- Analytics ingestion for impressions and opens. Job `promos.schedule`, `promos.metrics`. Events `campaign.*`.

---

## Module: Referral campaigns

Performance of the referral programme configured in [04-configuration.md](04-configuration.md#module-rewards-and-referrals).

### 1. Users and permissions

`referrals.manage` (admin, marketing) and `config.view` read the Performance tab; `reports.view` for exports through Reports; amounts per passenger need `ledger.view`.

### 2. Screens and navigation

`/config/referrals`, **Performance** tab: funnel, spend against budget, by city, top referrers (names only), and the linked promotion card metrics (`referral` campaign).

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Invites shared | number | referral service (target) | |
| Sign ups with a code | number | referral attributions (target) | |
| Qualified (first paid trip) | number | attributions with qualifying trip | |
| Rewards earned | number, Kobo | `referral_reward` journals | Value per reward from the version in force when earned |
| Rewards used, expired | number, Kobo | reward records (target) | Needs separate promotional balance (04 open question) |
| Budget, spent | Kobo | `campaign.budget`, Σ `promotions_expense` for `referral_reward` | |
| Cost per qualified passenger | Kobo | spent ÷ qualified | |
| Card impressions, opens | number | `campaign.impressions`, `opens` (`referral`) | |

City from the referrer's city; time field: qualification time.

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Change rules or budget | `referrals.manage` | `config_publish` | Via Rules tab (04) |
| Export | `reports.export` | No | CSV |

### 5. Validation and approval rules

Read only here. Per passenger reward amounts hidden without `ledger.view`.

### 6. Status transitions

Reward lifecycle as proposed in 04 (Rewards and referrals §6).

### 7. Effects on other screens and apps

None; reads only. Numbers must equal promotional spending for referrals on the overview.

### 8. Notifications and background jobs

`referrals.budget_watch` (04). Weekly summary to marketing (proposed).

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Funnel skeleton |
| Empty | "No referrals in this period." |
| Pending | "Budget 80% used" (warning) |
| Error | "Couldn't load referral results. Try again." |
| Success | Export: "Export ready" |

### 10. Acceptance checks

1. Given 6 `referral_reward` journals of ₦500, then rewards earned shows 6 and ₦3,000, matching the `referral` campaign's spent value.
2. Given a city filter of Lagos, then only rewards for Lagos referrers count.
3. Given a marketing user without `ledger.view`, then individual passenger amounts are hidden and totals are shown.

### Backend needs

`GET /admin/referrals/performance?city=&from=&to=`; referral attribution tables; reward records.

---

## Module: Event partnerships

Marketing side of [Events](04-configuration.md#module-events): partner relationship, linked campaigns and announcements, results.

### 1. Users and permissions

`events.manage` (admin, marketing) edit; `config.view` read; linking campaigns needs `promos.manage`, linking announcements needs `comms.draft`.

### 2. Screens and navigation

`/events` detail, **Partnership** and **Results** tabs: partner contact, agreement notes, sponsorship, linked promotion (audience `eventId`), linked announcements, results.

### 3. Fields and data source

| Field | Type | Source | Notes |
|---|---|---|---|
| Partner | string | `event.partner` | Contact person and email (target) |
| Sponsorship | Kobo | `event.sponsorship` | Direction of money is an open question (04) |
| Linked promotions | list | campaigns with `audience.eventId = event.id` | `detty-december` links `evt-0001` |
| Linked announcements | list | announcements with `audience.eventId` | |
| Bookings | number | `event.bookings` (target: trips with `eventId`) | |
| Completed trips, trip value | number, Kobo | trips with `eventId` | Trip value is drivers' money (0% commission) |
| Promo spend | Kobo | `promotions_expense` linked to the event's campaigns | |

### 4. Available actions

| Action | Permission | Approval? | Effect |
|---|---|---|---|
| Edit partner details, notes | `events.manage` | No | Audited |
| Create linked promotion | `promos.manage` | per Promotions | Draft with audience `eventId` |
| Create linked announcement | `comms.draft` | per Announcements | Draft with audience `eventId` |
| Export results | `reports.export` | No | CSV for the partner |

### 5. Validation and approval rules

Linked campaign dates must fall within or before the event dates; exported results contain counts and totals only, never passenger or driver details.

### 6. Status transitions

Event: proposed `EVENT_FLOW` (04). Linked campaign and announcement: their own flows.

### 7. Effects on other screens and apps

Rider app shows the linked promotion to the event audience; operations can filter event trips; owner overview unaffected except through trips and spend.

### 8. Notifications and background jobs

`events.status` (04). Reminder to marketing 3 days before an event with no linked promotion (proposed).

### 9. Loading, empty, pending, error and success states

| State | Copy |
|---|---|
| Loading | Tab skeleton |
| Empty | Results before start: "Results appear once the event starts." |
| Pending | "Planned. Starts 20 Nov." |
| Error | "Couldn't load results. Try again." |
| Success | "Results exported" |

### 10. Acceptance checks

1. Given `evt-0002` (ended, 64 bookings), then Results shows 64 bookings and the trip totals for trips linked to it.
2. Given a linked promotion created from the event, then its audience has `eventId = evt-0001` and type passenger.
3. Given an export, then it contains no names, phone numbers or emails.

### Backend needs

`GET /admin/events/{id}/results`; `eventId` on trips, campaigns and announcements; export job.
