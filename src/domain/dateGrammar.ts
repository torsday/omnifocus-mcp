/**
 * Intent-bearing defer-date grammar for `task_defer_smart` (per #479).
 *
 * Resolves a high-level intent ("next work morning", "skip weekends",
 * "in 3 business days") to a concrete ISO-8601-with-offset timestamp,
 * encoding the *why* of a defer so agents stop landing tasks on weekends
 * and 11pm slots.
 *
 * Pure — no I/O, no side effects. Tests inject `now` so weekend/holiday
 * edge cases are deterministic. Caller-supplied `morningHour` /
 * `afternoonHour` come from env (`OMNIFOCUS_MORNING_HOUR`,
 * `OMNIFOCUS_AFTERNOON_HOUR`); the tool wrapper reads them once at
 * registration and passes them in.
 *
 * Output is local-zone ISO-8601 with explicit `±HH:MM` offset per
 * ADR-0007 — bare local time is rejected at the MCP boundary.
 *
 * @see src/tools/task/deferSmart.ts — the calling tool
 * @see src/domain/dates.ts — boundary date validation
 */

import { CalendarBridgeUnavailable, ValidationError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TimeOfDay = "morning" | "afternoon";

/** Discriminated union — one variant per intent. */
export type DeferIntent =
  | { kind: "next-work-day"; at?: TimeOfDay }
  | { kind: "next-weekday"; weekday: number; at?: TimeOfDay }
  | { kind: "in-business-days"; days: number }
  | { kind: "after-event"; eventId: string }
  | { kind: "next-month-start" }
  | { kind: "explicit-with-skip-weekends"; date: string };

export interface ResolveOptions {
  /** Fixed reference moment — caller supplies for testability. */
  now: Date;
  /** Hour-of-day used when `at: "morning"` (24-hour clock, local zone). */
  morningHour: number;
  /** Hour-of-day used when `at: "afternoon"` (24-hour clock, local zone). */
  afternoonHour: number;
}

export interface ResolvedDefer {
  /** ISO-8601 with `±HH:MM` offset. Server-local zone. */
  resolvedDeferDate: string;
  /** Human-readable explanation, e.g. "next work morning (Mon 09:00)". */
  reason: string;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Resolve an intent to a concrete defer date.
 *
 * @throws ValidationError when the intent is malformed (e.g. weekday out of range)
 * @throws CalendarBridgeUnavailable for the `after-event` variant — this slice
 *   does not implement event-time lookup; the typed error tells the agent the
 *   feature is gated behind a future change rather than a bug.
 */
export function resolveDeferIntent(intent: DeferIntent, opts: ResolveOptions): ResolvedDefer {
  switch (intent.kind) {
    case "next-work-day":
      return resolveNextWorkDay(intent.at ?? "morning", opts);
    case "next-weekday":
      return resolveNextWeekday(intent.weekday, intent.at ?? "morning", opts);
    case "in-business-days":
      return resolveInBusinessDays(intent.days, opts);
    case "after-event":
      throw new CalendarBridgeUnavailable(
        "task_defer_smart `after-event` variant is not yet implemented — file a follow-up if you need calendar-event-anchored defers.",
      );
    case "next-month-start":
      return resolveNextMonthStart(opts);
    case "explicit-with-skip-weekends":
      return resolveExplicitSkipWeekends(intent.date, opts);
  }
}

// ---------------------------------------------------------------------------
// Variant resolvers
// ---------------------------------------------------------------------------

function resolveNextWorkDay(at: TimeOfDay, opts: ResolveOptions): ResolvedDefer {
  const target = new Date(opts.now);
  target.setDate(target.getDate() + 1);
  while (isWeekend(target)) target.setDate(target.getDate() + 1);
  setLocalHour(target, hourFor(at, opts));
  return {
    resolvedDeferDate: toIsoWithOffset(target),
    reason: `next work ${at} (${DAY_NAMES[target.getDay()]} ${formatTime(target)})`,
  };
}

function resolveNextWeekday(weekday: number, at: TimeOfDay, opts: ResolveOptions): ResolvedDefer {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new ValidationError(`weekday must be an integer 0–6 (Sun–Sat); got ${String(weekday)}`);
  }
  const target = new Date(opts.now);
  // Always *next* — if today matches, advance one full week.
  let delta = (weekday - target.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  target.setDate(target.getDate() + delta);
  setLocalHour(target, hourFor(at, opts));
  return {
    resolvedDeferDate: toIsoWithOffset(target),
    reason: `next ${DAY_NAMES[weekday]} ${at} (${formatDate(target)} ${formatTime(target)})`,
  };
}

function resolveInBusinessDays(days: number, opts: ResolveOptions): ResolvedDefer {
  if (!Number.isInteger(days) || days < 1) {
    throw new ValidationError(`days must be a positive integer; got ${String(days)}`);
  }
  const target = new Date(opts.now);
  let remaining = days;
  while (remaining > 0) {
    target.setDate(target.getDate() + 1);
    if (!isWeekend(target)) remaining--;
  }
  setLocalHour(target, opts.morningHour);
  return {
    resolvedDeferDate: toIsoWithOffset(target),
    reason: `${days} business day${days === 1 ? "" : "s"} from now (${DAY_NAMES[target.getDay()]} ${formatDate(target)})`,
  };
}

function resolveNextMonthStart(opts: ResolveOptions): ResolvedDefer {
  const target = new Date(opts.now.getFullYear(), opts.now.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    resolvedDeferDate: toIsoWithOffset(target),
    reason: `start of next month (${formatDate(target)})`,
  };
}

function resolveExplicitSkipWeekends(date: string, opts: ResolveOptions): ResolvedDefer {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`date must be a parseable ISO-8601 timestamp; got ${date}`);
  }
  // Use the input timestamp as-is, then shift forward to Monday if it lands on a weekend.
  // We don't override the time — the caller picked it deliberately.
  // Bare dates parse as UTC midnight under ECMAScript rules — the *previous*
  // local calendar day anywhere west of UTC, which both skips the promised
  // weekend snap and defers a day early. Re-construct as local midnight (cf.
  // the bare-date precedent in src/resources/agenda.ts; the NaN check above
  // already rejected out-of-range components like 2026-13-45).
  let target = new Date(parsed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parts = date.split("-");
    target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
  }
  let shifted = false;
  while (isWeekend(target)) {
    target.setDate(target.getDate() + 1);
    shifted = true;
  }
  // Reference `opts` so noUnusedParameters lint doesn't trip on the unused arg.
  void opts;
  return {
    resolvedDeferDate: toIsoWithOffset(target),
    reason: shifted
      ? `${date} → snapped to ${DAY_NAMES[target.getDay()]} ${formatDate(target)} (skipped weekend)`
      : `${date} (no weekend skip needed)`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function hourFor(at: TimeOfDay, opts: ResolveOptions): number {
  return at === "morning" ? opts.morningHour : opts.afternoonHour;
}

function setLocalHour(d: Date, hour: number): void {
  d.setHours(hour, 0, 0, 0);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Format a Date as `YYYY-MM-DDTHH:mm:ss±HH:MM` in the server's local zone.
 * Matches ADR-0007's ISO-8601-with-offset boundary contract.
 */
function toIsoWithOffset(d: Date): string {
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${offset}`
  );
}

// ---------------------------------------------------------------------------
// Env-driven defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MORNING_HOUR = 9;
export const DEFAULT_AFTERNOON_HOUR = 14;

/** Read morning/afternoon hours from env with sane defaults + bounds checks. */
export function readDeferHoursFromEnv(env: NodeJS.ProcessEnv = process.env): {
  morningHour: number;
  afternoonHour: number;
} {
  return {
    morningHour: parseHourEnv(env.OMNIFOCUS_MORNING_HOUR, DEFAULT_MORNING_HOUR),
    afternoonHour: parseHourEnv(env.OMNIFOCUS_AFTERNOON_HOUR, DEFAULT_AFTERNOON_HOUR),
  };
}

function parseHourEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}
