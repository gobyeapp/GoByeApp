# GoBye — User Flows

**Status:** Draft, 2026-10-21. Flows describe intended behaviour against mock services; nothing is implemented unless `SCREEN_INVENTORY.md` says so. Timers and fees are mock values (`BUSINESS_RULES.md`). Screen IDs (Rxx/Dxx) from `SCREEN_INVENTORY.md`; formal state machines in `UI_STATES.md`.

---

## 1. Rider — onboarding & authentication (R01–R05)

```mermaid
flowchart TD
  A[Launch R01] --> B{Session?}
  B -- "No, first run" --> C[Onboarding R02]
  B -- "No, returning" --> D[Phone R03]
  B -- "Yes + active booking" --> X[Resume booking screen — see §7]
  B -- "Yes" --> H[Home R07]
  C -- "Get started / Skip" --> D
  D -- "Invalid number" --> D
  D -- "Send code" --> E[OTP R04]
  E -- "Wrong code" --> E
  E -- "Too many attempts" --> L[Lockout message with retry time] --> D
  E -- "Resend after cooldown" --> E
  E -- "Verified, existing user" --> H
  E -- "Verified, new user" --> F[Name + terms R05]
  F -- "Continue" --> H
  D -- "Network error" --> D
```

| Step | Failure | Handling |
|---|---|---|
| R03 Send code | Invalid format | Inline error; button disabled |
| R03 Send code | Network/server error | Error toast + retry; input kept |
| R04 Verify | Wrong code | Inline error; field cleared |
| R04 Verify | Expired code | "Code expired — resend" |
| R05 | Terms not accepted | Continue disabled |

## 2. Rider — location permission (R06, R07, R08)

Location is requested when the rider engages pickup (not at launch). R06 has a **single "Continue" button** (Apple HIG: pre-permission screens must not offer a decline option that duplicates the system prompt). Manual pickup entry is offered on **Home and search** when permission is denied or restricted — not on R06.

```mermaid
flowchart TD
  H[Home R07] --> S{Permission status}
  S -- "Undetermined" --> P[Pre-permission R06: explanation + Continue]
  P -- "Continue" --> SYS[System prompt]
  SYS -- "Allow While Using, precise" --> G[Locate rider; show accuracy ±m]
  SYS -- "Allow, approximate" --> AP[Banner: location is approximate]
  SYS -- "Don't Allow" --> DN[Denied]
  S -- "Granted" --> G
  S -- "Denied" --> DN
  S -- "Restricted (parental/MDM)" --> RS[Restricted]
  AP --> TP{Temporary precise supported?}
  TP -- "Yes" --> TPR[Request temporary precise 'pickup'] --> PC
  TP -- "No / declined" --> PC[Confirm pickup pin on map]
  G --> PIN[Pickup pin set]
  PC --> PIN
  DN --> MAN[Home/search: 'Enter pickup manually' + 'Open Settings']
  RS --> MAN2[Home/search: manual entry only, no Settings link]
  MAN --> SR[Search R08: pickup field focused]
  MAN2 --> SR
  SR --> PIN
  PIN --> DEST[Where are you going? → R08]
```

| Outcome | UI | Booking possible? |
|---|---|---|
| Granted precise | Blue dot, accuracy label | Yes |
| Granted approximate | Approximate banner, pin confirmation required | Yes (after confirm) |
| Denied | Manual pickup; Settings link | Yes |
| Restricted | Manual pickup; explanation without Settings link | Yes |
| Location services off (device) | "Turn on Location Services" + manual entry | Yes |
| GPS timeout | "Couldn't find you" + retry + manual entry | Yes |

## 3. Rider — Quick Match: booking through rating

```mermaid
flowchart TD
  H[Home R07] --> SR[Search R08: destination]
  SR --> OP[Ride options R09: route, ETA, categories]
  OP --> Q{Quote}
  Q -- "Loading" --> OP
  Q -- "Error" --> QE[Error + retry]
  Q -- "Expired (5 min)" --> QR[Refresh price] --> OP
  OP -- "Select category, Quick Match, payment R10" --> WC{"Wallet covers fare + fee? (wallet only, BR-106)"}
  WC -- "No" --> TOP["Book blocked: Top up or pay by bank transfer"] --> OP
  WC -- "Yes / bank transfer" --> SUB[Book: submitting]
  SUB -- "Error" --> OP
  SUB --> SE[Searching R12]
  SE -- "Driver matched" --> M[Matched → Active trip R13: driver en route]
  SE -- "60 s timeout" --> ND[No drivers]
  ND -- "Retry" --> SE
  ND -- "Try Negotiate" --> NEG[Negotiate R11 — §4]
  ND -- "Cancel" --> H
  SE -- "Cancel (free)" --> H
  M -- "Driver arrived" --> AR[Driver arrived]
  AR -- "Driver confirms passenger + starts" --> IP[In progress]
  IP -- "Trip ends" --> PAY{Payment method}
  PAY -- "Wallet: charged automatically" --> RC[Receipt R15]
  PAY -- "Bank transfer" --> BT[Awaiting transfer R14 — §6]
  PAY -- "Wallet failure" --> PF[Payment failed R14 — §6]
  BT -- "Transfer confirmed" --> RC
  RC --> RT[Rate R16]
  RT -- "Submit / Skip" --> H
  M -- "Cancel" --> CX[Cancellation — §5]
  AR -- "Cancel" --> CX
```

