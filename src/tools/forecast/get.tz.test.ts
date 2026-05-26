/**
 * TZ + DST regression matrix for the forecast surface (#1037).
 *
 * Locks the four cross-TZ scenarios from #833's audit so future drift in
 * `localDayKey`, `startOfDayInTz`, or `resolveAnchorDate` gets caught
 * here instead of shipping silently:
 *
 *   1. Server-UTC + user-PT (the audit's motivating case)
 *   2. Server-PT + user-UTC (the symmetric case)
 *   3. US DST spring-forward (2026-03-08 02:00 → 03:00)
 *   4. US DST fall-back (2026-11-01 02:00 → 01:00)
 *
 * Scope: the three TZ-aware helpers `localDayKey`, `startOfDayInTz`, and
 * `resolveAnchorDate` are exercised with explicit `tz` arguments so the
 * tests don't depend on the host runtime's `process.env.TZ`. This is the
 * deliberate trade-off documented in `docs/dates.md` — production
 * callers assume host-TZ == user-TZ; tests pin the cross-TZ behavior by
 * passing tz explicitly. A handler-level integration would require a
 * separate TZ-mockable test harness (out of scope for this PR; see the
 * #833 audit doc).
 */

import { describe, expect, it } from "vitest";
import { localDayKey, resolveAnchorDate, startOfDayInTz } from "./get.js";

// Canonical TZ identifiers used throughout the matrix. PT covers both
// PST (UTC-8) and PDT (UTC-7) depending on date; UTC and Tokyo (UTC+9)
// give us symmetric coverage on either side of the offset axis.
const PT = "America/Los_Angeles";
const UTC = "UTC";
const TOKYO = "Asia/Tokyo";

describe("forecast TZ matrix — scenario 1: user in PT, server in UTC", () => {
  // Motivating case from #1035/#1036. Tasks created late evening PT show
  // up in the UTC ISO as the *next* day; the wire keys must still bucket
  // under the user's PT calendar day.

  it("11pm PT due date buckets into the PT calendar day", () => {
    // 2026-05-26T23:00 PT = 2026-05-27T06:00Z
    expect(localDayKey("2026-05-27T06:00:00.000Z", PT)).toBe("2026-05-26");
  });

  it("midnight UTC is still 'yesterday' in PT", () => {
    // 2026-05-27T00:00Z = 2026-05-26T17:00 PT (PDT)
    expect(localDayKey("2026-05-27T00:00:00.000Z", PT)).toBe("2026-05-26");
  });

  it("resolveAnchorDate(tz=PT) anchors at midnight PT = 07:00 UTC (PDT)", () => {
    expect(resolveAnchorDate("2026-05-26T12:00:00-07:00", PT).toISOString()).toBe(
      "2026-05-26T07:00:00.000Z",
    );
  });

  it("the day before DST (still PST) anchors at 08:00 UTC", () => {
    expect(resolveAnchorDate("2026-03-07T12:00:00-08:00", PT).toISOString()).toBe(
      "2026-03-07T08:00:00.000Z",
    );
  });
});

describe("forecast TZ matrix — scenario 2: user in UTC, server elsewhere", () => {
  // Symmetric case — clients that store / display in UTC must get UTC
  // buckets, regardless of where the server runs.

  it("UTC due date buckets into the UTC calendar day", () => {
    expect(localDayKey("2026-05-26T23:00:00.000Z", UTC)).toBe("2026-05-26");
  });

  it("midnight UTC is its own calendar day", () => {
    expect(localDayKey("2026-05-27T00:00:00.000Z", UTC)).toBe("2026-05-27");
  });

  it("resolveAnchorDate(tz=UTC) anchors at UTC midnight", () => {
    expect(resolveAnchorDate("2026-05-26T12:00:00Z", UTC).toISOString()).toBe(
      "2026-05-26T00:00:00.000Z",
    );
  });
});

