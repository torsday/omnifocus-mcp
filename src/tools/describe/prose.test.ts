/**
 * Unit tests for *_describe prose helpers — formatDate must render the
 * local calendar day (host TZ = user TZ per docs/dates.md), not UTC
 * components, so the human-approval preview narrates the right day.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDate } from "./prose.js";

describe("formatDate", () => {
  // Pin a west-of-UTC zone so the UTC-getter regression is observable
  // regardless of the host machine's timezone.
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("renders the local calendar day for a local-evening time (not the UTC day)", () => {
    // 5pm PDT = next day 00:00 UTC — must NOT render as a bare 2026-06-10.
    expect(formatDate("2026-06-09T17:00:00-07:00")).toBe("2026-06-09 17:00");
  });

  it("elides the time component at local midnight", () => {
    // Local midnight is 07:00 UTC — UTC getters would render a spurious time.
    expect(formatDate("2026-06-09T00:00:00-07:00")).toBe("2026-06-09");
  });

  it("renders UTC input in local terms", () => {
    // 2026-06-10T03:00Z = 2026-06-09 20:00 PDT.
    expect(formatDate("2026-06-10T03:00:00Z")).toBe("2026-06-09 20:00");
  });
});