## 4. Rider — Negotiate

```mermaid
flowchart TD
  OP[Ride options R09: Negotiate] --> CO[Compose offer R11: stepper, range hint]
  CO -- "Out of range / off step" --> CO
  CO -- "Send offer (round 1)" --> OO[Offer open: 90 s countdown]
  OO -- "Driver accepts / counters" --> RL[Response cards: 30 s each]
  RL -- "Response expires" --> RX[Card shown expired, not selectable] --> RL
  RL -- "Select response the wallet can't cover (wallet only)" --> WB["'Your wallet balance doesn't cover …. Top up first.'"] --> RL
  RL -- "Select live response" --> SEL{Server confirms?}
  SEL -- "Yes" --> MT[Matched: fare locked → R13]
  SEL -- "Driver unavailable" --> DU["'This driver is no longer available'"] --> RL
  OO -- "Raise offer (≤ max round)" --> OO2[New round: timer restarts] --> OO
  OO -- "90 s, no selection" --> EX[Offer expired]
  EX -- "Raise (rounds left)" --> OO2
  EX -- "Max rounds reached" --> MR[Raise disabled: explain]
  EX -- "Switch to Quick Match" --> QM{Quote valid?}
  MR -- "Switch to Quick Match" --> QM
  QM -- "Yes" --> SE[Searching R12]
  QM -- "No" --> RQ[Refresh quote R09] --> SE
  EX -- "Cancel" --> H[Home]
  MR -- "Cancel" --> H
  OO -- "Cancel (confirm)" --> H
```

| Situation | Rule | Behaviour |
|---|---|---|
| Offer below min / above max | BR-040 | Stepper clamps; typed value shows range message |
| Lowering an open offer | BR-048 | Decrement disabled below current offer |
| Counteroffer | BR-043 | Shown with amount and difference vs offer |
| Same driver responds again | BR-045 | Card replaced, not duplicated |
| Response expiry after offer expiry | Q-029 | Assumed selectable until its own `expiresAt` |
| Rounds | BR-049 | Max 3; round counter visible ("Round 2 of 3") |
| Back while offer open | FR-NEG-014 | "Cancel your offer?" confirmation |

## 5. Rider — cancellation (free vs fee)

Allowed from `quoted` through `driver_arrived`; not offered from `in_progress` onwards (`UI_STATES.md`).

```mermaid
flowchart TD
  C[Tap Cancel] --> S{Booking status}
  S -- "quoted / submitting / searching / negotiating" --> FREE[Dialog: Cancel ride? Free]
  S -- "matched / en route / arrived" --> W{"≤ 2 min since match AND driver waited < 5 min?"}
  W -- "Yes" --> FREE
  W -- "No" --> FEE["Dialog: Cancellation fee ₦500 (mock) applies"]
  FREE -- "Confirm + optional reason" --> DONE[Cancelled → Home]
  FEE -- "Confirm + optional reason" --> DONE2[Cancelled; fee charged per payment method] --> RCPT[Cancellation receipt]
  FREE -- "Keep ride" --> BACK[Return to previous screen]
  FEE -- "Keep ride" --> BACK
```

Driver-initiated cancellation after match: rider sees "Your driver cancelled" and is offered rematch (Quick Match) or cancel without fee (Q-030).

## 6. Rider — trip payment: wallet and bank transfer (R14)

*Revised 2026-10-21 (D-023): launch methods are GoBye Wallet and bank transfer; cards and cash removed from the flow (cash open, Q-001). Processing fees are shown as a separate line (BR-105). Bank-transfer details are simulated in this build ("GoBye Demo Bank", derived 10-digit number).*

