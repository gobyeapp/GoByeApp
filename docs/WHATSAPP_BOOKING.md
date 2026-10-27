# WhatsApp quick booking (D-064)

**Status (2026-10-27):** built and tested in code, **not live**.
- It is switched off (`WHATSAPP_PROVIDER=none`) in every environment template.
- It goes live only after the owner's Meta setup (§5), a staging deployment (`BACKEND_PHASE_1_VERIFICATION.md` §4.6) and the owner's approval.
- No Meta account, number or token was created or used.

## 1. What it is

WhatsApp is a **faster way in**, nothing more. Riders book a Quick Match ride in a WhatsApp chat. **Everything after booking happens in the app:** the driver, tracking, chat, safety, payment, receipt and ratings.

1. The rider sends GoBye their **pickup** as a WhatsApp location pin (📎 → Location: current location, or search a place).
2. They send their **destination** the same way.
3. GoBye replies with Quick Match fares as a list ("GoBye Car · ₦4,200 · 4 seats").
4. The rider taps one. GoBye books the ride and replies **"Booked!"** with an **Open GoBye** button.
5. The rider follows the ride in the app. Before a driver is assigned, they can reply **CANCEL** in the chat (no fee).

Rules (enforced in `packages/core/src/whatsapp/conversation.ts` and on the server):
- **Who can book:** only a rider whose GoBye account has **this WhatsApp number**, active and not suspended. The number comes from Meta's signed webhook, never from the message. Unknown numbers get a sign-up link. Phase 2 must store only **verified** phone numbers on accounts (D-045 / D-062).
- **Booking mode:** Quick Match only. Negotiate stays in the app.
- **Where:** the pickup must be in a launch city (Lagos, Abuja; rough boxes until real service areas exist). The destination must be between 200 m and 100 km away.
- **Fares:** computed on the server with `@gobye/core` `createQuote`. A tap books only an option this server offered in this session, and only while its quote is valid (5 minutes); after that the chat prices again.
  - Pricing values are still the placeholders in `MOCK_PRICING_CONFIG` (D-007).
  - With the fake maps provider, fares are labelled **"test fare"**.
- **One open ride per rider:** a new pin while a ride is open sends the rider to the app. The database also refuses a second open ride.
- **Payment:** after the trip, in the app (D-030). The chat never asks for a payment method and never says "paid".
- **Old messages:** a message older than 10 minutes is ignored, because Meta can redeliver for hours. No surprise bookings.
- **Cancelling from the chat:** possible only for rides booked on WhatsApp, and only before a driver is assigned. After that the chat sends the rider to the app.
- **Safety net:** every WhatsApp booking sends an in-app notice to the account holder ("booked on WhatsApp"), so a booking made from someone else's unlocked phone is visible.

## 2. How it works

```
Meta ──POST──▶ api.gobye.app/v1/webhooks/whatsapp  (gateway route class "webhooks": no user token, raw body kept)
                 │ API: verify X-Hub-Signature-256 (app secret) → record message id (dedupe) → queue job
                 ▼
         ops.jobs "whatsapp.inbound" (worker): lock app.whatsapp_sessions row for this number
                 │ step() from @gobye/core → effects: quote (maps + createQuote) / book (app.rides,
                 │ channel 'whatsapp', ride_events + audit) / cancel → save session
                 ▼
         ops.jobs "whatsapp.send" → WhatsApp Cloud API (or the simulated sender) → reply to the rider
```

| Piece | Where |
|---|---|
| Conversation, service areas, Cloud API parsing and message building | `packages/core/src/whatsapp/` (pure; 13 tests) |
| Webhook (GET verification, POST messages) | `apps/api/src/whatsapp/whatsapp.controller.ts` |
| Jobs, booking, cancel, cleanup, signature check | `apps/api/src/whatsapp/whatsapp.service.ts` |
| Senders: `simulated`, `cloud_api` | `apps/api/src/providers/providers.ts` |
| Tables | `apps/api/migrations/0006_whatsapp_booking.sql`: `app.rides.channel`, `app.whatsapp_sessions`, `ops.whatsapp_messages`, hourly `whatsapp.cleanup` |
| Gateway route | `infra/cloudflare/src/workers/api-gateway/routes.ts`: class `webhooks`, GET/POST, 64 KB, 600/min. The `X-Hub-Signature-256` header is forwarded. |
| "Open GoBye" links | `https://gobye.app/open/ride/<id>` → `apps/web/open.html`, which opens `gobye://open/ride/<id>` in the rider app (`apps/rider/src/app/open/ride/[id].tsx`). `/open/signup` works the same way. |
| Try it without Meta | `apps/api/scripts/whatsapp-simulate.mjs` sends signed, Meta-shaped messages to a local API |

