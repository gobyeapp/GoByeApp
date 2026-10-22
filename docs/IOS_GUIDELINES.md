# GoBye — iOS Guidelines (Apple HIG applied)

**Scope:** how Apple's Human Interface Guidelines (HIG) apply to the GoBye Rider app (screens `R01`–`R28`) and GoBye Driver app (`D01`–`D17`) as listed in `SCREEN_INVENTORY.md`.
**Reviewed:** 2026-10-21, against the live HIG pages (Markdown versions of the same URLs). Change-log dates quoted are those shown on each page.
**Status:** guidance only. Nothing here is device-verified; tick acceptance criteria only after testing (`DEVICE_TEST_MATRIX.md`).

Legend: **[HIG]** = stated by Apple · **[GoBye]** = our application of it · **[Unverified]** = not confirmed against an official source in this review.

---

## 1. Official sources

| Topic | URL | Last change shown on page |
|---|---|---|
| Accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility | 9 Jun 2025 |
| Typography | https://developer.apple.com/design/human-interface-guidelines/typography | — |
| Layout | https://developer.apple.com/design/human-interface-guidelines/layout | 9 Sep 2026 |
| Tab bars | https://developer.apple.com/design/human-interface-guidelines/tab-bars | 8 Jun 2026 |
| Sheets | https://developer.apple.com/design/human-interface-guidelines/sheets | 24 Mar 2026 |
| Maps | https://developer.apple.com/design/human-interface-guidelines/maps | 18 Dec 2024 |
| Search fields | https://developer.apple.com/design/human-interface-guidelines/search-fields | 8 Jun 2026 |
| Motion | https://developer.apple.com/design/human-interface-guidelines/motion | 9 Sep 2025 |
| Playing haptics | https://developer.apple.com/design/human-interface-guidelines/playing-haptics | 7 May 2024 |
| Feedback | https://developer.apple.com/design/human-interface-guidelines/feedback | — |
| Alerts | https://developer.apple.com/design/human-interface-guidelines/alerts | 2 Feb 2024 |
| Privacy | https://developer.apple.com/design/human-interface-guidelines/privacy | 21 Jun 2023 |
| Loading | https://developer.apple.com/design/human-interface-guidelines/loading | 9 Jun 2025 |
| Dark Mode | https://developer.apple.com/design/human-interface-guidelines/dark-mode | 6 Aug 2024 |
| Core Location authorisation | https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services | — |

Not reviewed this session (consult before building the related UI): Buttons, Text fields / Entering data, Keyboards, Progress indicators, Action sheets, Notifications, VoiceOver, Onboarding, Managing accounts.

---

## 2. Global rules (apply to every screen)

### 2.1 Touch targets and spacing — Accessibility
- [HIG] iOS default control size **44×44 pt**, minimum **28×28 pt**.
- [HIG] Padding of about **12 pt** around bezelled elements and about **24 pt** around non-bezelled elements.
- [HIG] Offer onscreen alternatives to gestures (e.g. a button as well as swipe-to-dismiss).
- [GoBye] All tappable elements in `@gobye/ui` use a 44×44 pt minimum hit area (use `hitSlop` where the visual is smaller, e.g. 24 pt icons). 28 pt is not used for primary actions.

### 2.2 Typography and Dynamic Type — Typography, Accessibility
- [HIG] iOS default text size **17 pt**, minimum **11 pt**; thin custom fonts should be larger than recommended sizes.
- [HIG] Large (default) Dynamic Type sizes (pt, size/leading): Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25, Headline 17/22 semibold, Body 17/22, Callout 16/21, Subhead 15/20, Footnote 13/18, Caption 1 12/16, Caption 2 11/13.
- [HIG] Support enlargement to at least 200 %; keep truncation to a minimum; stack horizontally adjacent items at large sizes; keep the hierarchy consistent; scale meaningful icons with text.
- [GoBye] Inter type scale mirrors the table above (D-014). `allowFontScaling` stays on; `maxFontSizeMultiplier` only on fixed-size chrome (tab labels). Fare amounts, ETAs and driver names must never truncate at accessibility sizes — wrap or stack instead.

### 2.3 Colour, contrast and appearance — Accessibility, Dark Mode
- [HIG] Minimum contrast (WCAG AA as used by Accessibility Inspector): **4.5:1** for text up to 17 pt; **3:1** for 18 pt+ or bold text. Dark Mode page: no lower than 4.5:1; strive for **7:1** for custom colours, especially small text.
- [HIG] Do not convey information by colour alone; check contrast in both appearances and with Increase Contrast.
- [HIG] Avoid an app-specific appearance setting; use colours that adapt; use system base/elevated backgrounds for layered UI.
- [GoBye] Light and dark tokens in `@gobye/ui/theme`; no in-app theme switch (ARCHITECTURE §7). Status (offer expired, driver unavailable, payment failed) always combines icon + text + colour. Sheets and modals use the elevated surface token in dark mode.