```mermaid
flowchart TD
  TE[Trip completed by driver] --> M{Payment method}
  M -- "GoBye Wallet" --> CH["Charge wallet automatically (key bookingId-attempt)"]
  CH -- "Success" --> RC[Paid: 'You've arrived' → Continue → Rate]
  CH -- "Failure" --> PF["Payment didn't go through"]
  PF -- "Try again" --> CH
  PF -- "Use another method" --> PICK[Payment picker R10]
  M -- "Bank transfer" --> AW["Awaiting transfer: bank, account no., account name, exact amount (fare + fee)"]
  AW -- "I've sent the transfer" --> CK["Checking for your transfer…"]
  AW -- "Pay with GoBye Wallet instead" --> CH
  CK -- "Received (production: provider webhook)" --> RC
  CK -- "Not received yet" --> NR["Transfer not received yet"]
  NR -- "Check again" --> CK
  NR -- "Use another method" --> PICK
  PICK -- "Wallet" --> CH
  PICK -- "Bank transfer" --> AW
  AW -- "App killed" --> REC[Relaunch restores R14 in the same state — §7]
  CK -- "App killed" --> REC
  NR -- "Unresolved" --> OUT[Outstanding balance shown on Home; blocks next booking — assumption, Q-034]
```

*Superseded (pre-2026-10-21): "Charge card/wallet", "Choose another card", "Pay with cash → driver confirms cash".*

## 7. State recovery after app kill

```mermaid
flowchart TD
  L[Launch R01] --> T[Read session token]
  T -- "None" --> AUTH[Sign-in]
  T -- "Present" --> B[Read gobye.activeBooking]
  B -- "None" --> H[Home]
  B -- "Corrupt JSON" --> RST[Delete key; Home + notice]
  B -- "Valid" --> SYNC{"Production: GET /bookings/{id}"}
  SYNC -- "Server state differs" --> USE[Use server state]
  SYNC -- "Same / mock" --> LOC[Use local state]
  USE --> ROUTE
  LOC --> ROUTE{Status}
  ROUTE -- "quoted (quote expired?)" --> R09[R09 with refresh if expired]
  ROUTE -- "searching" --> R12[R12]
  ROUTE -- "negotiating" --> R11["R11; offer/response expiry derived from timestamps"]
  ROUTE -- "matched..in_progress" --> R13[R13]
  ROUTE -- "payment_pending" --> R14["R14 (awaiting transfer / checking / failed restored from awaitingPaymentAction + paymentAttempts)"]
  ROUTE -- "completed / cancelled" --> CLR[Delete key; Home]
```

`submitting` at kill time: on relaunch the client re-sends the create request with the **same idempotency key** (production) so the server returns the original booking or creates it once.

## 8. Rider — account deletion (R28)

```mermaid
flowchart TD
  A[Account R19 → Delete account R28] --> CHK{Active booking or balance?}
  CHK -- "Active trip" --> BLK[Blocked: finish or cancel trip first]
  CHK -- "Unpaid fare" --> OWE[Show amount; settle first or acknowledge — Q-016]
  CHK -- "Wallet balance" --> WB[Explain refund/forfeit policy — Q-016]
  CHK -- "None" --> INFO[What is deleted / retained and for how long]
  WB --> INFO
  OWE --> INFO
  INFO --> CONF[Type/confirm: Delete my account]
  CONF -- "Confirm" --> REQ["Request deletion (simulated)"] --> SO[Sign out; tokens + caches cleared]
  CONF -- "Cancel" --> A
```

---

## 9. Driver — onboarding & verification (D01–D08)

```mermaid
flowchart TD
  L[Launch D01] --> AU[Phone + OTP D02]
  AU --> ST{Verification status}
  ST -- "not_started" --> P[Personal details D03]
  P --> LI[Licence D04] --> ID[Identity D05] --> V[Vehicle info D06] --> DOC[Vehicle documents D07]
  DOC -- "Upload fails" --> DOC
  DOC -- "Submit" --> PR[pending_review D08]
  ST -- "in_progress" --> RES[Resume at last incomplete step]
  ST -- "pending_review" --> PR
  PR -- "Approved (admin)" --> APP[Approved → Dashboard D09]
  PR -- "Rejected + reason" --> RJ[Rejected D08: reason + Fix and resubmit]
  RJ --> RES
  ST -- "approved" --> APP
  APP -- "Document expires" --> EXP[Ineligible: renew document — BR-071]
  EXP --> RES
```

## 10. Driver — going online (D09, D10)

*Revised 2026-10-21 — D-026 (Q-012 resolved).* Going online requires eligibility, an **active access package** (BR-072) and **precise When In Use** location (BR-073). **"Always" is never requested automatically.** iOS keeps updating in the background because updates start in the foreground with `UIBackgroundModes: location` + `allowsBackgroundLocationUpdates`; Android uses a `location` foreground service started in the foreground (`ACCESS_BACKGROUND_LOCATION` only if device testing shows it is required). Logic: `driverLocationReducer` in `@gobye/core`; Driver UI not yet built.

