/**
 * Tests for `resolveDeferIntent` — pure date grammar resolver.
 *
 * Tests inject `now` deterministically. They run in whatever zone the host
 * is configured for; assertions check local-zone behaviour (the offset
 * suffix varies per host) so the tests pass on both UTC CI runners and
 * a developer's local clock.
 */

import { describe, expect, it } from "vitest";
import { CalendarBridgeUnavailable, ValidationError } from "../errors/index.js";
import {
  DEFAULT_AFTERNOON_HOUR,
  DEFAULT_MORNING_HOUR,
  readDeferHoursFromEnv,
  resolveDeferIntent,
} from "./dateGrammar.js";

const FRIDAY_AFTERNOON = new Date(2026, 3, 24, 15, 0, 0); // 2026-04-24 15:00 (Fri)
const SATURDAY = new Date(2026, 3, 25, 10, 0, 0); // 2026-04-25 10:00 (Sat)
const MONDAY = new Date(2026, 3, 27, 10, 0, 0); // 2026-04-27 10:00 (Mon)

const OPTS = { now: FRIDAY_AFTERNOON, morningHour: 9, afternoonHour: 14 };

describe("resolveDeferIntent — next-work-day", () => {
  it("Friday afternoon → next Monday at morning hour (skips weekend)", () => {
    const result = resolveDeferIntent({ kind: "next-work-day" }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-04-27T09:00:00[+-]\d{2}:\d{2}$/);
    expect(result.reason).toContain("Mon");
    expect(result.reason).toContain("09:00");
  });

  it("Monday → Tuesday at morning hour", () => {
    const result = resolveDeferIntent({ kind: "next-work-day" }, { ...OPTS, now: MONDAY });
    expect(result.resolvedDeferDate).toMatch(/^2026-04-28T09:00:00[+-]\d{2}:\d{2}$/);
  });

  it("honors `at: afternoon`", () => {
    const result = resolveDeferIntent({ kind: "next-work-day", at: "afternoon" }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/T14:00:00[+-]\d{2}:\d{2}$/);
    expect(result.reason).toContain("afternoon");
  });

  it("Saturday → Monday (no weekend output)", () => {
    const result = resolveDeferIntent({ kind: "next-work-day" }, { ...OPTS, now: SATURDAY });
    expect(result.resolvedDeferDate).toMatch(/^2026-04-27T/);
  });
});

describe("resolveDeferIntent — next-weekday", () => {
  it("Friday → next Tuesday (weekday 2)", () => {
    // Fri Apr 24 → next Tue is Apr 28
    const result = resolveDeferIntent({ kind: "next-weekday", weekday: 2 }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-04-28T09:00:00/);
  });

  it("when today matches the requested weekday, advances a full week", () => {
    // Fri Apr 24, request Fri (5) → Fri May 1
    const result = resolveDeferIntent({ kind: "next-weekday", weekday: 5 }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-05-01T/);
  });

  it("honors afternoon", () => {
    const result = resolveDeferIntent({ kind: "next-weekday", weekday: 1, at: "afternoon" }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/T14:00:00/);
  });

  it("rejects out-of-range weekday with ValidationError", () => {
    expect(() => resolveDeferIntent({ kind: "next-weekday", weekday: 7 }, OPTS)).toThrow(
      ValidationError,
    );
    expect(() => resolveDeferIntent({ kind: "next-weekday", weekday: -1 }, OPTS)).toThrow(
      ValidationError,
    );
  });
});

describe("resolveDeferIntent — in-business-days", () => {
  it("Fri + 1 business day → Mon (skips Sat/Sun)", () => {
    const result = resolveDeferIntent({ kind: "in-business-days", days: 1 }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-04-27T/);
  });

  it("Fri + 3 business days → Wed", () => {
    const result = resolveDeferIntent({ kind: "in-business-days", days: 3 }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-04-29T/);
  });

  it("Mon + 5 business days → next Mon", () => {
    const result = resolveDeferIntent(
      { kind: "in-business-days", days: 5 },
      { ...OPTS, now: MONDAY },
    );
    expect(result.resolvedDeferDate).toMatch(/^2026-05-04T/);
  });

  it("rejects days < 1 with ValidationError", () => {
    expect(() => resolveDeferIntent({ kind: "in-business-days", days: 0 }, OPTS)).toThrow(
      ValidationError,
    );
    expect(() => resolveDeferIntent({ kind: "in-business-days", days: -1 }, OPTS)).toThrow(
      ValidationError,
    );
  });
});

describe("resolveDeferIntent — after-event", () => {
  it("throws CalendarBridgeUnavailable (variant gated to follow-up)", () => {
    expect(() => resolveDeferIntent({ kind: "after-event", eventId: "x" }, OPTS)).toThrow(
      CalendarBridgeUnavailable,
    );
  });
});

describe("resolveDeferIntent — next-month-start", () => {
  it("April 24 → May 1 at midnight", () => {
    const result = resolveDeferIntent({ kind: "next-month-start" }, OPTS);
    expect(result.resolvedDeferDate).toMatch(/^2026-05-01T00:00:00/);
  });

  it("December → January of next year", () => {
    const dec = new Date(2026, 11, 15, 12, 0, 0);
    const result = resolveDeferIntent({ kind: "next-month-start" }, { ...OPTS, now: dec });
    expect(result.resolvedDeferDate).toMatch(/^2027-01-01T00:00:00/);
  });
});

describe("resolveDeferIntent — explicit-with-skip-weekends", () => {
  it("weekday date passes through unchanged", () => {
    const result = resolveDeferIntent(
      { kind: "explicit-with-skip-weekends", date: "2026-04-27T10:00:00Z" },
      OPTS,
    );
    expect(result.reason).toContain("no weekend skip");
  });

  it("Saturday input snaps to Monday", () => {
    const result = resolveDeferIntent(
      { kind: "explicit-with-skip-weekends", date: "2026-04-25T10:00:00Z" },
      OPTS,
    );
    expect(result.reason).toContain("snapped");
    expect(result.reason).toMatch(/Mon/);
  });

  it("rejects unparseable dates", () => {
    expect(() =>
      resolveDeferIntent({ kind: "explicit-with-skip-weekends", date: "not-a-date" }, OPTS),
    ).toThrow(ValidationError);
  });
});

describe("readDeferHoursFromEnv", () => {
  it("returns defaults when env is empty", () => {
    expect(readDeferHoursFromEnv({})).toEqual({
      morningHour: DEFAULT_MORNING_HOUR,
      afternoonHour: DEFAULT_AFTERNOON_HOUR,
    });
  });

  it("parses valid env values", () => {
    expect(
      readDeferHoursFromEnv({ OMNIFOCUS_MORNING_HOUR: "8", OMNIFOCUS_AFTERNOON_HOUR: "13" }),
    ).toEqual({ morningHour: 8, afternoonHour: 13 });
  });

  it("falls back to defaults on invalid env (out of range, non-integer, garbage)", () => {
    expect(
      readDeferHoursFromEnv({ OMNIFOCUS_MORNING_HOUR: "24", OMNIFOCUS_AFTERNOON_HOUR: "-1" }),
    ).toEqual({
      morningHour: DEFAULT_MORNING_HOUR,
      afternoonHour: DEFAULT_AFTERNOON_HOUR,
    });
    expect(readDeferHoursFromEnv({ OMNIFOCUS_MORNING_HOUR: "garbage" })).toEqual({
      morningHour: DEFAULT_MORNING_HOUR,
      afternoonHour: DEFAULT_AFTERNOON_HOUR,
    });
  });
});
