# Connected demo: rider app + driver app + admin (D-049)

The rider app, the driver app and the admin can share the same **test** records without a backend, through a
small "demo relay". It works on one Wi-Fi network (local relay on your computer) or over the internet
(Supabase `demo_*` tables). Everything in it is test data: no real money, no real verification, no real SMS.

## Quick start (same Wi-Fi)

1. At the repo root: `npm install`, then `npm run demo:relay`. Keep that window open.
   It prints `Phones (same Wi-Fi): http://192.168.x.x:8787` and writes `.env.local` in `apps/rider`,
   `apps/driver` and `apps/admin` so each one knows where the relay is.
2. Rider app: `cd apps/rider` → `npx expo start -c` (the `-c` matters: the address is baked in at start).
3. Driver app (second phone or a simulator): `cd apps/driver` → `npx expo start -c --port 8082`.
4. Admin: `npm run admin` → open the printed address → sign in with a test staff account → **Connected demo**.
5. Phones and computer must be on the same Wi-Fi. If a phone shows "Demo · relay unreachable", check the
   Wi-Fi, and allow Node through the Windows firewall on private networks.

Each app shows a "Demo · connected · <address>" pill (driver: Drive tab and Account; rider: Account and the
searching screen; admin: page header). Delete `.env.local` (and restart with `-c`) to go back to the fully
simulated, offline preview.

## The end-to-end walk

| Step | Who | What happens |
|---|---|---|
| 1 | Driver | Creates an account → driver pass → lands on the dashboard with a **verification card** (Register → Review → Drive), steps to do, and "Go online opens once you're approved". |
| 2 | Driver | Finishes registration → **Submit for review**. The application appears in Admin → Connected demo → Driver applications. |
| 3 | Admin | Opens it: details (ID and licence numbers masked; photos stay on the phone), five checks. Sets a check to **Waiting** with a reason (e.g. FRSC licence check) → the driver's card shows "Review is taking longer" with that reason and since when. |
| 4 | Admin | **Request changes** (e.g. "Insurance certificate has expired", with a note) → the driver's card shows "Fix 1 thing", the fix, and a Fix button that opens the right step. |
| 5 | Driver | Fixes the step → **Send back for review**. |
| 6 | Admin | **Approve** (or Reject with a reason). The driver's card disappears; Go online is available. |
| 7 | Driver | Buys an access pass (simulated) → **Go online**. |
| 8 | Rider | Creates an account → books a ride (Quick Match or Negotiate). |
| 9 | Driver | Gets the rider's real request → Accept (or counter on a negotiated ride; the rider sees and picks it). |
| 10 | Both | Rider sees the driver, car and plate and the pickup PIN; the driver's position and every stage (arrived, PIN, trip, complete) sync both ways. |
| 11 | Rider | Pays (wallet or bank transfer, simulated) → the driver's trip-complete screen turns to **Received**. |
| 12 | Admin | Rides tab shows the ride, timeline and payment; Overview shows counts and the activity feed. Staff can cancel an active ride with a reason; both apps end it with a message. |

Without a relay, the driver's review is simulated on the phone: checks run one by one, the licence check waits
"on the FRSC" for a while, then the account is approved, so the card's stages can still be shown.

## Over the internet (Supabase, optional)

Run `supabase/migrations/20261022_demo_relay.sql` in the Supabase SQL editor, then set, instead of the local
address: `EXPO_PUBLIC_DEMO_RELAY_URL=https://<project>.supabase.co` and `EXPO_PUBLIC_DEMO_RELAY_KEY=<anon key>`
in `apps/rider/.env.local` and `apps/driver/.env.local`, and `VITE_DEMO_RELAY_URL` / `VITE_DEMO_RELAY_KEY` in
`apps/admin/.env.local`. **These tables let the anon key read and write demo rows: test data only, and drop
them after the demo** (the SQL file has the drop statement). Never use the service role key in an app.

## How it works

- `packages/core/src/relay/`: record types, a PostgREST-style client (`createRelay`), an in-memory relay for
  tests, the rider's relay-backed `MatchingService` / `TripService`, driver helpers (`openRidesForDriver`,
  `claimRide`, `responseRow`), and `withRelayStatus` for the connection pill.
- `packages/core/src/driver/verification.ts`: checks, outside-delay reasons, flaggable issues and the
  driver card summary (`verificationSummary`), shared by the driver app and the admin.
- `tools/demo-relay/server.mjs`: the local relay (no dependencies; data in `tools/demo-relay/data.json`;
  `POST /reset` clears it).
- Tables: `demo_people`, `demo_driver_applications`, `demo_rides`, `demo_ride_responses` (insert-only
  driver answers), `demo_events` (activity feed). Each side only patches the fields it owns (the rider: PIN,
  chosen driver, payment; the driver: claim, position, stages; staff: review and cancellations).
- Polling every 2–3 s; no websockets. Fine for a demo; the real backend will push (BACKEND_HANDOVER §8).
