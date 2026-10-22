# Dynamic Island / Live Activity — enhancement spec (NOT IMPLEMENTED)

Status: **Proposal only (Q-054).** Nothing in the current build uses Live Activities or the Dynamic Island. The brief (§15) asks for this to be explored as a separate platform enhancement.

## What it would show

| Trip state | Compact (leading / trailing) | Expanded | Lock Screen |
|---|---|---|---|
| Driver on the way | Car icon / "4 min" | Driver first name, car colour + model, plate, ETA, progress bar | Same as expanded |
| Driver arrived | Pin icon / "Here" | "Ama is here — Silver Toyota Corolla, LND 123 XY"; pickup PIN | Same |
| Trip in progress | Flag icon / "12 min" | Destination, ETA to destination, agreed fare (fixed) | Same |
| Payment outstanding | Wallet icon / "Pay" | Amount in naira, "Open GoBye to pay" | Same |

Rules carried over from the app: ETA and progress come from trip data (never a decorative countdown); "Paid" is never shown before confirmation; no continuous passenger location or battery sharing; amounts in naira only.

## What it needs

- A development build (Expo Go cannot run widget extensions) and an iOS **widget extension** written in Swift/SwiftUI using ActivityKit (e.g. via an Expo config plugin / `expo-apple-targets`-style target).
- Server-sent **ActivityKit push updates** (APNs `liveactivity` push type) so the activity stays current when the app is in the background — this depends on the backend trip event stream.
- `NSSupportsLiveActivities` in Info.plist; ending the activity when the trip is paid or cancelled.
- Android equivalent: an ongoing notification with progress (Android 16 "Live Updates" / progress-centric notifications) via `expo-notifications`.
- Device testing on an iPhone with a Dynamic Island and one without (Lock Screen only).

## Open questions

Q-054: whether to build it, and when (after backend trip events exist).
