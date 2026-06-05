---
id: "2026-06-02-normalize-due-date-parsing"
status: "done"
priority: "high"
assignee: null
epic: "Reliability"
dueDate: null
created: "2026-06-02T19:23:22.735Z"
modified: "2026-06-03T05:18:41.877Z"
completedAt: null
labels: ["bug", "timezone", "dates"]
order: "a0"
---
# Normalize due date parsing

## User story

As a user, I want due-date filtering and badges to behave consistently across timezones so cards are not misclassified as overdue, today, or this week.

## Current state (problem description)

Due dates are stored as bare `YYYY-MM-DD` strings (e.g. `"2026-06-15"`) in frontmatter. There is no shared date helper. Three independent code paths parse and compare these strings, and two of the three are broken for users in non-UTC timezones.

### Parsing path 1 — store filter (`src/webview/store/index.ts`, line 225)

```ts
const dueDate = new Date(f.dueDate)   // "2026-06-15" → UTC midnight
```

`new Date("2026-06-15")` is specified by ECMAScript to produce **UTC midnight** (00:00:00Z). In a UTC-5 timezone this resolves to 2026-06-14T19:00:00 local time — i.e. the previous calendar day.

The three comparator functions in the same file are inconsistent with each other:

- `isOverdue` (line 84–88): sets `today` to **local midnight** via `today.setHours(0, 0, 0, 0)`, then compares `date < today`. Because `date` is UTC midnight, a card due "today" in UTC-5 has `date` = June 14 19:00 local, which is before local midnight June 15, so it is incorrectly marked overdue.
- `isToday` (line 63–69): compares year/month/day fields of `date` against `new Date()`. Because `date` is UTC midnight, in UTC-5 `date.getDate()` returns 14 (the previous day), so a card due "today" is never matched by the today filter.
- `isThisWeek` (line 72–82): computes `startOfWeek` as **local midnight** but compares against `date` which is **UTC midnight**. This produces a one-day offset at week boundaries in non-UTC timezones.

### Parsing path 2 — card badge (`src/webview/components/FeatureCard.tsx`, lines 51–54)

```ts
const date = new Date(dateStr)          // UTC midnight (same flaw)
const now = new Date()                  // current instant
const diff = date.getTime() - now.getTime()
const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
```

This computes a fractional day difference between a UTC-midnight anchor and the current instant, then uses `Math.ceil`. The result is correct only at exact UTC midnight. At any other time of day the `days` value is off by a fractional amount that can shift `days === 0` ("today") into `days < 0` ("overdue") or `days === 1` ("tomorrow"). In UTC-5 this window is 19 hours wide (from 19:00 local to UTC midnight the following day).

Additionally, this path uses **different logic** from the store: the store uses `isToday`/`isOverdue` predicates, but the card badge uses a raw millisecond diff. A card can be "overdue" on the badge while passing the "today" filter, or vice versa.

### Parsing path 3 — DatePicker display (`src/webview/components/DatePicker.tsx`, lines 26 and 58)

```ts
const selected = value ? new Date(value + 'T00:00:00') : null   // local midnight — correct
const d = new Date(dateStr + 'T00:00:00')                        // local midnight — correct
```

The DatePicker is the **only** path that appends `T00:00:00` to force local midnight. This is the correct pattern and should be adopted by the other two paths.

### No existing tests

There are no test files under `src/`. All date logic is currently untested.

## Affected files

FileLinesChange needed`src/webview/store/index.ts`225`new Date(f.dueDate)` → `parseDueDateLocal(f.dueDate)src/webview/store/index.ts`63–88Replace `isToday`, `isThisWeek`, `isOverdue` with imports from shared helper`src/webview/components/FeatureCard.tsx`51–54Replace millisecond-diff logic with calls to same shared helper predicates`src/shared/`—**New file** `dateUtils.ts` — see implementation notes

Files that are **not** affected:

- `src/shared/featureFrontmatter.ts` — passes `dueDate` as a raw string, no parsing needed
- `src/extension/KanbanPanel.ts` — passes `dueDate` as a raw string, no parsing needed
- `src/extension/FeatureHeaderProvider.ts` — passes `dueDate` as a raw string, no parsing needed
- `src/webview/components/DatePicker.tsx` — already uses `T00:00:00` suffix; no change needed

