# GoBye — Business Rules

> **Status:** every numeric value in this document is a **mock placeholder** held in `MOCK_PRICING_CONFIG` (`packages/core/src/pricing/config.ts`) or `MOCK_PAYMENTS_CONFIG` / `DRIVER_ACCESS_PACKAGES` (`packages/core/src/payments.ts`). None is confirmed business policy, **except** the decisions recorded on 2026-10-21: 0% per-trip commission (D-024) and launch payment methods Wallet + bank transfer (D-023). Driver package prices (₦2,000 / ₦60,000) are **provisional**; processing-fee values are **placeholders**. Confirm or replace each value before launch (`OPEN_QUESTIONS.md`). The future backend is the authority for all prices, matching and settlement; the app only displays and validates.

Rule IDs (`BR-xxx`) are referenced by `SRS.md` and tests.

## 1. Money

- **BR-001** All amounts are integer kobo (₦1 = 100 kobo). No floating-point currency.
- **BR-002** Fares shown to passengers are rounded **up** to the nearest rounding step (mock: ₦50).
- **BR-003** Display format: `₦3,450` (no decimals when whole naira; `₦3,450.50` otherwise).

## 2. Vehicle categories (mock)

| ID | Name | Seats | Base | Per km | Per min | Minimum fare |
|---|---|---|---|---|---|---|
| `keke` | GoBye Keke | 3 | ₦300 | ₦120 | ₦15 | ₦600 |
| `go` | GoBye Go | 4 | ₦500 | ₦180 | ₦25 | ₦1,200 |
| `comfort` | GoBye Comfort | 4 | ₦800 | ₦250 | ₦35 | ₦2,000 |
| `xl` | GoBye XL | 6 | ₦1,000 | ₦320 | ₦40 | ₦2,800 |

- **BR-010** Availability of a category varies by area; categories may be unavailable (shown disabled with a reason, never hidden silently).
- **BR-011** Whether Keke is offered, and in which cities, is an open question (Q-004).

## 3. Suggested fare (Quick Match price)

- **BR-020** `suggested = max(minimumFare, base + perKm × km + perMin × min) × demandMultiplier`, then rounded per BR-002.
- **BR-021** Mock `demandMultiplier` = 1.0. Any multiplier > 1.0 must be shown to the passenger before booking.
- **BR-022** A fare quote expires after **5 minutes** (mock). An expired quote must be refreshed before booking.
- **BR-023** The fare breakdown shows base, distance, time, any multiplier and the total.

## 4. Quick Match

- **BR-030** The passenger accepts the suggested fare. No counteroffers in Quick Match.
- **BR-031** The fare is locked at booking submission (`fareLockedAt`) for the quoted route. Route changes during the trip require a new quote (future backend).
- **BR-032** Matching searches eligible drivers (BR-070). Mock search timeout: **60 s**, then the passenger can retry, widen to Negotiate, or cancel.
- **BR-033** One booking submission per quote: the Submit button is disabled while a submission is in flight (idempotency key per attempt).

## 5. Negotiate

