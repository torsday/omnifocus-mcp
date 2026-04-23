/**
 * Property tests for the transport-text parser.
 *
 * Fast-check generates valid transport-text strings from known tokens and
 * asserts that the parser returns the expected structure. The "round-trip"
 * property here means: if we construct a known-valid input, the parser must
 * extract exactly what we put in (no data loss, no mutation).
 *
 * We do NOT do a true encode-then-decode round-trip because the parser is
 * one-way (it reads DSL, not emits it). Instead we verify:
 *   1. Name-only tasks: the parsed name matches the input name exactly.
 *   2. Flag token: `!!` always produces `flagged: true`.
 *   3. Tag tokens: every `@tagname` in the input appears in `tagNames[]`.
 *   4. Note token: `//` remainder becomes the `note` field.
 *   5. Multi-task: N non-empty lines produce N ParsedTask entries.
 *   6. Project: context: the project name propagates to all following tasks.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseTransportText } from "./transportText.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * A "safe" word: letters and digits only, no whitespace or DSL special chars.
 * Keeps generated inputs unambiguous for the parser.
 */
const safeWordArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{1,15}$/);

/** A valid tag name (same safe characters). */
const tagNameArb = safeWordArb;

/** A list of 1–4 unique tag names. */
const tagNamesArb = fc
  .uniqueArray(tagNameArb, { minLength: 1, maxLength: 4 })
  .filter((arr) => arr.length > 0);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("transport-text parser — property tests", () => {
  it("name-only task: parsed name equals input name (trimmed)", () => {
    fc.assert(
      fc.property(safeWordArb, (name) => {
        const result = parseTransportText(name);
        expect(result.tasks).toHaveLength(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(0)!.name).toBe(name);
      }),
      { numRuns: 200 },
    );
  });

  it("!! token always sets flagged: true", () => {
    fc.assert(
      fc.property(safeWordArb, (name) => {
        const result = parseTransportText(`${name} !!`);
        expect(result.tasks).toHaveLength(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(0)!.flagged).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("without !! token, flagged is false or undefined (never true)", () => {
    fc.assert(
      fc.property(safeWordArb, (name) => {
        const result = parseTransportText(name);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(0)!.flagged).toBeFalsy();
      }),
      { numRuns: 200 },
    );
  });

  it("every @tagname in input appears in tagNames[]", () => {
    fc.assert(
      fc.property(safeWordArb, tagNamesArb, (name, tags) => {
        const tagTokens = tags.map((t) => `@${t}`).join(" ");
        const result = parseTransportText(`${name} ${tagTokens}`);
        expect(result.tasks).toHaveLength(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const parsedTags = result.tasks.at(0)!.tagNames ?? [];
        for (const tag of tags) {
          expect(parsedTags).toContain(tag);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("tagNames[] length matches the number of @tokens provided", () => {
    fc.assert(
      fc.property(safeWordArb, tagNamesArb, (name, tags) => {
        const tagTokens = tags.map((t) => `@${t}`).join(" ");
        const result = parseTransportText(`${name} ${tagTokens}`);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const parsedTags = result.tasks.at(0)!.tagNames ?? [];
        expect(parsedTags).toHaveLength(tags.length);
      }),
      { numRuns: 200 },
    );
  });

  it("//note captures everything after the double-slash", () => {
    fc.assert(
      fc.property(safeWordArb, safeWordArb, (name, note) => {
        const result = parseTransportText(`${name} //${note}`);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(0)!.note).toBe(note);
      }),
      { numRuns: 200 },
    );
  });

  it("N non-empty task lines produce N parsed tasks", () => {
    fc.assert(
      fc.property(fc.array(safeWordArb, { minLength: 1, maxLength: 10 }), (names) => {
        const input = names.join("\n");
        const result = parseTransportText(input);
        expect(result.tasks).toHaveLength(names.length);
      }),
      { numRuns: 200 },
    );
  });

  it("Project: context line propagates projectName to all following tasks", () => {
    fc.assert(
      fc.property(
        safeWordArb,
        fc.array(safeWordArb, { minLength: 1, maxLength: 5 }),
        (project, taskNames) => {
          const lines = [`Project: ${project}`, ...taskNames].join("\n");
          const result = parseTransportText(lines);
          expect(result.tasks).toHaveLength(taskNames.length);
          for (const task of result.tasks) {
            expect(task.projectName).toBe(project);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("tasks before Project: line have no projectName", () => {
    fc.assert(
      fc.property(safeWordArb, safeWordArb, safeWordArb, (task1, project, task2) => {
        const lines = [task1, `Project: ${project}`, task2].join("\n");
        const result = parseTransportText(lines);
        expect(result.tasks).toHaveLength(2);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(0)!.projectName).toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(result.tasks.at(1)!.projectName).toBe(project);
      }),
      { numRuns: 200 },
    );
  });

  it("parser never throws on arbitrary non-empty single-line input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (input) => {
        // Should return a result or warnings, never throw
        expect(() => parseTransportText(input)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it("warnings array is always an array (never undefined)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (input) => {
        const result = parseTransportText(input);
        expect(Array.isArray(result.warnings)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