## Acceptance criteria

1. **Parsing consistency**: `new Date(f.dueDate)` is never called directly in store or card code; all callers use `parseDueDateLocal(dateStr)`.

2. **isOverdue correctness**: A card with `dueDate = <yesterday's YYYY-MM-DD>` returns `true` from `isOverdue` at any time of day, in UTC-5, UTC, and UTC+9. A card with `dueDate = <today's YYYY-MM-DD>` returns `false`.

3. **isToday correctness**: A card with `dueDate = <today's YYYY-MM-DD>` returns `true` from `isToday` at any time of day in UTC-5, UTC, and UTC+9.

4. **isThisWeek correctness**: A card due on Sunday (last day of week) returns `true` for `isThisWeek` when checked on Sunday at 23:59 local time in UTC-5.

5. **Card badge matches filter**: A card that passes the store's `'overdue'` filter always renders with the "overdue" badge text; a card that passes `'today'` always renders with the "today" badge text. There is no card state where the badge and filter disagree.

6. **Invalid/null dates do not throw**: `parseDueDateLocal(null)` returns `null`. `parseDueDateLocal("")` returns `null`. `parseDueDateLocal("not-a-date")` returns `null` (or `Invalid Date` is treated as null by callers — document which).

7. **Tests exist**: A new test file (e.g. `src/shared/dateUtils.test.ts`) covers all six of the above scenarios with at least one assertion per timezone offset (UTC-5, UTC, UTC+9) for the boundary cases.

## Implementation notes

### Proposed helper (`src/shared/dateUtils.ts`)

```ts
/**
 * Parse a YYYY-MM-DD due-date string to a Date at local midnight.
 * Returns null for null, empty string, or unparseable input.
 */
export function parseDueDateLocal(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

/** True if date is before today's local midnight (i.e. strictly in the past). */
export function isOverdue(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

/** True if date falls on today's local calendar date. */
export function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

/**
 * True if date falls within the current Sunday-to-Saturday week (local time).
 * startOfWeek = Sunday 00:00:00 local; endOfWeek = next Sunday 00:00:00 local.
 */
export function isThisWeek(date: Date): boolean {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  return date >= startOfWeek && date < endOfWeek
}
```

The `isToday`, `isThisWeek`, and `isOverdue` bodies are already correct in the current store — the only fix needed there is making `date` a local-midnight Date rather than a UTC-midnight Date. The card badge in `FeatureCard.tsx` should be rewritten to call these predicates instead of computing a millisecond diff.

### Card badge rewrite guidance

The card badge currently uses a raw `days` integer to produce "overdue / today / tomorrow / N days" labels. After the fix, the logic should be:

1. `parseDueDateLocal(dateStr)` — get a local-midnight Date (or return null)
2. Call `isOverdue(date)` / `isToday(date)` for the first two branches
3. For "tomorrow" and "N days": compare against tomorrow's local midnight (`new Date()` with `setHours(0,0,0,0)` then `+1 day`) to avoid the fractional-diff issue

### Testing approach

Because the helpers are pure functions, they can be tested with Vitest (already a dev dependency via the webview build) by mocking `Date` or by passing fixed dates. Use `@sinonjs/fake-timers` or Vitest's `vi.setSystemTime` to simulate different local offsets is not straightforward in Node; instead, parameterize tests by constructing input Dates directly at the expected local-midnight values.

## Definition of done

- \[ \] `src/shared/dateUtils.ts` created with the four exported functions
- \[ \] `src/webview/store/index.ts` local helpers removed; imports from `dateUtils`; `new Date(f.dueDate)` replaced with `parseDueDateLocal`
- \[ \] `src/webview/components/FeatureCard.tsx` `formatDueDate` rewritten using `parseDueDateLocal` + predicate functions
- \[ \] `src/shared/dateUtils.test.ts` created with tests covering ACs 2–6 above
- \[ \] Manual smoke test: open the board in a browser devtools with timezone override to UTC-5; set a card due date to today; verify it shows "today" badge and appears in the "today" filter, not "overdue"