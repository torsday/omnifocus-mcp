/**
 * Unit tests for `aliasedEnum` (#573).
 */

import { describe, expect, it } from "vitest";

import { aliasedEnum } from "./aliasedEnum.js";

describe("aliasedEnum", () => {
  it("accepts canonical values unchanged", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, { paused: "on-hold" }, "Status.");
    expect(s.parse("active")).toBe("active");
    expect(s.parse("on-hold")).toBe("on-hold");
  });

  it("normalises a documented alias to its canonical value", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, { paused: "on-hold" }, "Status.");
    expect(s.parse("paused")).toBe("on-hold");
  });

  it("matches aliases case-insensitively", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, { paused: "on-hold" }, "Status.");
    expect(s.parse("PAUSED")).toBe("on-hold");
    expect(s.parse("Paused")).toBe("on-hold");
  });

  it("rejects unknown values with a Zod error", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, { paused: "on-hold" }, "Status.");
    expect(() => s.parse("xyz")).toThrow();
  });

  it("rejects non-string values cleanly (passes through to enum)", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, { paused: "on-hold" }, "Status.");
    expect(() => s.parse(42)).toThrow();
    expect(() => s.parse(null)).toThrow();
  });

  it("appends the accepted-aliases sentence to the description", () => {
    const s = aliasedEnum(
      ["active", "on-hold", "done"] as const,
      { paused: "on-hold", completed: "done" },
      "Project status.",
    );
    // Zod 4 stores describe metadata; verify by extracting via .describe() which
    // is the chained accessor pattern used by the helper.
    expect(s.description).toBe("Project status. Accepts: 'paused' → on-hold, 'completed' → done.");
  });

  it("emits the bare describe when no aliases are supplied", () => {
    const s = aliasedEnum(["active", "on-hold"] as const, {}, "Status.");
    expect(s.description).toBe("Status.");
  });

  it("throws at construction time when an alias points at a non-canonical value", () => {
    expect(() =>
      aliasedEnum(
        ["active", "on-hold"] as const,
        // @ts-expect-error — intentional: 'bogus' isn't in canonical
        { paused: "bogus" },
        "Status.",
      ),
    ).toThrow(/canonical set/);
  });
});
