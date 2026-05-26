# Date and timezone handling

> Living contract for how dates, times, and timezones flow through the
> server. Read this before adding a new date field or touching the
> forecast / scheduling surface.
>
> Filed under [#833](https://github.com/torsday/omnifocus-mcp/issues/833).

## TL;DR

- **Wire format is ISO-8601 with an explicit offset.** Every date that
  crosses a tool boundary serializes as
  `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC) or `YYYY-MM-DDTHH:mm:ss±HH:MM`. The
  server emits UTC by default; the client may send either form.
- **Date-only fields (no time component) are a smell.** OF stores
  every date with a wall-clock instant; "due 2026-05-26" without an
  hour is ambiguous between TZs. Where we expose a date-only token
  (e.g. `byDate[].date`), the doc below names the intended TZ.
- **The server's process TZ is assumed to be the user's TZ.** This
  is the working assumption today. Long-term fix: accept a `tz`
  parameter at the tool boundary or read the OS-default-locale TZ at
  startup. Until then, deploying the server in a TZ different from
  the user's OmniFocus instance will produce off-by-N-hours drift.

## Boundary-by-boundary contract

```
Client ──ISO/offset──▶ TS tool layer ──Date──▶ JXA bridge ──osascript──▶ OmniFocus
                                                                              │
Client ◀──ISO/UTC──── TS tool layer ◀──Date──── JXA bridge ◀──osascript──────┘
```

### 1. Client → TS tool layer

| Field shape           | Accepted input                                              | Validation                                    |
|-----------------------|-------------------------------------------------------------|-----------------------------------------------|
| Datetime              | `2026-05-26T17:00:00-07:00` or `2026-05-27T00:00:00Z`       | Zod `z.string().datetime({ offset: true })`   |
| Date-only             | `2026-05-26`                                                | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`      |
| Relative              | `today`, `tomorrow`, `+3d`, `-1w`                           | `isRelativeDateShortcut()` in `forecast/get.ts` |

Tools that accept a `date` shorthand (`forecast_get`, `forecast_pack`)
resolve relative shortcuts against the **server's local clock**. A
client in PT calling `forecast_get { date: "today" }` against a
server in UTC may get the previous day's forecast for late-evening
calls — known drift, see [#1035](https://github.com/torsday/omnifocus-mcp/issues/1035).

### 2. TS layer → JXA bridge

The TS layer constructs `new Date(isoString)` and hands it to the JXA
runner. JavaScriptCore inside `osascript` accepts the same `Date`
shape; serialization across the bridge uses ECMAScript's default
`toJSON()` (UTC ISO).

### 3. JXA → OmniFocus

OmniFocus stores every date as a wall-clock instant in the OS's
default TZ. JXA accessors (`task.dueDate()`, `task.deferDate()`,
`task.completionDate()`) return a JXA `Date` in the OS-default TZ.
`toISOString()` normalizes that to UTC on the way out, so the
boundary is symmetric.

**Date-only fields** (review intervals, planned date) are stored as
midnight local. The JXA runner returns them as a `Date` at
`00:00:00` in the OS TZ — which `toISOString()` shifts by the offset.
A repetition with `period: 7` days, scheduled on 2026-05-26 from
PT, comes back as `2026-05-26T07:00:00Z` over the wire, which is
correct as a wall-clock instant but **not** as a "day-of-month"
token.

### 4. Server response → Client

Every date in a successful envelope is the UTC ISO (`Z` suffix). The
client must convert to its display TZ. The token-cost benchmark's
canonical workflows assume this.

## Known drift inventory

Issues from the #833 audit and their resolution:

- **[#1035](https://github.com/torsday/omnifocus-mcp/issues/1035)** —
  `forecast_get`'s `byDate[].date` keys were derived via UTC-day
  slicing; tasks at 11pm PT bucketed into the wrong calendar day.
  **Fixed** by `localDayKey(iso, tz?)` in `forecast/get.ts` using
  `Intl.DateTimeFormat`.
- **[#1036](https://github.com/torsday/omnifocus-mcp/issues/1036)** —
  `resolveAnchorDate` used host-local `setHours` for start-of-day.
  **Fixed** by `startOfDayInTz(ymd, tz)` + an optional `tz`
  parameter on `resolveAnchorDate`.
- **[#1037](https://github.com/torsday/omnifocus-mcp/issues/1037)** —
  cross-TZ + DST test matrix (server-UTC × user-PT, Tokyo, spring-
  forward, fall-back). **Landed** in `src/tools/forecast/get.tz.test.ts`
  with 17 assertions. Future drift in the three helpers above gets
  caught at the unit-test level.

## What "correct" looks like

The end-state #833 contemplates:

- Every wire date carries an explicit offset (already true on
  emission; the client may send naive ISO, which is a smell — see
  the validation column above).
- Date-only tokens (`byDate[].date`, `dueDate` when only the day
  matters) carry a documented TZ assumption.
- A `tz` parameter at the tool boundary, when supplied, overrides the
  server-local assumption. (Not yet implemented — would close
  #1035 / #1036 fully.)
- The test matrix in #1037 exercises every cross-TZ combination
  that production has hit; new date fields default to "covered by
  this matrix."

## See also

- `src/tools/forecast/get.ts` — primary date-handling surface,
  including `resolveRange`, `resolveAnchorDate`, `groupByDate`.
- `src/scripts/jxa/_helpers/build_task.js` — date accessors at the
  JXA boundary (`dueDate.toISOString()`, etc.).
- ADR-0008 — input validation contract (where the regex above is
  documented).
