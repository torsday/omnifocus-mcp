/**
 * Unit tests for calendarWeeks.ts helpers.
 *
 * All assertions use Monday-based ISO-8601 weeks:
 * - week containing 2026-04-27 (Monday) → starts 2026-04-27
 * - week containing 2026-04-26 (Sunday) → starts 2026-04-20
 * - week containing 2026-04-28 (Tuesday) → starts 2026-04-27
 */

import { describe, expect, it } from "vitest";
import { isoWeekEnd, isoWeekStart, trailingWeekStarts, weekBounds } from "./calendarWeeks.js";

// Helper: parse a local-midnight date string and return UTC midnight equivalent for comparison.
// We compare with toDateString() to avoid timezone-offset noise in CI.
function dateStr(d: Date): string {
  return d.toDateString(); // e.g. "Mon Apr 27 2026"
}

describe("isoWeekStart", () => {
  it("returns the same Monday for a Monday input", () => {
    const d = new Date("2026-04-27T10:00:00"); // Monday
    expect(dateStr(isoWeekStart(d))).toBe("Mon Apr 27 2026");
  });

  it("returns the preceding Monday for a Sunday input", () => {
    const d = new Date("2026-04-26T10:00:00"); // Sunday
    expect(dateStr(isoWeekStart(d))).toBe("Mon Apr 20 2026");
  });

  it("returns the preceding Monday for a Tuesday input", () => {
    const d = new Date("2026-04-28T10:00:00"); // Tuesday
    expect(dateStr(isoWeekStart(d))).toBe("Mon Apr 27 2026");
  });

  it("returns the preceding Monday for a Saturday input", () => {
    const d = new Date("2026-04-25T10:00:00"); // Saturday
    expect(dateStr(isoWeekStart(d))).toBe("Mon Apr 20 2026");
  });

  it("zeroes the time to midnight", () => {
    const d = new Date("2026-04-27T23:59:59.999"); // Monday late
    const ws = isoWeekStart(d);
    expect(ws.getHours()).toBe(0);
    expect(ws.getMinutes()).toBe(0);
    expect(ws.getSeconds()).toBe(0);
    expect(ws.getMilliseconds()).toBe(0);
  });
});

describe("isoWeekEnd", () => {
  it("returns the next Monday (7 days later)", () => {
    const weekStart = new Date("2026-04-27T00:00:00"); // Monday
    const weekEnd = isoWeekEnd(weekStart);
    expect(dateStr(weekEnd)).toBe("Mon May 04 2026");
  });
});

describe("weekBounds", () => {
  it("returns [Monday, next Monday) for a mid-week date", () => {
    const d = new Date("2026-04-29T14:00:00"); // Wednesday
    const { from, to } = weekBounds(d);
    expect(dateStr(from)).toBe("Mon Apr 27 2026");
    expect(dateStr(to)).toBe("Mon May 04 2026");
  });
});

describe("trailingWeekStarts", () => {
  it("returns n week-start Mondays in chronological order", () => {
    // Anchor: Monday 2026-04-27
    const now = new Date("2026-04-27T10:00:00");
    const weeks = trailingWeekStarts(3, now);
    expect(weeks).toHaveLength(3);
    expect(dateStr(weeks[0] as Date)).toBe("Mon Apr 13 2026"); // 2 weeks ago
    expect(dateStr(weeks[1] as Date)).toBe("Mon Apr 20 2026"); // 1 week ago
    expect(dateStr(weeks[2] as Date)).toBe("Mon Apr 27 2026"); // this week
  });

  it("returns 1 element for n=1", () => {
    const now = new Date("2026-04-27T10:00:00");
    const weeks = trailingWeekStarts(1, now);
    expect(weeks).toHaveLength(1);
    expect(dateStr(weeks[0] as Date)).toBe("Mon Apr 27 2026");
  });

  it("anchors on the current week for a mid-week date", () => {
    // Wednesday 2026-04-29 → current week starts Mon 2026-04-27
    const now = new Date("2026-04-29T10:00:00");
    const weeks = trailingWeekStarts(2, now);
    expect(dateStr(weeks[0] as Date)).toBe("Mon Apr 20 2026");
    expect(dateStr(weeks[1] as Date)).toBe("Mon Apr 27 2026");
  });
});