### 2.4 Layout and safe areas — Layout
- [HIG] Respect safe areas so the Dynamic Island, status bar and home indicator don't obstruct content/controls; extend full-screen backgrounds (the map) beneath bars; determine layout by size class, not device type.
- [GoBye] Map extends edge to edge; all controls (locate button, sheet content, buttons) sit inside `SafeAreaProvider` insets. Test smallest and largest iPhones at default and largest text size.

### 2.5 Navigation: tab bar — Tab bars
- [HIG] Tabs are for navigation, not actions; keep the tab bar visible except under modals; avoid a More tab; never hide or disable tabs; single-word labels; badges only for critical information. iOS 26 tab bars float on Liquid Glass and may minimise on scroll.
- [GoBye] Rider tabs: Home, Activity, Account. Driver tabs (planned): Home/Dashboard, Earnings, Trips, Account (≤ 5). Because GoBye uses JS `Tabs` (D-003), Liquid Glass and minimise-on-scroll behaviour are **not** provided automatically; the custom bar must still meet 44 pt targets, labels and VoiceOver `tab` roles with selected state. "Book a ride" is never a tab.

### 2.6 Sheets — Sheets, Maps
- [HIG] Detents: large (full) and medium (about half); custom detents allowed. Include a grabber in resizable sheets (it also works with VoiceOver); support swipe to dismiss; one sheet at a time; Cancel on the leading edge, Done on the trailing edge; a nonmodal sheet can let people keep interacting with the parent view.
- [GoBye] `MapSheet` (D-010) is a custom nonmodal sheet over an interactive map. It must provide: visible grabber; an accessibility action/button to expand and collapse (VoiceOver equivalent of the grabber); snap points equivalent to medium/large plus a collapsed peek; no second sheet stacked on it (close or replace first).

### 2.7 Motion and haptics — Motion, Accessibility, Playing haptics
- [HIG] Motion must be purposeful, brief and cancellable, and never the only way to communicate. With Reduce Motion on: reduce automatic/repetitive animation, zooming, scaling and peripheral motion; prefer fades over slides; avoid animating blurs.
- [HIG] Use system haptic patterns for their documented meanings (notification success/warning/error; impact light/medium/heavy/rigid/soft; selection); don't overuse; complement visual feedback; make haptics optional.
- [GoBye] `motion` tokens read Reduce Motion (`AccessibilityInfo` / Reanimated `useReducedMotion`). Haptic mapping: selection → vehicle/fare stepper changes; success → driver matched, fare agreed, trip completed, payment succeeded; warning → offer about to expire, cancellation fee notice; error → payment failed, booking failed. Settings (R27) includes a haptics toggle.

### 2.8 Alerts and feedback — Alerts, Feedback
- [HIG] Use alerts sparingly; never at launch; not for information only; ≤ 3 buttons; specific verb titles rather than "OK"; button that cancels is always titled "Cancel"; destructive style only for destructive actions people didn't deliberately choose; use action sheets for choices related to an intentional action; avoid scrolling alerts.
- [HIG] Integrate status into the interface; confirm significant completed actions; explain why a command can't be carried out.
- [GoBye] Offline / no-network is shown inline (banner) not as an alert. Cancel-ride confirmation is an alert because it can carry a fee. **Open item:** HIG requires the dismiss button to be titled "Cancel", which reads ambiguously next to "Cancel Ride"; decide between following HIG literally ("Cancel Ride" / "Cancel") or a recorded deviation ("Cancel Ride" / "Keep Ride") in `DECISIONS.md`.

### 2.9 Loading — Loading
- [HIG] Show something immediately (placeholders); use determinate progress when duration is known and indeterminate otherwise; let people do other things while loading.
- [GoBye] Skeletons for lists and fare cards; the map renders before location resolves; quote loading never blocks editing pickup/destination.

### 2.10 Permissions — Privacy, Core Location
- [HIG] Request permission only when the feature needs it; avoid requesting at launch unless essential; purpose strings are brief, active, sentence-case, end with a full stop.
- [HIG] A pre-permission screen may have **only one button**, titled e.g. "Continue" or "Next" (not "Allow"), and **no Cancel/Close**.
- [HIG] Core Location's `LocationButton` grants one-time access. [Unverified] availability of an equivalent in React Native/Expo — not assumed.
- [GoBye] See R06 and D10. Purpose-string text: `APP_STORE_COMPLIANCE.md` §5.