describe("forecast TZ matrix — scenario 3: positive-offset zone (Asia/Tokyo)", () => {
  // Tokyo is UTC+9 — the offset-flip case. A task at 06:00 UTC is
  // already 15:00 Tokyo the same day; the prior UTC noon was midnight
  // Tokyo of the *next* day. Catches sign-of-offset regressions in the
  // helper math.

  it("06:00 UTC = mid-afternoon Tokyo same day", () => {
    expect(localDayKey("2026-05-26T06:00:00.000Z", TOKYO)).toBe("2026-05-26");
  });

  it("15:00 UTC on the 25th = midnight Tokyo on the 26th", () => {
    expect(localDayKey("2026-05-25T15:00:00.000Z", TOKYO)).toBe("2026-05-26");
  });

  it("startOfDayInTz(Tokyo) is 15:00 UTC the prior day", () => {
    expect(startOfDayInTz("2026-05-26", TOKYO).toISOString()).toBe("2026-05-25T15:00:00.000Z");
  });
});

describe("forecast TZ matrix — scenario 4: US DST spring-forward (2026-03-08)", () => {
  // PT shifts PST (UTC-8) → PDT (UTC-7) at 02:00 local on the 8th.
  // Midnight on the 8th is well before the spring-forward gap, so
  // anchoring there should still use PST. Tasks due during the gap
  // (02:00–02:59 local) don't exist in PT — they map to 03:00 PDT.

  it("startOfDayInTz on the spring-forward day still uses PST (UTC-8)", () => {
    // 2026-03-08T00:00 PT = 2026-03-08T08:00Z (PST, UTC-8)
    expect(startOfDayInTz("2026-03-08", PT).toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("midnight UTC on the spring-forward day buckets into 'yesterday' PT", () => {
    // 2026-03-08T00:00Z = 2026-03-07T16:00 PT (PST)
    expect(localDayKey("2026-03-08T00:00:00.000Z", PT)).toBe("2026-03-07");
  });

  it("post-DST noon UTC buckets correctly in PDT", () => {
    // 2026-03-08T12:00Z = 2026-03-08T05:00 PDT (post-shift, UTC-7)
    expect(localDayKey("2026-03-08T12:00:00.000Z", PT)).toBe("2026-03-08");
  });

  it("the next day's midnight in PT (post-DST) is 07:00 UTC (PDT)", () => {
    // 2026-03-09T00:00 PT (PDT) = 2026-03-09T07:00Z
    expect(startOfDayInTz("2026-03-09", PT).toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });
});

describe("forecast TZ matrix — scenario 5: US DST fall-back (2026-11-01)", () => {
  // PT shifts PDT (UTC-7) → PST (UTC-8) at 02:00 local on the 1st.
  // Midnight on the 1st is before the fall-back, still PDT. Tasks
  // during the repeated 01:00–01:59 local hour are ambiguous in PT;
  // IANA resolves them deterministically per the OS implementation
  // (typically picks the later/PST instance).

  it("startOfDayInTz on the fall-back day still uses PDT (UTC-7)", () => {
    // 2026-11-01T00:00 PT (PDT, before fall-back) = 2026-11-01T07:00Z
    expect(startOfDayInTz("2026-11-01", PT).toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("the next day's midnight in PT (post-DST) is 08:00 UTC (PST)", () => {
    // 2026-11-02T00:00 PT (PST) = 2026-11-02T08:00Z
    expect(startOfDayInTz("2026-11-02", PT).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("an early-morning PT instant on fall-back day buckets to the same local day", () => {
    // 2026-11-01T07:30Z. Could be 00:30 PDT or after-rollback 23:30
    // PST of the prior day. Either way the local Y-M-D is 2026-11-01
    // — the matrix asserts that the bucket is structurally that day,
    // not which side of the rollback the instant fell on.
    expect(localDayKey("2026-11-01T07:30:00.000Z", PT)).toBe("2026-11-01");
  });
});
