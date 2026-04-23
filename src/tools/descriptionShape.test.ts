/**
 * Unit tests for the DESIGN §6.8 tool-description shape checker.
 *
 * Covers: each clause independently, combinations, formatShapeViolations output.
 * The companion lint test (descriptions.lint.test.ts) runs the checker against
 * every registered tool description and fails CI on violations.
 */

import { describe, expect, it } from "vitest";
import {
  type DescriptionShapeResult,
  checkDescriptionShape,
  formatShapeViolations,
} from "./descriptionShape.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPLIANT =
  "List tasks in OmniFocus with optional filters. " +
  "Do NOT use for a known single task (use task_get). " +
  "Returns tasks[] with pagination. " +
  "Safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// checkDescriptionShape — when-not clause
// ---------------------------------------------------------------------------

describe("checkDescriptionShape — when-not clause", () => {
  it("passes with 'Do NOT'", () => {
    const r = checkDescriptionShape("t", "Do NOT use X. Returns Y. no side effects.");
    expect(r.missing).not.toContain("when-not");
  });

  it("passes with 'prefer'", () => {
    const r = checkDescriptionShape("t", "prefer task_get. Returns Y. no side effects.");
    expect(r.missing).not.toContain("when-not");
  });

  it("passes with 'instead'", () => {
    const r = checkDescriptionShape("t", "use note_set instead. Returns Y. no side effects.");
    expect(r.missing).not.toContain("when-not");
  });

  it("flags missing when-not", () => {
    const r = checkDescriptionShape("t", "Fetch a tag by ID. Returns tag. no side effects.");
    expect(r.missing).toContain("when-not");
  });

  it("is case-insensitive for 'do not'", () => {
    const r = checkDescriptionShape("t", "do not call this. Returns Y. no side effects.");
    expect(r.missing).not.toContain("when-not");
  });
});

// ---------------------------------------------------------------------------
// checkDescriptionShape — returns clause
// ---------------------------------------------------------------------------

describe("checkDescriptionShape — returns clause", () => {
  it("passes with 'Returns'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns the task. no side effects.");
    expect(r.missing).not.toContain("returns");
  });

  it("passes with 'Return' (no s)", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Return the task. no side effects.");
    expect(r.missing).not.toContain("returns");
  });

  it("flags missing returns clause", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Fetch the task. no side effects.");
    expect(r.missing).toContain("returns");
  });
});

// ---------------------------------------------------------------------------
// checkDescriptionShape — side-effects clause
// ---------------------------------------------------------------------------

describe("checkDescriptionShape — side-effects clause", () => {
  it("passes with 'Side effects:'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Side effects: writes.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'safe to call'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Safe to call repeatedly.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'no side effects'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. no side effects.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'read-only'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Read-only.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'writes to'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. writes to OmniFocus.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'Triggers a sync'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Triggers a sync.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("passes with 'mutations do not'", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Mutations do not sync.");
    expect(r.missing).not.toContain("side-effects");
  });

  it("flags missing side-effects clause", () => {
    const r = checkDescriptionShape("t", "Do NOT X. Returns Y. Call this when needed.");
    expect(r.missing).toContain("side-effects");
  });
});

// ---------------------------------------------------------------------------
// checkDescriptionShape — combined
// ---------------------------------------------------------------------------

describe("checkDescriptionShape — combined", () => {
  it("returns empty missing for fully compliant description", () => {
    const r = checkDescriptionShape("task_list", COMPLIANT);
    expect(r.missing).toEqual([]);
    expect(r.name).toBe("task_list");
  });

  it("flags all three when all clauses are absent", () => {
    const r = checkDescriptionShape("bad", "Fetch a tag by ID.");
    expect(r.missing).toEqual(["when-not", "returns", "side-effects"]);
  });

  it("flags only returns when other clauses present", () => {
    const r = checkDescriptionShape("t", "Do NOT use X. Fetch the task. no side effects.");
    expect(r.missing).toEqual(["returns"]);
  });
});

// ---------------------------------------------------------------------------
// formatShapeViolations
// ---------------------------------------------------------------------------

describe("formatShapeViolations", () => {
  it("returns empty string when no violations", () => {
    const results: DescriptionShapeResult[] = [
      { name: "task_list", description: COMPLIANT, missing: [] },
    ];
    expect(formatShapeViolations(results)).toBe("");
  });

  it("includes tool names and missing sections in output", () => {
    const results: DescriptionShapeResult[] = [
      { name: "tag_create", description: "Create a tag.", missing: ["when-not", "returns"] },
      { name: "task_list", description: COMPLIANT, missing: [] },
    ];
    const report = formatShapeViolations(results);
    expect(report).toContain("tag_create");
    expect(report).toContain("when-not");
    expect(report).toContain("returns");
    expect(report).not.toContain("task_list");
  });

  it("counts violation count in header", () => {
    const results: DescriptionShapeResult[] = [
      { name: "a", description: "", missing: ["returns"] },
      { name: "b", description: "", missing: ["when-not", "side-effects"] },
    ];
    const report = formatShapeViolations(results);
    expect(report).toMatch(/^2 tool description/);
  });
});