**Why the reply is a separate job:** if WhatsApp is down, the reply is retried (up to 5 times) without booking twice.

**Retry rules:**
- Errors from WhatsApp's 4xx range (except 429) are permanent and are not retried.
- The access token never appears in errors or logs.

## 3. Configuration (API; names only, values in the host's secret store)

| Variable | Meaning |
|---|---|
| `WHATSAPP_PROVIDER` | `none` (default; the webhook answers 404), `simulated` (records replies; refused in production) or `cloud_api` |
| `WHATSAPP_APP_SECRET` ★ | Meta app secret; verifies every webhook |
| `WHATSAPP_VERIFY_TOKEN` ★ | Our random string (`openssl rand -hex 24`), entered in Meta's webhook settings |
| `WHATSAPP_ACCESS_TOKEN` ★ | System-user token with `whatsapp_business_messaging` (cloud_api only) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta's id for our number. Messages to any other number are ignored. |
| `WHATSAPP_GRAPH_VERSION` | Graph API version, default `v23.0`. Check Meta's current version when going live. |
| `WHATSAPP_OPEN_LINK_BASE` | Default `https://gobye.app/open` |
| `WHATSAPP_BOOKING_ENABLED` | Kill switch. `false` keeps the chat answering ("book in the app") but books nothing. |

Config refuses:
- a missing secret, token or number id;
- WhatsApp without a maps provider;
- the simulated sender in production.

## 4. Privacy

- **Stored:** the conversation state per number (pickup, destination, offered fares), deleted after 24 hours idle; and message **ids and kinds** for de-duplication, deleted after 30 days.
- **Not stored:** message text.
- **Logs:** never numbers or text.
- Rides booked on WhatsApp are ordinary rides (same retention as app rides).
- **To do before launch:** the privacy notice must mention WhatsApp booking, and Meta's processing of messages (NDPA; Q-063).

## 5. Owner checklist (Meta)

| # | Item | State |
|---|---|---|
| 1 | CAC certificate (the business's legal name and address) | ✅ owner has it |
| 2 | Utility bill for GoBye HQ (same address as the CAC certificate) | ✅ owner has it |
| 3 | Meta Business account (business.facebook.com) in the CAC legal name and address; start **Business Verification** | ☐ |
| 4 | Website with the GoBye name, contact details and a privacy policy | ☐ (privacy policy page needed) |
| 5 | Email on the GoBye domain (e.g. hello@gobye.app) | ☐ |
| 6 | A new phone number (fresh SIM, not on any WhatsApp app); two-step verification PIN | ☐ |
| 7 | Display name **"GoBye"** approved | ☐ |
| 8 | Card on the WhatsApp account for message fees | ☐ |
| 9 | Meta app with the WhatsApp product. Webhook URL `https://api.gobye.app/v1/webhooks/whatsapp`, our verify token, subscribed to the **messages** field. | ☐ (needs a deployed API) |
| 10 | System-user access token, app secret and phone number id, set as API secrets (not in chat) | ☐ |

**Option: a UK company opens the account.**
- Use its Companies House certificate, a UK utility bill or bank statement, and a UK card, all matching that company. Don't mix Nigerian and UK papers.
- The WhatsApp number can still be Nigerian (+234).
- Meta prices by the rider's country, so the cost is the same either way.
- Which company should operate rides and hold rider data in Nigeria is a legal question (Q-080).

**Cost:**
- Messages a rider starts, and our replies within 24 hours, are not charged by Meta. A booking chat usually costs nothing.
- Business-initiated templates (none are used today) have per-message prices.
- Check Meta's rate card before launch.

## 6. Going live (in order)

1. Staging ready (`BACKEND_PHASE_1_VERIFICATION.md` §4.6) and rides are matched to drivers (Phase 3). **Until drivers are dispatched by the server, a WhatsApp booking only creates a ride that stays "searching".** That's acceptable in staging, not for riders.
2. Owner checklist §5 done.
3. Staging: `WHATSAPP_PROVIDER=cloud_api` with a **Meta test number** first, then GoBye's number. Book, cancel and check the "Open GoBye" link on iPhone and Android.
4. Privacy notice updated (§4).
5. Owner approval, then production.

## 7. Not done yet

- **The rider app on simulated services can't show a server ride.** It opens an active ride if there is one. Otherwise it shows "We can't show this ride here yet", until the app uses the real ride API (Phase 3).
- **No universal links yet.** Links go through `gobye.app/open/...`; Apple App Site Association and Android App Links come with the store builds.
- **Destinations must be location pins.** Typed addresses would need a places provider (D-025).
- **The in-app notice is not delivered yet.** It goes through the notifications port (`log` in staging); real push comes with the notifications provider.