### 2.11 Time-limited UI — Accessibility
- [HIG] "Minimize use of time-boxed interface elements… Prefer dismissing views with an explicit action."
- [GoBye] Offer and response expiry (BR-042, BR-044) and driver request timers are inherent to the product. Mitigations: show remaining time as text (not only a ring), announce key thresholds to VoiceOver, never auto-dismiss a screen without leaving a clear "expired" state and next action, and keep durations configurable on the backend.

---

## 3. Shared components — acceptance criteria

**`MapCanvas` (Maps)**
- [ ] Map is interactive (pan, zoom, rotate) on every screen where it appears; no permanent noninteractive overlay covers it. [HIG]
- [ ] Overlapping driver markers cluster or are limited at low zoom. [HIG]
- [ ] Selected pickup/destination has distinct styling (not colour alone). [HIG]
- [ ] On Apple Maps, the Apple logo and legal link stay visible: ~7 pt side padding, ~10 pt above/below, placed ~10 pt above the **lowest resting position** of `MapSheet`, and fixed to the map rather than moving with the sheet. [HIG] (Implementation prop in `react-native-maps`, e.g. legal label insets — [Unverified], check library docs.)
- [ ] If Google Maps Platform is adopted (D-025, Proposed — `PROVIDER_GOOGLE` on iOS too), the **Google logo and attribution/legal text stay visible** and are not covered by `MapSheet`, custom controls or the safe area (use map padding so they sit above the sheet's lowest resting position). Google's attribution requirements replace the Apple Maps logo requirement above for Google-rendered maps. [Google Maps Platform terms/attribution policy — Unverified in this review; check before release]
- [ ] Custom controls on the map have sufficient contrast (stroke or shadow). [HIG]
- [ ] Muted map emphasis considered for information-dense screens (R09, R13, D13). [HIG] (Support in `react-native-maps` — [Unverified].)

**`MapSheet`**
- [ ] Grabber visible; VoiceOver can expand/collapse via an action. [HIG]
- [ ] Map remains interactive above the sheet at peek and medium heights. [HIG]
- [ ] Sheet content respects bottom safe area and Dynamic Type (scrolls rather than clips). [HIG]
- [ ] Snap animations become fades/instant with Reduce Motion. [HIG]

**Tab bar (`GoByeTabBar`)**
- [ ] One-word labels, filled icon when active / regular when inactive (D-015), 44 pt targets, selected state announced. [HIG]
- [ ] Visible on all tab root screens; hidden only under modals and full-screen booking/trip flows that are modal in nature. [HIG]

**Buttons, fields, toasts**
- [ ] 44×44 pt minimum; disabled state not conveyed by colour alone (also `accessibilityState.disabled`). [HIG]
- [ ] Toasts do not auto-dismiss critical information; anything actionable remains reachable after the toast disappears. [HIG, time-boxed elements]

---

## 4. Rider app — screen acceptance criteria

### R01–R02 Launch gate, onboarding
- [ ] No permission prompt and no alert at launch. [HIG Privacy, Alerts]
- [ ] Onboarding has a Skip action and is skippable via VoiceOver; pager is not gesture-only (Next button). [HIG Accessibility]
- [ ] Illustrations have `accessibilityLabel` or are hidden from VoiceOver if decorative.

### R03–R05 Phone sign-in, OTP, name
- [ ] Phone field uses a numeric keypad and `textContentType="telephoneNumber"`; OTP field uses `oneTimeCode` for autofill. [Unverified — confirm in Keyboards/Entering data HIG]
- [ ] Validation errors shown inline with text (not colour alone); submit disabled while in flight (BR-033 pattern).
- [ ] Resend cooldown remaining time shown as text.
- [ ] Only data needed for the account is requested (first/last name; email optional). [App Review 5.1.1(iii)]
- [ ] Terms/privacy links are reachable before account creation.

### R06 Location pre-permission
- [ ] Shown only when the user engages pickup/home map, not at launch. [HIG Privacy; Core Location]
- [ ] Exactly **one** primary button titled **"Continue"** that triggers the system prompt; no Cancel/Close on this screen. [HIG Privacy]
- [ ] "Enter pickup manually" is not shown as a second button on the pre-permission screen; manual entry is offered on R07/R08 after a denial or as a normal search path. (Current inventory lists it on R06 — **revise** to comply.)
- [ ] Denied/restricted states explain impact and offer "Open Settings" plus manual entry.
- [ ] If the user grants approximate location only, pickup UI says location is approximate and asks the user to confirm the pin; temporary precise access is requested at pickup with the `pickup` purpose key (see `APP_STORE_COMPLIANCE.md` §5). [Core Location; expo-location support — Unverified]

### R07–R08 Home, destination/pickup search
- [ ] Map full-bleed under status bar; search field and locate button inside safe area. [HIG Layout]
- [ ] Search placeholder states scope ("Where are you going?"); results update as the user types; recent and saved places shown before typing; most relevant results first. [HIG Search fields]
- [ ] GPS accuracy shown as text ("Accurate to about 35 m"), not just a halo.
- [ ] Offline state is an inline banner; cached saved places remain usable. [HIG Alerts, Loading]
- [ ] Empty, no-results and error states each give a next action.

### R09–R12 Ride options, payment picker, negotiate, searching
- [ ] Unavailable vehicle categories shown disabled with a reason (BR-010), announced by VoiceOver.
- [ ] Fare amounts use tabular figures and never truncate at accessibility sizes; breakdown reachable without gestures.
- [ ] Quote expiry and offer/response timers shown as text; expired items clearly marked and not selectable (BR-022, BR-044). [HIG time-boxed]
- [ ] Fare stepper plays selection haptic per step; agreement plays success haptic. [HIG Haptics]
- [ ] R10 payment picker: modal sheet with Cancel (leading) / Done (trailing) if it has a Done button. [HIG Sheets]
- [ ] Simulated payment methods labelled "Simulated" (BR-104).
- [ ] R10 lists only GoBye Wallet and Bank transfer (D-023); any processing fee is shown as a **separate line/label**, never folded into the fare (BR-105), and read by VoiceOver with the method.
- [ ] Wallet shortfall (BR-106) explained as text with next actions (Top up / Pay by bank transfer); the disabled Book button carries `accessibilityState.disabled` and a reason.
- [ ] R12 pulse animation stops or becomes a static indicator with Reduce Motion; Cancel always available. [HIG Motion]
- [ ] Book/Send-offer buttons disabled while submitting (no duplicate submissions).

### R13–R16 Active trip, payment result, receipt, rating
- [ ] ETA and driver position labelled "Simulated" while mock services are used. [App Review 2.3]
- [ ] Driver name, vehicle, colour and plate readable at the largest text size; VoiceOver reads them as one logical group.
- [ ] Cancel ride shows the fee **before** confirmation (BR-081) in an alert with specific verbs. [HIG Alerts]
- [ ] Safety/share-trip screens state that no emergency service is contacted in this build (BR-120). [App Review 5.1.5 forbids location APIs for emergency services]
- [ ] Payment failure explains why and offers Try again / Use another method (bank transfer: "Transfer not received yet" → Check again / Use another method); error haptic + text. [HIG Feedback] *(Revised 2026-10-21: cash and cards are not launch methods, D-023.)*
- [ ] Bank-transfer details (bank, account number, account name, amount) are selectable/copyable text and read in a sensible order by VoiceOver; "Checking for your transfer…" progress is announced (`accessibilityLiveRegion`/announcement). [HIG Loading, Accessibility]
- [ ] Rating stars are individually accessible (adjustable or buttons with labels "1 star"…"5 stars"); Skip available.

### R17–R28 Activity and account
- [ ] Activity: skeleton while loading; empty state with explanation.
- [ ] Account lists use 44 pt rows with chevrons only for navigation.
- [ ] R24 referral uses the system share sheet.
- [ ] R25 trusted contact: manual entry or system contact picker (no full Contacts permission). [App Review 5.1.1(iii)]
- [ ] R27 includes haptics toggle and "Open Settings" for permissions; **no appearance (light/dark) toggle**. [HIG Dark Mode, Haptics]
- [ ] R28 Delete account is reachable from Account → Settings (or Account) in ≤ 3 taps, explains consequences and retained data, and requires an explicit confirmation. [App Review 5.1.1(v)]
- [ ] Sign out is not destructive-styled; Delete account confirmation uses specific verbs ("Delete Account").

---

## 5. Driver app — screen acceptance criteria

### D01–D08 Sign-in, registration, documents, verification status
- [ ] Phone/OTP criteria as R03–R04.
- [ ] Multi-step registration uses a stack (Back) or a full-screen modal for long flows; not nested sheets. [HIG Sheets]
- [ ] Document capture uses the system photo picker where possible (no full Photos access); camera permission requested only when the driver taps "Take photo", with purpose string. [HIG Privacy; App Review 5.1.1(iii)]
- [ ] Each upload shows progress (determinate if size known) and a retry path. [HIG Loading]
- [ ] Verification status (pending / approved / rejected) uses icon + text; rejection explains what to fix.

### D09–D10 Dashboard, background-location explanation
- [ ] Online/offline control is a clearly labelled control (not a tab), 44 pt, state announced ("Online", "Offline").
> **Revised 2026-10-21 — D-026 (Q-012 resolved).** The Driver app requests **When In Use only** and **never requests "Always" automatically**. Background updates continue while online because the app declares `UIBackgroundModes: location`, sets `allowsBackgroundLocationUpdates = true` and **starts updates in the foreground** when the driver goes online (Apple: https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates). The criteria below replace the earlier "background/Always request" wording.

- [ ] Foreground (When In Use) location requested only when the driver first goes online (or opens the map), via D10 pre-permission with one "Continue" button; no Cancel. [HIG Privacy]
- [ ] **No "Always" prompt** at any point (including the provisional upgrade prompt). [D-026]
- [ ] **Precise location required** to go online: if the driver granted approximate only, explain why precise is needed (pickup accuracy) and offer "Open Settings"; temporary full-accuracy request is an option to verify in `expo-location` [Unverified]. [Core Location]
- [ ] D10 text states that location is used while the app is in the background **only while online or on a trip** and stops when offline. [Core Location]
- [ ] While online, the **blue background-location indicator** appears when the app is backgrounded; the dashboard explains this before it appears. [Core Location `allowsBackgroundLocationUpdates` / `showsBackgroundLocationIndicator`]
- [ ] If permission is revoked, precise is turned off, updates stop or the position goes stale, the dashboard shows the reason (icon + text, `trackingIssueMessage`) and states that **new requests are paused**; an active trip continues. [D-026, BR-073]
- [ ] Go offline is disabled during an active trip with an explanation ("Finish the trip first").
- [ ] Go online requires an active access package; without one, the driver is directed to buy Daily/Monthly access (prices labelled provisional). [BR-072]
- [ ] Earnings marked "Estimated" (BR-061); copy states GoBye takes **no per-trip commission** (D-024).

### D11–D12 Incoming request, negotiation
- [ ] Request presented as a full-screen or prominent modal with Accept / Decline, remaining time as text, and a warning haptic near expiry. [HIG Haptics, time-boxed]
- [ ] Pickup, destination, distance, ETA, fare and estimated earnings readable at large text sizes (stack layout).
- [ ] Counteroffer stepper enforces BR-043 range; invalid values explained inline.
- [ ] Expired request leaves a visible "Expired" state; no silent dismissal.
- [ ] Alert/sound is not the only signal of a new request (visual + haptic + optional sound). [HIG Accessibility, Feedback]

### D13–D14 Active trip, trip complete
- [ ] Stage actions (Arrived, Confirm passenger, Start, Complete) are single large buttons; irreversible steps confirm once.
- [ ] Passenger confirmation by name (BR-090) readable to VoiceOver.
- [ ] "Navigate" hands off to a maps app or shows in-app route; simulated routes labelled.
- [ ] Payment status and earnings use icon + text; success haptic on completion.

### D15–D17 Earnings, trips, account
- [ ] Earnings charts have a text/table alternative.
- [ ] Payout/wallet UI labelled simulated.
- [ ] Documents section shows expiry dates (BR-071) with icon + text status.
- [ ] Delete account criteria as R28.

---

## 6. Open items

1. R06 currently lists a second action ("Enter pickup manually") on the pre-permission screen — conflicts with HIG single-button rule. Move manual entry to R07/R08.
2. Alert button wording for "Cancel ride" (see §2.8).
3. JS tab bar vs iOS 26 Liquid Glass native tab bar (D-003) — record visual parity decision.
4. Verify in library docs: `react-native-maps` legal-label insets and muted style; `expo-location` support for reduced accuracy / temporary full accuracy on iOS.
5. (2026-10-21) Verify in the Driver development build whether `expo-location`'s config plugin adds `NSLocationAlwaysAndWhenInUseUsageDescription` (and whether `isIosBackgroundLocationEnabled` requires it) even though GoBye never requests Always (D-026). If the key is emitted, its text must still be accurate; confirm no Always prompt appears at runtime.
6. (2026-10-21) Locked-screen, background, app-switch and interrupted-session location behaviour is **untested** on real devices (`DEVICE_TEST_MATRIX.md`).
