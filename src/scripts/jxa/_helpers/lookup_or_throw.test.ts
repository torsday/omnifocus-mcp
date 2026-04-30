/**
 * Unit tests for the lookupOrThrow JXA helper (#687).
 *
 * The helper is a raw-JS function inlined into JXA consumer scripts via the
 * scriptInlinerPlugin (ADR-0020). It runs inside `osascript`, not Node — so
 * we can't import it as a module. Instead we read the source file and eval
 * it into a closure that exposes the function for direct invocation.
 *
 * What we're verifying:
 *   1. Returns the specifier unchanged when `.id()` succeeds.
 *   2. Throws `<Kind> not found: <id>` when `.id()` throws.
 *   3. Preserves the kindLabel and idValue verbatim — important for the
 *      stderr classifier in `scriptRunner.ts` that maps "<X> not found:"
 *      to typed `NotFound` errors.
 *   4. Supports the batch-script kindLabel form (`OF_NOT_FOUND: <kind>`)
 *      so the existing per-item errorCode regex `^(OF_[A-Z_]+):` still
 *      extracts `OF_NOT_FOUND`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(resolve(__dirname, "lookup_or_throw.js"), "utf8");

/**
 * Eval the helper source into a closure and return the function. We can't
 * use `import` because the file isn't an ES module — it's raw JS spliced
 * into JXA consumer scripts.
 */
function loadHelper(): (specifier: unknown, kindLabel: string, idValue: string) => unknown {
  // biome-ignore lint/security/noGlobalEval: test-only — exercising the helper string in isolation.
  return eval(`(function() { ${helperSource}; return lookupOrThrow; })()`);
}

describe("lookupOrThrow (JXA helper, #687)", () => {
  const lookupOrThrow = loadHelper();

  it("returns the specifier when .id() succeeds", () => {
    const specifier = { id: () => "abc-123" };
    expect(lookupOrThrow(specifier, "Project", "abc-123")).toBe(specifier);
  });

  it("throws `<Kind> not found: <id>` when .id() throws", () => {
    const specifier = {
      id: () => {
        throw new Error("Can't get object. (-1728)");
      },
    };
    expect(() => lookupOrThrow(specifier, "Project", "missing-xyz")).toThrow(
      "Project not found: missing-xyz",
    );
  });

  it("preserves the exact kindLabel for the stderr classifier", () => {
    // The classifier regex in scriptRunner.ts is `\bnot found\b` — any of
    // these labels must produce a message that matches.
    const specifier = {
      id: () => {
        throw new Error("(-1728)");
      },
    };
    for (const label of ["Project", "Task", "Folder", "Tag", "Parent task", "Reference task"]) {
      expect(() => lookupOrThrow(specifier, label, "id1")).toThrow(`${label} not found: id1`);
    }
  });

  it("supports the batch-script `OF_NOT_FOUND:` prefix form", () => {
    // Batch scripts (task_batch_*) feed the helper a kindLabel that already
    // contains the OF_NOT_FOUND prefix. The per-item handler in those
    // scripts extracts errorCode via `^(OF_[A-Z_]+):` — the resulting
    // message must still match.
    const specifier = {
      id: () => {
        throw new Error("(-1728)");
      },
    };
    let caught: Error | null = null;
    try {
      lookupOrThrow(specifier, "OF_NOT_FOUND: task", "missing-task-id");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toBe("OF_NOT_FOUND: task not found: missing-task-id");
    // The errorCode-extraction regex used in batch scripts.
    const m = caught?.message.match(/^(OF_[A-Z_]+):/);
    expect(m?.[1]).toBe("OF_NOT_FOUND");
  });

  it("includes the idValue in the message so triage points at the bad input", () => {
    const specifier = {
      id: () => {
        throw new Error("nope");
      },
    };
    expect(() => lookupOrThrow(specifier, "Project", "prj_specific-id_42")).toThrow(
      /prj_specific-id_42$/,
    );
  });
});
