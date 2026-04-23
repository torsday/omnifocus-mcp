/**
 * Tool-description shape checker.
 *
 * Per DESIGN.md §6.8, every tool description must answer four questions:
 *   1. What it does (the opening sentence — always present when non-empty)
 *   2. When NOT to use it (disambiguation from sibling tools)
 *   3. What it returns (shape of the data field)
 *   4. Side effects (mutates? caches? safe to retry?)
 *
 * This module provides the checker function used by the lint test
 * (src/tools/descriptionShape.test.ts) which runs in CI.
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Matches a when-not clause.
 * Accepts: "Do NOT", "Do not", "prefer <X>", "<X> instead".
 */
const WHEN_NOT_RE = /do not\b|prefer\b|instead\b/i;

/**
 * Matches a returns clause.
 * Accepts: "Returns", "Return".
 */
const RETURNS_RE = /returns?\b/i;

/**
 * Matches a side-effects clause.
 * Accepts: "Side effects", "side-effects", "safe to", "read-only",
 * "no side effects", "writes to", "Triggers a sync", "mutations do not".
 */
const SIDE_EFFECTS_RE =
  /side.effects?|safe to\b|read.only|no side|writes to\b|triggers a sync|mutations? do not/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Describes a missing section in a tool description.
 * Value is a human-readable label for reporting.
 */
export type MissingSection = "when-not" | "returns" | "side-effects";

export interface DescriptionShapeResult {
  /** Tool name (e.g. "task_list") */
  name: string;
  /** Raw description string */
  description: string;
  /** Sections absent from the description. Empty means the description passes. */
  missing: MissingSection[];
}

/**
 * Check whether `description` satisfies the DESIGN §6.8 four-section shape.
 *
 * @param name - Tool name, used for reporting only.
 * @param description - The tool's description string to lint.
 * @returns A result object; `missing` is empty when the description passes.
 */
export function checkDescriptionShape(name: string, description: string): DescriptionShapeResult {
  const missing: MissingSection[] = [];

  if (!WHEN_NOT_RE.test(description)) missing.push("when-not");
  if (!RETURNS_RE.test(description)) missing.push("returns");
  if (!SIDE_EFFECTS_RE.test(description)) missing.push("side-effects");

  return { name, description, missing };
}

/**
 * Format a list of shape results as a human-readable report.
 * Returns an empty string when there are no violations.
 */
export function formatShapeViolations(results: DescriptionShapeResult[]): string {
  const violations = results.filter((r) => r.missing.length > 0);
  if (violations.length === 0) return "";

  const lines: string[] = [
    `${violations.length} tool description(s) violate the DESIGN §6.8 shape:`,
    "",
  ];
  for (const v of violations) {
    lines.push(`  • ${v.name}: missing ${v.missing.join(", ")}`);
  }
  lines.push(
    "",
    "Each description must contain:",
    "  - a when-not clause (Do NOT / prefer / instead)",
    "  - a returns clause  (Returns ...)",
    "  - a side-effects clause (Side effects: / safe to / no side effects / Triggers a sync / ...)",
  );
  return lines.join("\n");
}