```mermaid
flowchart TD
  D[Dashboard D09: toggle Online] --> E{Eligible? approved, docs valid}
  E -- "No" --> NE[Explain why + link to documents/status]
  E -- "Yes" --> AC{Active access package?}
  AC -- "No" --> BUY["Buy Daily ₦2,000 / Monthly ₦60,000 (provisional)"]
  BUY -- "Purchased" --> FG
  BUY -- "Not now" --> STAYOFF[Stay offline]
  AC -- "Yes" --> FG{Foreground location?}
  FG -- "Undetermined" --> EX[D10 explanation: only while online, stops when offline → Continue]
  EX --> FGP[System prompt: When In Use / While using the app]
  FG -- "Denied / restricted" --> FGD[Explain + Open Settings; stay offline]
  FGP -- "Deny" --> FGD
  FGP -- "Allow" --> PR{Precise?}
  FG -- "Granted" --> PR
  PR -- "Approximate only" --> PRD["'Turn on Precise Location' + Open Settings; stay offline"]
  PR -- "Precise" --> ON["Online (available): session started in foreground; iOS blue indicator in background; Android 'You're online' notification"]
  ON -- "Toggle Offline (no active trip)" --> OFF[Offline: session stopped, task unregistered]
  ON -- "Toggle Offline during trip" --> FT["'Finish the trip first'"]
  ON -- "Permission revoked / precise off / interrupted / stale / weak GPS" --> PAUSE["New requests paused + reason shown; active trip continues"]
  PAUSE -- "Issue fixed (fix received / session resumed)" --> ON
  ON -- "Access package expires" --> EXPD["Cannot receive new requests; buy package (mid-trip behaviour Q-043)"]
```

*Superseded (pre-2026-10-21): D10 → system prompt "Always / Allow all the time"; declined → "foreground-only or blocked (per Q-012)".*

## 11. Driver — receiving requests (D11, D12)

```mermaid
flowchart TD
  ON[Online idle] --> RQ{Request type}
  RQ -- "Quick Match" --> QM[D11: pickup, destination, distance, fare, estimated earnings, countdown]
  QM -- "Accept" --> AS{Server assigns?}
  AS -- "Yes" --> TRIP[Trip D13]
  AS -- "Taken by another driver" --> GONE[Request no longer available] --> ON
  QM -- "Decline / timeout" --> ON
  RQ -- "Negotiation" --> NG[D12: passenger offer, suggested fare, range, countdown]
  NG -- "Accept at offer" --> WAIT[Response live 30 s: waiting for passenger]
  NG -- "Counter (offer ≤ x ≤ max)" --> WAIT
  NG -- "Decline / offer expires" --> ON
  WAIT -- "Passenger selects me" --> TRIP
  WAIT -- "Passenger selects another / response expires / offer withdrawn" --> ON
  WAIT -- "Update counter" --> WAIT
```

## 12. Driver — trip lifecycle (D13, D14)

```mermaid
flowchart TD
  A[Assigned: navigate to pickup] -- "Arrived" --> AR[Arrived: wait timer visible]
  AR -- "Confirm passenger name" --> CP[Passenger confirmed]
  CP -- "Start trip" --> IP[In progress: navigate to destination]
  IP -- "Complete trip" --> CMP[Trip complete D14]
  CMP -- "Cash (only if approved, Q-001)" --> CASH[Collect ₦X → confirm received]
  CMP -- "Wallet / bank transfer" --> DIG{Payment result}
  DIG -- "Paid" --> EARN["Estimated earnings shown (full fare, 0% commission)"]
  DIG -- "Awaiting transfer / failed" --> PEND[Payment pending: rider resolving]
  CASH --> EARN
  PEND -- "Rider pays / switches to wallet" --> EARN
  EARN --> ON[Back online — available (driver stays online until they go offline)]
  A -- "Cancel (reason + reliability warning)" --> ON
  AR -- "Rider no-show after wait → cancel" --> ON
  AR -- "Rider cancels" --> ON
```

## 13. Driver — payouts (D15)

```mermaid
flowchart TD
  E[Earnings D15] --> BAL[Balance: settled vs estimated]
  BAL --> BANK{Payout bank account set?}
  BANK -- "No" --> ADD[Add bank account: verify name — backend] --> BAL
  BANK -- "Yes" --> SCH["Automatic payout schedule or Request payout (policy Q-031)"]
  SCH --> PS{Payout status}
  PS -- "Processing" --> PS
  PS -- "Paid" --> HIST[Payout history]
  PS -- "Failed" --> FIX[Show reason; update bank details / retry]
```

Cash trips: commission owed to the platform is netted against digital earnings or shown as balance due (Q-034). *(Superseded 2026-10-21: commission is 0% (D-024) and cash is not a launch method (D-023). Drivers pay for access packages instead — billing method Q-043.)*
