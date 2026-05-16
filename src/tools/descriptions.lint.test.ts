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
 * Also enforces a per-description token budget so the static tools/list
 * prefix does not drift upward silently (#777). Budget = p95 + headroom;
 * tools that legitimately exceed it get a named exemption with a reason.
 *
 * This test fails CI on violations so that the standard is enforced
 * automatically as new tools are added. To fix a violation, update the
 * description in the tool's source file (e.g. src/tools/task/list.ts).
 *
 * @see src/tools/descriptionShape.ts — matcher implementation
 * @see src/tools/allDescriptions.ts — central description registry
 * @see tests/benchmark/token-cost/tokenizer.ts — shared TOKEN_DIVISOR
 */

import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../tests/benchmark/token-cost/tokenizer.js";
import { ALL_TOOL_DESCRIPTIONS } from "./allDescriptions.js";
import { checkDescriptionShape, formatShapeViolations } from "./descriptionShape.js";

/**
 * Per-description token ceiling (p95 of current baseline ≈ 303 tokens, plus ~15%
 * headroom). New descriptions must stay under this limit. Existing tools that
 * historically exceeded this threshold are listed in TOKEN_BUDGET_EXEMPTIONS below
 * and should be trimmed in a follow-up pass (#770 optimizations).
 */
const TOKEN_BUDGET = 350;

/**
 * Tools granted a temporary exemption because their description exceeded TOKEN_BUDGET
 * when the budget was introduced (2026-05-09 baseline). Each entry records the token
 * count at exemption time; if the description is later trimmed below TOKEN_BUDGET
 * the exemption should be removed.
 *
 * Do NOT add new entries here for convenience — trim the description instead.
 * The exemption mechanism exists for legacy outliers only.
 */
const TOKEN_BUDGET_EXEMPTIONS: ReadonlySet<string> = new Set<string>([]);

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

  it(`every description is ≤ ${TOKEN_BUDGET} tokens (tools/list static cost budget)`, () => {
    const violations: string[] = [];

    for (const [name, desc] of Object.entries(ALL_TOOL_DESCRIPTIONS)) {
      const tokens = estimateTokens(Buffer.byteLength(desc, "utf8"));
      if (tokens > TOKEN_BUDGET && !TOKEN_BUDGET_EXEMPTIONS.has(name)) {
        violations.push(
          `  ${name}: ${tokens} tokens (budget: ${TOKEN_BUDGET}, over by ${tokens - TOKEN_BUDGET})`,
        );
      }
    }

    expect(
      violations.join("\n"),
      `Descriptions exceeding token budget — trim or add a named exemption:\n${violations.join("\n")}`,
    ).toBe("");
  });

  it("reports total tools/list token estimate", () => {
    const totalTokens = Object.values(ALL_TOOL_DESCRIPTIONS).reduce(
      (sum, desc) => sum + estimateTokens(Buffer.byteLength(desc, "utf8")),
      0,
    );
    const toolCount = Object.keys(ALL_TOOL_DESCRIPTIONS).length;
    // biome-ignore lint/suspicious/noConsole: informational summary visible in test output
    console.log(
      `tools/list descriptions: ${toolCount} tools, ~${totalTokens} tokens total (budget: ${TOKEN_BUDGET}/tool)`,
    );
    expect(toolCount).toBeGreaterThan(0);
  });
});
