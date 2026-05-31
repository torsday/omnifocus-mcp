/**
 * Registry completeness guard — CI gate.
 *
 * Asserts that ALL_INPUT_SCHEMAS covers every tool in ALL_TOOL_DESCRIPTIONS so
 * that the docs generator (scripts/generate-tool-docs.ts) never silently emits
 * an empty parameter table.
 *
 * Root cause of the gap: #1060 found project_get_many and tag_get_many were
 * registered in ALL_TOOL_DESCRIPTIONS but absent from ALL_INPUT_SCHEMAS. This
 * test prevents recurrence.
 *
 * Tools that legitimately take no input (e.g. app_launch, internal_status)
 * still need a z.object({}) entry in ALL_INPUT_SCHEMAS — the docs generator
 * renders "No parameters." for empty-object schemas and omits the table
 * entirely for missing entries, which is harder to notice. Those tools are
 * therefore in ALL_INPUT_SCHEMAS rather than an allowlist here.
 *
 * @see src/tools/allInputSchemas.ts — central schema registry
 * @see src/tools/allDescriptions.ts — central description registry
 * @see scripts/generate-tool-docs.ts — consumer that triggered this guard
 */

import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTIONS } from "./allDescriptions.js";
import { ALL_INPUT_SCHEMAS } from "./allInputSchemas.js";

describe("ALL_INPUT_SCHEMAS completeness", () => {
  it("every tool in ALL_TOOL_DESCRIPTIONS has an entry in ALL_INPUT_SCHEMAS", () => {
    const described = Object.keys(ALL_TOOL_DESCRIPTIONS).sort();
    const withSchema = new Set(Object.keys(ALL_INPUT_SCHEMAS));

    const missing = described.filter((name) => !withSchema.has(name));

    expect(
      missing,
      `Tools in ALL_TOOL_DESCRIPTIONS with no ALL_INPUT_SCHEMAS entry:\n  ${missing.join("\n  ")}\n\n` +
        `Add an entry to src/tools/allInputSchemas.ts for each tool listed above.\n` +
        `Tools with no parameters should use z.object({}).`,
    ).toEqual([]);
  });

  it("registries are both non-empty (guard against accidental empty import)", () => {
    expect(Object.keys(ALL_TOOL_DESCRIPTIONS).length).toBeGreaterThan(0);
    expect(Object.keys(ALL_INPUT_SCHEMAS).length).toBeGreaterThan(0);
  });
});
