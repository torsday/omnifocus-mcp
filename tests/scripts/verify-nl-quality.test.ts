/**
 * Unit tests for the NL-quality lint script (#564).
 *
 * Exercises `checkFileContent` directly with fixture strings — no filesystem
 * setup required, no AST dependencies beyond the script itself.
 */

import { describe, expect, it } from "vitest";

import { checkFileContent } from "../../scripts/verify-nl-quality.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Conformant tool — passes both rules. */
const CONFORMANT = `
import { z } from "zod";

export const FOO_DESCRIPTION =
  "Do the thing. Use this tool when you need the thing done in a real workflow context. " +
  "Do NOT use this for the other thing — call bar instead, since bar handles the other shape. " +
  "Returns { ok: true }. Read-only; safe to retry. " +
  'Example: { "id": "task_001" }';

export const fooInputSchema = z.object({
  id: z.string().describe("Persistent ID. Get from list."),
  flag: z.boolean().optional().describe("When true, do the alt path."),
});
`;

/** Description below 200 chars and missing Example: */
const SHORT_DESCRIPTION = `
export const SHORT_DESCRIPTION =
  "Brief description.";
`;

/** Description that's long enough but missing Example: */
const NO_EXAMPLE = `
export const NO_EXAMPLE_DESCRIPTION =
  "This description is more than 200 chars long but does not include the worked-call template " +
  "the rubric requires. The agent has to compose its first call from the schema alone instead of " +
  "having a concrete shape to follow. Returns nothing. Read-only.";
`;

/** Computed description that the lint can't statically verify. */
const COMPUTED_DESCRIPTION = `
export const COMPUTED_DESCRIPTION = buildDescription();
`;

/** Schema with a bare field missing .describe(). */
const MISSING_DESCRIBE = `
import { z } from "zod";

export const fooInputSchema = z.object({
  id: z.string().describe("OK"),
  bare: z.boolean(),
});
`;

/** Schema field with .describe() chained after .optional() — should pass. */
const DESCRIBE_AFTER_OPTIONAL = `
import { z } from "zod";

export const fooInputSchema = z.object({
  flag: z.boolean().optional().describe("documented"),
});
`;

/** Refined schema (z.object(...).refine(...)) — should still scan its z.object literal. */
const REFINED_SCHEMA = `
import { z } from "zod";

export const fooInputSchema = z
  .object({
    id: z.string().describe("ok"),
    naked: z.string(),
  })
  .refine((v) => true);
`;

/** Schemas that aren't z.object literals (e.g. extending another) — out of scope, no false-positive. */
const NON_LITERAL_SCHEMA = `
import { Base } from "./base.js";

export const fooInputSchema = Base.extend({});
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkFileContent — description-floor rule", () => {
  it("passes a conformant tool with no violations", () => {
    expect(checkFileContent("fixture.ts", CONFORMANT)).toEqual([]);
  });

  it("flags a description that is too short and missing Example:", () => {
    const v = checkFileContent("fixture.ts", SHORT_DESCRIPTION);
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.rule === "description-floor")).toBe(true);
    expect(v.some((x) => x.message.includes("chars"))).toBe(true);
    expect(v.some((x) => x.message.includes("Example:"))).toBe(true);
  });

  it("flags a long description still missing Example:", () => {
    const v = checkFileContent("fixture.ts", NO_EXAMPLE);
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("description-floor");
    expect(v[0]?.message).toMatch(/Example:/);
  });

  it("flags a computed description as unlinted-and-thus-violating", () => {
    const v = checkFileContent("fixture.ts", COMPUTED_DESCRIPTION);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toMatch(/not a static string literal/);
  });
});

describe("checkFileContent — zod-describe rule", () => {
  it("flags a Zod field missing .describe()", () => {
    const v = checkFileContent("fixture.ts", MISSING_DESCRIBE);
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("zod-describe");
    expect(v[0]?.message).toMatch(/bare/);
  });

  it("accepts .describe() chained after .optional()", () => {
    expect(checkFileContent("fixture.ts", DESCRIBE_AFTER_OPTIONAL)).toEqual([]);
  });

  it("scans z.object inside a refined schema", () => {
    const v = checkFileContent("fixture.ts", REFINED_SCHEMA);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toMatch(/naked/);
  });

  it("does not flag schemas that aren't a z.object literal (e.g. .extend)", () => {
    expect(checkFileContent("fixture.ts", NON_LITERAL_SCHEMA)).toEqual([]);
  });
});

describe("checkFileContent — file path propagates", () => {
  it("uses the supplied path in violation reports", () => {
    const v = checkFileContent("src/tools/foo.ts", SHORT_DESCRIPTION);
    expect(v.every((x) => x.file === "src/tools/foo.ts")).toBe(true);
  });
});
