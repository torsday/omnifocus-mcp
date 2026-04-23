/**
 * Snapshot tests for all tool descriptions.
 *
 * These snapshots catch accidental drift in tool descriptions that might
 * confuse agents. Per DESIGN §19.
 *
 * To update snapshots after an intentional description change:
 *   pnpm test -- --update-snapshots
 */

import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTIONS } from "./allDescriptions.js";

describe("tool descriptions — snapshot", () => {
  it("all descriptions match their committed snapshots", () => {
    // Snapshot the entire map so any description change shows a clear diff.
    expect(ALL_TOOL_DESCRIPTIONS).toMatchSnapshot();
  });

  // Individual snapshots per tool so diffs are scoped to one tool at a time.
  for (const [toolName, description] of Object.entries(ALL_TOOL_DESCRIPTIONS)) {
    it(`${toolName} description matches snapshot`, () => {
      expect(description).toMatchSnapshot();
    });
  }
});
