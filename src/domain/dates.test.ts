import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ISO_8601_WITH_OFFSET,
  flexDateString,
  isIsoDateString,
  isRelativeDateShortcut,
  isoDateString,
  resolveRelativeDate,
} from "./dates.js";

describe("isIsoDateString", () => {
  it("we accept UTC (Z) form", () => {
    expect(isIsoDateString("2026-04-19T12:00:00Z")).toBe(true);
    expect(isIsoDateString("2026-04-19T12:00:00.123Z")).toBe(true);
    expect(isIsoDateString("2026-12-31T23:59:59.123456789Z")).toBe(true);
  });

  it("we accept signed offset forms", () => {
    expect(isIsoDateString("2026-04-19T12:00:00-05:00")).toBe(true);
    expect(isIsoDateString("2026-04-19T12:00:00+09:30")).toBe(true);
    expect(isIsoDateString("2026-04-19T12:00:00.500-05:00")).toBe(true);
    expect(isIsoDateString("2026-04-19T12:00:00+00:00")).toBe(true);
  });

  it("we reject bare local time (ambiguous — no offset)", () => {
    expect(isIsoDateString("2026-04-19T12:00:00")).toBe(false);
    expect(isIsoDateString("2026-04-19T12:00:00.500")).toBe(false);
  });

  it("we reject date-only strings (no time)", () => {
    expect(isIsoDateString("2026-04-19")).toBe(false);
  });

  it("we reject space as the date-time separator", () => {
    expect(isIsoDateString("2026-04-19 12:00:00Z")).toBe(false);
  });

  it("we reject malformed shapes outright", () => {
    expect(isIsoDateString("")).toBe(false);
    expect(isIsoDateString("yesterday")).toBe(false);
    expect(isIsoDateString("2026/04/19T12:00:00Z")).toBe(false); // slashes
    expect(isIsoDateString("26-04-19T12:00:00Z")).toBe(false); // 2-digit year
    expect(isIsoDateString("2026-4-19T12:00:00Z")).toBe(false); // 1-digit month
  });

  it("we reject non-string inputs", () => {
    expect(isIsoDateString(null)).toBe(false);
    expect(isIsoDateString(undefined)).toBe(false);
    expect(isIsoDateString(1713573600000)).toBe(false); // epoch millis
    expect(isIsoDateString(new Date())).toBe(false);
    expect(isIsoDateString({})).toBe(false);
  });

  it("we reject strings that parse as regex but are not valid dates", () => {
    // JavaScript Date.parse rejects out-of-range month, hour, minute.
    // Note: day-of-month overflow (e.g. Feb 31) silently normalizes to the
    // next month in V8, so we don't test for it here; stricter day-level
    // validation is the adapter's responsibility, not this schema's.
    expect(isIsoDateString("2026-13-01T00:00:00Z")).toBe(false); // month 13
    expect(isIsoDateString("2026-04-19T25:00:00Z")).toBe(false); // hour 25
    expect(isIsoDateString("2026-04-19T12:60:00Z")).toBe(false); // minute 60
  });
});

describe("isoDateString() schema", () => {
  it("we parse a valid ISO-8601 with offset and return the string verbatim", () => {
    const schema = isoDateString();
    const raw = "2026-04-19T12:00:00-05:00";
    expect(schema.parse(raw)).toBe(raw);
  });

  it("we emit a zod issue with a helpful suggestion on bare local time", () => {
    const schema = isoDateString();
    const result = schema.safeParse("2026-04-19T12:00:00");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Bare local time is rejected");
    }
  });

  it("we reject well-formed but impossible dates via the refinement", () => {
    const schema = isoDateString();
    const result = schema.safeParse("2026-13-01T00:00:00Z"); // month 13
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("we compose cleanly with .optional() and .nullable()", () => {
    const schema = isoDateString().nullable().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse("2026-04-19T12:00:00Z").success).toBe(true);
    expect(schema.safeParse("bad").success).toBe(false);
  });

  it("we compose cleanly inside an object schema", () => {
    const taskLike = z.object({
      name: z.string(),
      dueDate: isoDateString().optional(),
    });
    expect(
      taskLike.safeParse({ name: "Write", dueDate: "2026-04-19T12:00:00-05:00" }).success,
    ).toBe(true);
    expect(taskLike.safeParse({ name: "Write", dueDate: "2026-04-19T12:00:00" }).success).toBe(
      false,
    );
  });
});

