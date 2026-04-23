/**
 * Tool-description lint test — CI gate.
 *
 * Iterates every description in allDescriptions.ts and asserts it satisfies
 * the four-section shape from DESIGN.md §6.8:
 *   1. What it does (first sentence — always present for non-empty strings)
 *   2. When NOT to use it  (Do NOT / prefer / instead)
 *   3. What it returns     (Returns …)
 *   4. Side effects        (Side effects: / safe to / no side effects / …)
 *
 * This test fails CI on violations so that the standard is enforced
 * automatically as new tools are added. To fix a violation, update the
 * description in the tool's source file (e.g. src/tools/task/list.ts).
 *
 * @see src/tools/descriptionShape.ts — matcher implementation
 * @see src/tools/allDescriptions.ts — central description registry
 */

import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTIONS } from "./allDescriptions.js";
import { checkDescriptionShape, formatShapeViolations } from "./descriptionShape.js";

describe("tool descriptions — DESIGN §6.8 shape lint", () => {
  it("every tool description satisfies the four-section shape", () => {
    const results = Object.entries(ALL_TOOL_DESCRIPTIONS).map(([name, desc]) =>
      checkDescriptionShape(name, desc),
    );

    const report = formatShapeViolations(results);
    expect(report, report).toBe("");
  });

  it("registry is non-empty (guard against accidental empty import)", () => {
    expect(Object.keys(ALL_TOOL_DESCRIPTIONS).length).toBeGreaterThan(0);
  });
});
