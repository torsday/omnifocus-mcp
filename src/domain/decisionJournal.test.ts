/**
 * Tests for the decision-journal fence parser, writer, and active-check.
 */

import { describe, expect, it } from "vitest";
import {
  clearDecision,
  type Decision,
  isDecisionActive,
  parseDecision,
  writeDecision,
} from "./decisionJournal.js";

const SAMPLE: Decision = {
  kind: "stall-is-intentional",
  reason: "Strategic pause until Q3 budget cycle",
  recordedAt: "2026-04-29T10:00:00Z",
};

describe("decisionJournal — parseDecision", () => {
  it("returns undefined for a null or empty note", () => {
    expect(parseDecision(null)).toBeUndefined();
    expect(parseDecision("")).toBeUndefined();
  });

  it("returns undefined when no decision-journal fence is present", () => {
    expect(parseDecision("just a free-form note")).toBeUndefined();
    // A waiting-on fence without a decision-journal fence should not match.
    const note = "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00Z\n```\n\nfree text";
    expect(parseDecision(note)).toBeUndefined();
  });

  it("parses a well-formed fence", () => {
    const note =
      "```decision-journal\n" +
      "kind: stall-is-intentional\n" +
      "reason: Strategic pause until Q3 budget cycle\n" +
      "recordedAt: 2026-04-29T10:00:00Z\n" +
      "```\n";
    expect(parseDecision(note)).toEqual(SAMPLE);
  });

  it("parses an optional `until` field", () => {
    const note =
      "```decision-journal\n" +
      "kind: deferred-by-choice\n" +
      "reason: Wait for Alice's review\n" +
      "recordedAt: 2026-04-29T10:00:00Z\n" +
      "until: 2026-05-15T10:00:00Z\n" +
      "```\n";
    const result = parseDecision(note);
    expect(result?.until).toBe("2026-05-15T10:00:00Z");
  });

  it("returns undefined when fence is missing the required `kind` field", () => {
    const note =
      "```decision-journal\n" +
      "reason: incomplete\n" +
      "recordedAt: 2026-04-29T10:00:00Z\n" +
      "```\n";
    expect(parseDecision(note)).toBeUndefined();
  });

  it("returns undefined when `kind` is not in the closed set", () => {
    const note =
      "```decision-journal\n" +
      "kind: bogus-kind\n" +
      "reason: x\n" +
      "recordedAt: 2026-04-29T10:00:00Z\n" +
      "```\n";
    expect(parseDecision(note)).toBeUndefined();
  });

  it("returns undefined when fence body is malformed", () => {
    const note = "```decision-journal\n!!! not yaml at all !!!\n```\n";
    expect(parseDecision(note)).toBeUndefined();
  });
});

describe("decisionJournal — writeDecision", () => {
  it("creates a new fence when none is present, preserving the existing note", () => {
    const before = "free-form note here";
    const after = writeDecision(before, SAMPLE);
    expect(after).toContain("```decision-journal");
    expect(after).toContain("kind: stall-is-intentional");
    expect(after).toContain("free-form note here");
  });

  it("replaces an existing fence in place", () => {
    const initial = writeDecision("free text", SAMPLE);
    const updated = writeDecision(initial, {
      ...SAMPLE,
      kind: "acknowledged-zombie",
      reason: "letting it die naturally",
    });
    expect(updated).toContain("kind: acknowledged-zombie");
    expect(updated).not.toContain("kind: stall-is-intentional");
    expect(updated).toContain("free text");
  });

  it("preserves a sibling waiting-on fence when writing a decision-journal fence", () => {
    const before = "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00Z\n```\n\nfree text";
    const after = writeDecision(before, SAMPLE);
    expect(after).toContain("```waiting-on");
    expect(after).toContain("```decision-journal");
    expect(after).toContain("free text");
  });
});

describe("decisionJournal — clearDecision", () => {
  it("removes only the decision-journal fence, leaving siblings intact", () => {
    const note =
      "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00Z\n```\n\n" +
      "```decision-journal\n" +
      "kind: stall-is-intentional\nreason: x\nrecordedAt: 2026-04-29T10:00:00Z\n" +
      "```";
    const after = clearDecision(note);
    expect(after).toContain("```waiting-on");
    expect(after ?? "").not.toContain("```decision-journal");
  });

  it("returns null when the cleared note would be empty", () => {
    const only =
      "```decision-journal\n" +
      "kind: stall-is-intentional\nreason: x\nrecordedAt: 2026-04-29T10:00:00Z\n" +
      "```";
    expect(clearDecision(only)).toBeNull();
  });

  it("is a no-op when no decision-journal fence is present", () => {
    expect(clearDecision("free text")).toBe("free text");
    expect(clearDecision(null)).toBeNull();
  });
});

describe("decisionJournal — isDecisionActive", () => {
  it("returns true when `until` is unset", () => {
    expect(isDecisionActive(SAMPLE)).toBe(true);
  });

  it("returns true when `until` is in the future", () => {
    const future: Decision = { ...SAMPLE, until: "2099-01-01T00:00:00Z" };
    expect(isDecisionActive(future)).toBe(true);
  });

  it("returns false when `until` is in the past", () => {
    const expired: Decision = { ...SAMPLE, until: "2020-01-01T00:00:00Z" };
    expect(isDecisionActive(expired)).toBe(false);
  });

  it("respects an injected `now` for deterministic tests", () => {
    const decision: Decision = { ...SAMPLE, until: "2026-05-15T10:00:00Z" };
    expect(isDecisionActive(decision, new Date("2026-05-01T00:00:00Z"))).toBe(true);
    expect(isDecisionActive(decision, new Date("2026-06-01T00:00:00Z"))).toBe(false);
  });
});

describe("decisionJournal — round-trip", () => {
  it("write → parse returns the original (without `until`)", () => {
    const note = writeDecision(null, SAMPLE);
    expect(parseDecision(note)).toEqual(SAMPLE);
  });

  it("write → parse returns the original (with `until`)", () => {
    const decision: Decision = { ...SAMPLE, until: "2026-05-15T10:00:00Z" };
    const note = writeDecision(null, decision);
    expect(parseDecision(note)).toEqual(decision);
  });
});
