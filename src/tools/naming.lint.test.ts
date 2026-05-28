/**
 * Tool-name verb-consistency lint — CI gate (#837).
 *
 * Tool names follow a canonical `<resource>_<verb>[_<qualifier>]` grammar so the
 * agent can apply a pattern instead of memorising a verb-per-resource. The
 * canonical verb vocabulary is documented in `docs/design/tool-vocabulary.md`.
 *
 * This lint is the *active counter-pressure*: it fails CI when a tool name uses
 * a non-canonical synonym of an approved verb (e.g. `add` instead of `create`,
 * `remove` instead of `delete`). It does not try to validate the entire grammar
 * — that would be brittle across 143 heterogeneous tools — it targets the
 * specific drift #837 calls out: synonym verbs that mean the same action.
 *
 * To fix a violation: rename the tool to use the canonical verb (a breaking
 * change — plan a deprecation window), or, for a legitimate non-CRUD use of the
 * word, add a documented entry to {@link VERB_SYNONYM_EXCEPTIONS}.
 *
 * @see docs/design/tool-vocabulary.md — the canonical vocabulary
 * @see src/tools/descriptions.lint.test.ts — sibling lint for descriptions
 */

import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTIONS } from "./allDescriptions.js";

/**
 * Non-canonical verb tokens mapped to the canonical verb they should be. A tool
 * name containing one of these underscore-delimited tokens fails the lint unless
 * it is listed in {@link VERB_SYNONYM_EXCEPTIONS}.
 */
const BANNED_VERB_SYNONYMS: Readonly<Record<string, string>> = {
  add: "create",
  remove: "delete",
  new: "create",
  destroy: "delete",
  fetch: "get",
  modify: "update",
  edit: "update",
  rename: "update",
};

/**
 * Tool names exempt from a specific banned-token rule, each with a reason.
 *
 * Keep this list short and justified. Two kinds of entry:
 *  - **Legitimate non-CRUD use**: the word isn't acting as a CRUD verb.
 *  - **Legacy outlier pending rename**: tracked by a breaking follow-up issue;
 *    remove the entry when the rename lands.
 */
const VERB_SYNONYM_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  // `new` here means "open a new window/tab" — a UI surface action, not the
  // creation of a persisted domain object, so `create` would be misleading.
  ["app_window_new", "UI action: opens a new window (not domain CRUD)"],
  ["app_window_new_tab", "UI action: opens a new tab (not domain CRUD)"],
  // Legacy outliers: should be attachment_create / attachment_delete. Rename is
  // a breaking change tracked in a follow-up (deprecation window required).
  ["attachment_add", "legacy outlier — rename to attachment_create tracked in follow-up"],
  ["attachment_remove", "legacy outlier — rename to attachment_delete tracked in follow-up"],
]);

/** Split a tool name into its underscore-delimited tokens. */
function tokensOf(toolName: string): string[] {
  return toolName.split("_");
}

describe("tool names — verb-consistency lint (#837)", () => {
  it("no tool name uses a non-canonical verb synonym", () => {
    const violations: string[] = [];

    for (const name of Object.keys(ALL_TOOL_DESCRIPTIONS)) {
      if (VERB_SYNONYM_EXCEPTIONS.has(name)) continue;
      for (const token of tokensOf(name)) {
        const canonical = BANNED_VERB_SYNONYMS[token];
        if (canonical !== undefined) {
          violations.push(`  ${name}: uses "${token}" — canonical verb is "${canonical}"`);
          break;
        }
      }
    }

    const report =
      violations.length === 0
        ? ""
        : [
            "Non-canonical verb(s) found in tool names. Use the canonical verb",
            "(see docs/design/tool-vocabulary.md), or add a justified exception",
            "to VERB_SYNONYM_EXCEPTIONS in this file:",
            ...violations,
          ].join("\n");

    expect(report, report).toBe("");
  });

  it("every exception still corresponds to a real tool (no stale entries)", () => {
    const stale = [...VERB_SYNONYM_EXCEPTIONS.keys()].filter(
      (name) => !(name in ALL_TOOL_DESCRIPTIONS),
    );
    expect(stale, `stale VERB_SYNONYM_EXCEPTIONS entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("registry is non-empty (guard against accidental empty import)", () => {
    expect(Object.keys(ALL_TOOL_DESCRIPTIONS).length).toBeGreaterThan(0);
  });
});