- **BR-040** The passenger's offer must be within the **allowed range**: `[max(minimumFare, 75% × suggested), 150% × suggested]` (mock percentages), rounded to the rounding step.
- **BR-041** Offers are entered in whole naira and adjusted in steps of ₦50 (mock).
- **BR-042** A passenger offer is open for **90 s** (mock). When it expires with no accepted response, the passenger may raise the offer, switch to Quick Match, or cancel.
- **BR-043** Drivers respond with **Accept** (at the passenger's price) or a **Counteroffer**. A counteroffer must be ≥ the passenger offer and ≤ the range maximum.
- **BR-044** Each driver response is valid for **30 s** (mock). Expired responses are shown as expired and cannot be selected.
- **BR-045** A driver may have only one live response per passenger offer; a new response replaces the previous one.
- **BR-046** The passenger selects one response. Selection **locks** the fare (`agreedFare`) and the selected driver; all other responses are withdrawn.
- **BR-047** If the selected driver became unavailable (assigned elsewhere) before confirmation, selection fails with "This driver is no longer available" and the passenger returns to the remaining live responses. The same driver can never be assigned to two active trips (no duplicate assignment).
- **BR-048** A passenger can raise but not lower an offer while it is open (prevents bait-and-switch). Raising restarts the offer timer.
- **BR-049** Maximum 3 offer rounds per booking (mock) to prevent spam.

## 6. Driver earnings, commission & access packages

- **BR-060** **0% per-trip commission** (decided 2026-10-21, D-024; Q-002 resolved). Driver earnings = full fare (`commissionRate = 0`; `driverEarnings` returns the fare). Passenger-borne processing fees are not driver earnings and are never deducted from the fare. *(Superseded: 15% mock commission.)*
- **BR-061** Earnings previews are labelled "Estimated" until the backend settles the trip.
- **BR-062** Drivers pay for platform access through **access packages** instead of commission. **Confirmed by the owner 2026-10-23:** Daily **₦2,000 for 24 hours from successful activation**; Monthly **₦60,000 for 30 consecutive days** (`DRIVER_ACCESS_PACKAGES`, `provisional: false`). Activation happens only after the payment is verified with the provider. **Stacking (D-058, decided 2026-10-23):** a pass bought while another is active or already queued starts at the **later of its payment confirmation time and the end of the driver’s last scheduled pass**; it is never calculated from confirmation time alone. Daily is exactly 24 hours, monthly exactly 30 × 24 hours; no overlap and no lost time. Confirmation, start and end are stored separately. Renewal is manual; grace period and VAT treatment remain open (Q-043).

## 7. Driver eligibility (mock rules; enforced by backend later)

- **BR-070** A driver is eligible for a request when: verification status = `approved`, online, not on an active trip, vehicle category matches, within the pickup search radius (mock 5 km), and rating ≥ 4.0 (mock).
- **BR-071** Drivers whose documents expire become ineligible until renewed.
- **BR-072** A driver needs an **active access package** (BR-062) to go online (`hasActiveAccess`; `GO_ONLINE` rejected with `no_access_package`). The backend must also reject matching to drivers without active access. Access is continuous while any pass is in force; queued passes take over automatically at their start time (status is derived from the clock, no job needed). See BR-138 for trips in progress.
- **BR-073** A driver can go online only with foreground location permission and **precise** location; new requests are paused while location is missing, approximate only, interrupted, stale or less accurate than the dispatch threshold (placeholder 100 m), and the driver is told why (D-026). An active trip continues. Going offline is blocked during an active trip.

## 8. Cancellation

- **BR-080** Passenger cancellation is free before a driver is matched, and within **2 minutes** after match (mock).
- **BR-081** After the free window, or after the driver has waited **5 minutes** at pickup, a cancellation fee may apply (mock ₦500). The fee is shown **before** the passenger confirms cancellation.
- **BR-082** Driver cancellations after acceptance count toward driver reliability (backend).
- **BR-083** Cancellation reasons are collected (optional) for both roles.

## 9. Trip lifecycle

States: `driver_en_route → driver_arrived → in_progress → completed`. `cancelled` is reachable from `quoted` up to and including `driver_arrived`; once a trip is `in_progress` it cannot be cancelled in-app — the passenger can ask the driver to end the trip early or contact Support/Safety (see `UI_STATES.md`, Q-033 resolved 2026-10-21).

- **BR-090** The driver must mark "Arrived" before starting a trip; the trip starts only after passenger confirmation (driver confirms the passenger's name; a PIN is a future option, Q-010).
- **BR-091** The final fare equals the locked/agreed fare unless the route changed materially (backend rule, Q-005).

## 10. Payment

- **BR-100** Launch methods (decided 2026-10-21, D-023): **GoBye Wallet** and **bank transfer**. **Cash** is an open decision (Q-001) and is disabled in `MOCK_PAYMENTS_CONFIG.enabledMethods`. **Cards are not in scope.** *(Superseded: Cash, Card, Wallet.)*
- **BR-101** Physical ride fares are services consumed outside the app; Apple In-App Purchase must **not** be used (App Review Guideline 3.1.3(e)). The same applies to wallet top-ups and driver access packages, which pay for the real-world transport service (confirm with Q-043 review).
- **BR-102** Digital payments are authorised/confirmed by a payment provider via the backend (provider open, Q-042). The app stores no bank credentials; virtual-account details are shown, never bank logins.
- **BR-103** Failed or unconfirmed payment at trip end: the trip remains `payment_pending` until resolved. Wallet failure → "Try again" or "Use another method". Bank transfer not yet received → "Check again" or "Use another method" (see BR-107).
- **BR-104** All payments in the current build are **simulated** and labelled as such.
- **BR-105** Payment-processing charges are **disclosed separately** from the fare — on the payment picker, the ride options screen (e.g. "+ ₦50 bank transfer fee, separate from the fare"), the payment screen and the receipt (`fare`, `processingFee`, `totalPaid`). The payment method never changes the fare. Fee rules are per method (`fixed`, `percent`, optional `cap`, `bearer` = passenger/driver/platform); only passenger-borne fees are added to the passenger total. **Placeholder values:** wallet ₦0 (platform-borne); bank transfer **₦50 fixed, passenger-borne — PLACEHOLDER** pending the real provider (Q-042); cash ₦0.
- **BR-106** For wallet payments the balance must cover the **total** (fare + passenger-borne fee) before booking: Quick Match booking with Wallet is blocked when the balance is short (top up or pay by bank transfer), and in Negotiate the passenger cannot select a driver response the wallet cannot cover. Wallet trips are charged automatically at trip end.
- **BR-130** Wallet funding and withdrawal fees come from **versioned, effective-dated fee schedules** approved by the owner (D-054, `gateway/fees.ts`). A fee that is not set blocks the operation; no amount is assumed. Actual provider charges depend on the selected provider (Q-042) and fee values are open (Q-073).
- **BR-131** Every fee is shown before the customer confirms: GoBye fee, provider charge when the customer pays it, total paid and the amount that arrives (`FeeQuote.disclosure`).
- **BR-132** Money is recorded as separate figures (gross, provider charge, GoBye fee, wallet or earnings movement, settlement) in one balanced journal; GoBye fees post to `fee_income`, absorbed provider charges to `processing_costs`, unexplained gaps to `suspense`.
- **BR-133** A payment is confirmed only by a server-to-server lookup that matches the quoted amount and currency; a webhook alone never credits. A reference is credited once.
- **BR-134** A payout is never submitted twice; after an unknown outcome it must be looked up by reference first. Successful financial operations are never replayed.
- **BR-135** Switching payment provider needs the new provider live with every required capability, the current one reconciled and owner approval; payments in flight finish on the old provider.
- **BR-136** Background workflows run only on the server, from the Automation Centre registry (D-055), with idempotency keys, bounded retries for transient failures only, timeouts and escalation to a named role.
- **BR-137** The driver pass timeline (`packages/core/src/subscriptions`) is the only place pass validity is calculated. The Driver App and the admin render the same `SubscriptionTimelineResponse`. Writes are idempotent by payment reference (a repeated webhook adds no time) and use optimistic concurrency (`expectedVersion`); simultaneous purchases are ordered by (confirmation time, reference) so the result does not depend on arrival order.
- **BR-138** A trip the driver accepted while they had access may be completed after the pass ends (`mayCompleteTrip`); no new ride requests are offered without an active pass.
- **BR-139** Cancelling, refunding or reversing a pass never deletes it: it stays in history with its status and reason; access it had already given stands, unused time is removed, and later queued passes move up. A void never extends access. Refunded and reversed passes are not counted as revenue. Paying the money back is a separate finance step.
- **BR-107** Bank transfer at trip end: the passenger sees virtual-account details (bank, account number, account name, exact amount) and taps "I've sent the transfer"; the app then checks for the transfer. If not received → "Transfer not received yet", with "Check again" or another method. While awaiting the passenger's action the passenger can switch to "Pay with GoBye Wallet instead". In production, confirmation comes from the provider (webhook), never from the passenger's tap alone. *(Current build: simulated account "GoBye Demo Bank", 10-digit number derived from the booking ID; simulated check may report "not received yet".)*
- **BR-108** Each charge/confirmation attempt uses the idempotency key `${bookingId}-${attempt}`; the attempt counter is persisted on the booking so retries after an app restart never double-charge.

## 11. Disputes & ratings

- **BR-110** Either party can report a fare or safety issue for a trip within 7 days (mock) via Support.
- **BR-111** Ratings are 1–5 stars, optional comment ≤ 300 characters. Ratings below 3 prompt for a reason.

## 12. Safety

- **BR-120** Emergency contact and "share trip" are UI only in this build; no emergency service is contacted. The UI must say so.