describe("property — every pattern-matching valid timestamp parses", () => {
  it("isoDateString accepts any well-formed timestamp with offset", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("1970-01-01T00:00:00Z"),
          max: new Date("2100-01-01T00:00:00Z"),
        }),
        (d) => {
          const iso = d.toISOString(); // always ends in Z
          expect(ISO_8601_WITH_OFFSET.test(iso)).toBe(true);
          expect(isoDateString().safeParse(iso).success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("property — strings without offset are uniformly rejected", () => {
  it("isoDateString rejects any string that looks like ISO-8601 but lacks an offset", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("1970-01-01T00:00:00Z"),
          max: new Date("2100-01-01T00:00:00Z"),
        }),
        (d) => {
          // Strip the trailing Z to produce a bare-local-time string.
          const bare = d.toISOString().replace(/Z$/, "");
          expect(isoDateString().safeParse(bare).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("isRelativeDateShortcut", () => {
  it("recognises all valid shortcuts", () => {
    for (const s of [
      "today",
      "tomorrow",
      "yesterday",
      "this-week",
      "next-week",
      "end-of-week",
      "end-of-month",
    ]) {
      expect(isRelativeDateShortcut(s)).toBe(true);
    }
  });

  it("rejects ISO strings, arbitrary strings, and non-strings", () => {
    expect(isRelativeDateShortcut("2026-04-19T12:00:00Z")).toBe(false);
    expect(isRelativeDateShortcut("next-year")).toBe(false);
    expect(isRelativeDateShortcut(null)).toBe(false);
    expect(isRelativeDateShortcut(42)).toBe(false);
  });
});

describe("resolveRelativeDate", () => {
  // Pin to a known Wednesday: 2026-04-22 (Wed)
  const wed = new Date(2026, 3, 22, 10, 0, 0); // April 22 2026, 10:00 local

  it("today resolves to start of today", () => {
    const result = resolveRelativeDate("today", wed);
    expect(result).toMatch(/^2026-04-22T00:00:00/);
  });

  it("tomorrow resolves to start of tomorrow", () => {
    expect(resolveRelativeDate("tomorrow", wed)).toMatch(/^2026-04-23T00:00:00/);
  });

  it("yesterday resolves to start of yesterday", () => {
    expect(resolveRelativeDate("yesterday", wed)).toMatch(/^2026-04-21T00:00:00/);
  });

  it("this-week resolves to the Monday of the current week", () => {
    expect(resolveRelativeDate("this-week", wed)).toMatch(/^2026-04-20T00:00:00/); // Mon Apr 20
  });

  it("next-week resolves to the Monday of next week", () => {
    expect(resolveRelativeDate("next-week", wed)).toMatch(/^2026-04-27T00:00:00/); // Mon Apr 27
  });

  it("end-of-week resolves to Sunday of the current week", () => {
    expect(resolveRelativeDate("end-of-week", wed)).toMatch(/^2026-04-26T00:00:00/); // Sun Apr 26
  });

  it("end-of-month resolves to the last day of the current month", () => {
    expect(resolveRelativeDate("end-of-month", wed)).toMatch(/^2026-04-30T00:00:00/);
  });

  it("all outputs are valid ISO-8601 strings with an offset", () => {
    for (const shortcut of [
      "today",
      "tomorrow",
      "yesterday",
      "this-week",
      "next-week",
      "end-of-week",
      "end-of-month",
    ] as const) {
      expect(isIsoDateString(resolveRelativeDate(shortcut, wed))).toBe(true);
    }
  });
});

describe("flexDateString() schema", () => {
  it("passes through a valid ISO-8601 string unchanged", () => {
    const iso = "2026-04-19T12:00:00-05:00";
    expect(flexDateString().parse(iso)).toBe(iso);
  });

  it("resolves a relative shortcut to an ISO-8601 string", () => {
    const result = flexDateString().parse("today");
    expect(isIsoDateString(result)).toBe(true);
  });

  it("rejects bare local time with a helpful message", () => {
    const r = flexDateString().safeParse("2026-04-19T12:00:00");
    expect(r.success).toBe(false);
  });

  it("rejects unknown strings with a helpful message", () => {
    const r = flexDateString().safeParse("next-year");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("next-year");
  });

  it("composes with .nullable().optional()", () => {
    const schema = flexDateString().nullable().optional();
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse("today").success).toBe(true);
    expect(schema.safeParse("bad").success).toBe(false);
  });
});
