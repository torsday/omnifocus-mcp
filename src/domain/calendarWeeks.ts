/**
 * Calendar-week boundary helpers shared by analytics resources.
 *
 * All helpers use **ISO-8601 weeks** — weeks start on Monday, end on Sunday.
 * "Week start" is the Monday at 00:00:00.000 local time.
 *
 * Rationale for Monday-start: OmniFocus defaults to Monday-start in its
 * Forecast week view; using the same boundary keeps velocity numbers
 * interpretable alongside what the user sees in the app.
 *
 * @see src/resources/velocity.ts — primary consumer
 * @see src/resources/burndown.ts — uses weekStart for progress tracking
 */

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Return the Monday (start) of the ISO week that contains `date`.
 * Time is set to 00:00:00.000 in **local** time (matching OmniFocus's
 * own date interpretation).
 */
export function isoWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // JS getDay(): 0=Sun, 1=Mon, …, 6=Sat
  const day = d.getDay();
  // days to subtract to reach the preceding Monday (Sunday → 6 days back)
  const delta = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - delta);
  return d;
}

/**
 * Return the exclusive end of the week starting at `weekStartDate`
 * (i.e. the Monday one week later, at 00:00:00.000 local).
 */
export function isoWeekEnd(weekStartDate: Date): Date {
  const d = new Date(weekStartDate);
  d.setDate(d.getDate() + 7);
  return d;
}

/**
 * Return the [from, to) bounds for the week containing `date`.
 * `from` is inclusive (Monday 00:00), `to` is exclusive (next Monday 00:00).
 */
export function weekBounds(date: Date): { from: Date; to: Date } {
  const from = isoWeekStart(date);
  return { from, to: isoWeekEnd(from) };
}

// ---------------------------------------------------------------------------
// Multi-week range
// ---------------------------------------------------------------------------

/**
 * Return an array of `n` consecutive week-start `Date`s ending with the
 * week that contains `now`, in **chronological order** (oldest first).
 *
 * @example
 *   trailingWeekStarts(3, new Date("2026-04-27")) // Mon 2026-04-06, -13, -20, -27 — wait, n=3
 *   // → [Mon 2026-04-13, Mon 2026-04-20, Mon 2026-04-27]
 */
export function trailingWeekStarts(n: number, now: Date = new Date()): Date[] {
  const currentWeekStart = isoWeekStart(now);
  const result: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - i * 7);
    result.push(d);
  }
  return result;
}
