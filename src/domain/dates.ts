/**
 * ISO-8601 date-time validation at the MCP boundary.
 *
 * Per ADR-0007, every date or timestamp crossing the MCP boundary is an
 * ISO-8601 string with an explicit offset — either UTC (`Z`) or `±HH:MM`.
 * Bare local time (`2026-04-19T12:00:00`) is rejected: it's ambiguous and
 * silently guessing a zone leads to off-by-hours bugs at DST boundaries.
 *
 * Why a zod helper rather than a plain regex:
 *
 * - Composes into larger domain schemas via `isoDateString()` returning
 *   a `ZodString` that other schemas can `.optional()`, `.nullable()`, etc.
 * - Produces a `ValidationError`-compatible issue when it fails.
 * - Sanity-checks the date actually parses (reject impossible dates like
 *   `2026-02-31T00:00:00Z` that the regex alone would accept).
 *
 * @see DESIGN.md §14 — date & time handling
 * @see docs/adr/0007-dates-iso8601-with-offset.md — decision record
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Relative date shortcuts
// ---------------------------------------------------------------------------

/**
 * Human-friendly date shortcut accepted anywhere an ISO-8601 date is valid.
 * Resolved server-side to a midnight timestamp in the server's local timezone.
 * See DESIGN.md §14 — Relative date shortcuts.
 */
export type RelativeDateShortcut =
  | "today"
  | "tomorrow"
  | "yesterday"
  | "this-week"
  | "next-week"
  | "end-of-week"
  | "end-of-month";

const RELATIVE_SHORTCUTS = new Set<string>([
  "today",
  "tomorrow",
  "yesterday",
  "this-week",
  "next-week",
  "end-of-week",
  "end-of-month",
]);

/** Type guard for relative date shortcuts. */
export function isRelativeDateShortcut(value: unknown): value is RelativeDateShortcut {
  return typeof value === "string" && RELATIVE_SHORTCUTS.has(value);
}

/** Build an ISO-8601 string with local offset for the start of the given Date's day. */
function localMidnightIso(date: Date): string {
  const offset = -date.getTimezoneOffset(); // minutes east of UTC
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mo}-${dd}T00:00:00${sign}${hh}:${mm}`;
}

/**
 * Resolve a relative date shortcut to an ISO-8601 string with offset.
 * All shortcuts resolve to midnight (00:00:00) at the start of the target day
 * in the server's local timezone. Accepts an optional `now` for testability.
 */
export function resolveRelativeDate(
  shortcut: RelativeDateShortcut,
  now: Date = new Date(),
): string {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  switch (shortcut) {
    case "today":
      return localMidnightIso(base);
    case "tomorrow": {
      const d = new Date(base);
      d.setDate(d.getDate() + 1);
      return localMidnightIso(d);
    }
    case "yesterday": {
      const d = new Date(base);
      d.setDate(d.getDate() - 1);
      return localMidnightIso(d);
    }
    case "this-week": {
      const d = new Date(base);
      const day = d.getDay(); // 0=Sun
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); // back to Monday
      return localMidnightIso(d);
    }
    case "next-week": {
      const d = new Date(base);
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day)); // forward to next Monday
      return localMidnightIso(d);
    }
    case "end-of-week": {
      const d = new Date(base);
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? 0 : 7 - day)); // forward to Sunday
      return localMidnightIso(d);
    }
    case "end-of-month": {
      const d = new Date(base);
      d.setMonth(d.getMonth() + 1, 0); // day 0 of next month = last day of this month
      return localMidnightIso(d);
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/**
 * ISO-8601 timestamp with required offset.
 *
 * Accepts:
 * - `YYYY-MM-DDTHH:MM:SS` followed by `Z` or `±HH:MM`
 * - Optional fractional seconds: `.sss` up to nine digits
 *
 * Rejects:
 * - Bare local time (no offset)
 * - Date-only strings (`2026-04-19`)
 * - Space separator (`2026-04-19 12:00:00Z` — must be `T`)
 * - Non-ISO formats
 */
export const ISO_8601_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Predicate returning true if the input is an ISO-8601 string with offset. */
export function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_8601_WITH_OFFSET.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

// ---------------------------------------------------------------------------
// Zod helper
// ---------------------------------------------------------------------------

/** Output type of the `isoDateString()` schema. */
export type IsoDateString = string;

/**
 * Return a zod schema that validates an ISO-8601 timestamp with required
 * offset. Use in tool input schemas wherever a date is accepted.
 *
 * @example
 *   const taskCreate = z.object({
 *     name: z.string(),
 *     dueDate: isoDateString().optional(),
 *     deferDate: isoDateString().nullable().optional(),
 *   });
 *
 * The schema rejects:
 * - Bare local time — with a suggestion to add an offset
 * - Well-formed strings whose values aren't valid dates (e.g. month 13)
 * - Non-string inputs (via zod's built-in coercion rules)
 *
 * Note: JavaScript's `Date.parse` silently normalizes some out-of-range
 * day values (e.g. `2026-02-31` → March 3). The refinement here only
 * catches what `Date.parse` itself rejects (month > 12, hour > 23, etc.).
 * Stricter day-of-month validation belongs in the adapter if needed.
 */
export function isoDateString() {
  return z
    .string()
    .regex(
      ISO_8601_WITH_OFFSET,
      "Expected ISO-8601 with offset (e.g. 2026-04-19T12:00:00-05:00 or 2026-04-19T17:00:00Z). Bare local time is rejected.",
    )
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "Well-formed ISO-8601 but not a valid date (out-of-range month, hour, or minute).",
    });
}

/**
 * Accepts either an ISO-8601 string with offset or a relative date shortcut
 * (`today`, `tomorrow`, `yesterday`, `this-week`, `next-week`, `end-of-week`,
 * `end-of-month`). Shortcuts resolve to midnight in the server's local timezone.
 *
 * Use this instead of `isoDateString()` for filter params and task date fields
 * where natural language shortcuts improve agent ergonomics.
 *
 * @example
 *   const taskListFilters = z.object({
 *     dueBefore: flexDateString().optional(),
 *     deferAfter: flexDateString().nullable().optional(),
 *   });
 *   // agent can pass: { dueBefore: "tomorrow" } or { dueBefore: "2026-04-22T00:00:00-05:00" }
 */
export function flexDateString() {
  return z.string().transform((val, ctx): string => {
    if (isIsoDateString(val)) return val;
    if (isRelativeDateShortcut(val)) return resolveRelativeDate(val);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected ISO-8601 with offset or a relative shortcut (today, tomorrow, yesterday, this-week, next-week, end-of-week, end-of-month). Got: "${val}".`,
    });
    return z.NEVER;
  });
}
