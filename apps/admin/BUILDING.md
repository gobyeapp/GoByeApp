# Building GoBye Management screens

Conventions for every workspace screen in `apps/admin`. Read this before adding or changing a page.

## What this app is

The staff web app for GoBye: one platform, separate workspaces per team, all reading the **same records**
(shared ids). The backend does not exist yet, so the app runs on a deterministic **test dataset**
(`createPlatformDataset()` in `packages/core/src/platform/mockPlatform.ts`) with simulated latency and
optional simulated failures. Every screen must be honest about that: never imply a real provider,
real money or real people.

## Files you may and may not touch

- Your workspace folder under `src/workspaces/<area>/` is yours. Each page file default-exports one component.
- Put pure logic (filters, derived numbers, validation, transition helpers) in a `logic.ts` next to your
  pages and test it in `logic.test.ts` (Vitest: `import { describe, it, expect } from 'vitest'`).
- **Do not edit** shared files: `src/data/*`, `src/ui/*`, `src/nav.tsx`, `src/App.tsx`, `src/styles.css`,
  anything in `packages/`. If you need something shared, write a local helper in your folder and say so
  in your final report.

## Data

```ts
import { useData, usePlatform, useAction } from '@/data/store';
const d = useData();                 // PlatformDataset: staff, passengers, drivers, trips, cases, ledger, collections,
                                     // withdrawals, refunds, settlements, integrations, configVersions, campaigns,
                                     // announcements, approvals, events, audit
const { now } = usePlatform();       // prototype clock (ms). Use now(), not Date.now().
const act = useAction();             // run a change: await act({ label, apply, audit }, 'Success toast')
```

Changes go **only** through `act(spec)`:

```ts
const r = await act({
  label: 'Approve driver',
  apply: (draft, { now, actor }) => {
    const x = draft.drivers.find((d) => d.id === id);
    if (!x) return { ok: false, error: 'Driver not found' };
    if (!canTransition(VERIFICATION_FLOW, x.verification, 'approved')) return { ok: false, error: 'Can’t approve from this state' };
    x.verification = 'approved';
    return { ok: true };
  },
  audit: () => ({ action: 'driver.approved', target: { type: 'driver', id, label: name }, summary: `Approved ${name}` }),
}, 'Driver approved');
if (r.ok) closeDrawer();
```

- `apply` mutates a **draft copy**; returning `{ ok: false }` keeps the old data (so failed actions preserve context).
- Every real change has an `audit` entry. Corrections and destructive actions need a reason (use `ConfirmDialog requireReason`).
- Money: integer kobo (`Kobo`) everywhere; format with `money()` / `signedMoney()` from `@/data/format`.
  Never edit a balance: post ledger journals with the helpers in `@gobye/core` (`postJournal`,
  `reverseJournal`, `reserveWithdrawal`, `settleWithdrawal`, `releaseWithdrawal`, `creditWalletFunding`).
- Status changes must be allowed by the tables in `packages/core/src/platform/workflows.ts` (`canTransition`, `nextStatuses`).
- Sensitive actions follow `APPROVAL_RULES` / `needsApproval` / `canDecide` (`packages/core/src/platform/approvals.ts`):
  create an `ApprovalRequest` in `draft.approvals` instead of applying the change directly, and nobody approves their own request.

## Permissions and scope

```ts
import { useSession, useScopedFilter, useFilters } from '@/data/session';
const { can, staff, inScope } = useSession();     // can('refunds.approve')
const keep = useScopedFilter();                   // keep(row.city, row.at, now()) → global city + date filter + staff city scope
```

- Hide actions the role can't take; where knowing an action exists helps, show it disabled with a reason
  (`<Button disabledReason="Needs finance approval">`).
- Contact details need `passengers.contact_details` / `drivers.contact_details`; safety location needs
  `safety.location`; money needs `finance.view` or `ledger.view`. The auditor is read only.

## Shared records

```ts
import { RecordLink, useOpenRecord, TRIP_STATUS, PAYMENT_STATE } from '@/data/records';
<RecordLink type="trip" id={t.id}>{t.ref}</RecordLink>      // opens the shared trip/passenger/driver panel
```

Always link to trips, passengers and drivers this way, so the same record opens from every workspace.

## UI

Use `@/ui/kit`: `PageHead`, `Section`, `Card`, `Stat`, `Pill` (status = icon + label), `Button` (shows its own
progress for async onClick and blocks double clicks), `IconButton`, `Notice`, `Empty`, `Skeleton`,
`ErrorState`, `Table` (+ `Column<T>`), `SearchInput`, `Select`, `Segmented`, `Tabs`, `Field`, `KV`,
`Timeline`, `Drawer`, `ConfirmDialog`, `Bars`, `Meter`. Icons: `<Icon name="…" />` from `@/ui/Icon` (see
`ICON_NAMES`). Layout classes in `styles.css`: `grid cols-2|3|4`, `split`, `row`, `stack`, `toolbar`,
`muted`, `small`, `strong`, `num`. Inline styles only for one-off spacing.

Every list/record screen covers: **loading** (the shell handles first load; use `Skeleton` for anything
you load yourself), **empty** (`Empty` with what to do next), **pending** (in-progress statuses shown as
pills, actions disabled while pending), **error** (actions return `{ ok: false, error }`; the toast shows
it and the drawer stays open), **success** (toast + updated record + audit entry).

## Copy

Short, plain, sentence case. **No hyphens or dashes in visible text** (write "re-check" as "check again",
"e-mail" as "email"; ranges as "to"). No exclamation marks. Name statuses exactly as the workflow
tables do (`label()` from `@/data/format` turns `under_review` into "Under review").
Payment provider capability must never be shown as live: integrations are `prototype | configured |
tested | live | degraded`, and nothing in the test data is live.

## Checks before you finish

From `apps/admin`: `npx tsc --noEmit` (fix errors in your files) and `npx vitest run src/workspaces/<area>`.
