/**
 * Integration tests: zodToActionable boundary error rewriting across real tool schemas.
 *
 * Verifies that bad inputs against live tool schemas produce structured
 * `failures[]` rows that agents can iterate to fix their call without
 * another round-trip. The contract: every ValidationError carries
 * `details.failures[]` where each row has `field`, `sent`, and `expected`,
 * plus `examples` where the format or enum set makes it useful.
 *
 * @see src/errors/zodToActionable.ts — the rewriting helper
 * @see docs/nl-quality-standards.md §5 — fail-with-help errors
 * @see #565 — this test file
 */

import { describe, expect, it } from "vitest";
import type { ZodError } from "zod";
import { noteSetInputSchema as noteSetInputBaseSchema } from "../tools/note/set.js";
import { taskBatchAssignInputSchema } from "../tools/task/batchAssign.js";
import { taskBatchCreateInputBaseSchema } from "../tools/task/batchCreate.js";
import { taskBatchUpdateInputBaseSchema } from "../tools/task/batchUpdate.js";
import { taskListInputSchema as taskListInputBaseSchema } from "../tools/task/list.js";
import { ValidationError } from "./index.js";
import { validateRefined } from "./validateRefined.js";
import { type ActionableValidation, zodToActionable } from "./zodToActionable.js";

// ---------------------------------------------------------------------------
// Helper: parse a schema with bad input, assert ZodError, run zodToActionable.
// ---------------------------------------------------------------------------

function parseFailures(
  schema: { safeParse(v: unknown): { success: boolean; error?: ZodError } },
  input: unknown,
): ActionableValidation[] {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("Expected parse to fail, but it succeeded");
  return zodToActionable(result.error as ZodError, input);
}

function assertFailure(failures: ActionableValidation[]): void {
  expect(failures.length).toBeGreaterThan(0);
  for (const f of failures) {
    expect(f).toHaveProperty("field");
    expect(f).toHaveProperty("sent");
    expect(f).toHaveProperty("expected");
    expect(typeof f.field).toBe("string");
    expect(typeof f.expected).toBe("string");
    expect(f.field.length).toBeGreaterThan(0);
    expect(f.expected.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Missing required field — task_batch_create: name omitted
// ---------------------------------------------------------------------------

describe("missing required field — task_batch_create items[0].name", () => {
  it("produces a failure with field=items[0].name and sent=undefined", () => {
    const failures = parseFailures(taskBatchCreateInputBaseSchema, {
      items: [{ note: "no name supplied" }],
    });
    assertFailure(failures);
    const nameFail = failures.find((f) => f.field === "items[0].name");
    expect(nameFail).toBeDefined();
    expect(nameFail?.sent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wrong type on an array field — tagIds must be an array, not a string
// ---------------------------------------------------------------------------

describe("wrong type on array — task_batch_create items[0].tagIds", () => {
  it("surfaces invalid_type for tagIds sent as a string", () => {
    const failures = parseFailures(taskBatchCreateInputBaseSchema, {
      items: [{ name: "Task A", tagIds: "not-an-array" }],
    });
    assertFailure(failures);
    const tagFail = failures.find((f) => f.field === "items[0].tagIds");
    expect(tagFail).toBeDefined();
    expect(tagFail?.sent).toBe("not-an-array");
    expect(tagFail?.expected).toMatch(/array/i);
  });
});

// ---------------------------------------------------------------------------
// Bare local-time datetime (no offset) — task_batch_create dueDate
// ---------------------------------------------------------------------------

describe("bare local-time datetime — task_batch_create items[0].dueDate", () => {
  it("rejects a datetime with no UTC offset and provides ISO-8601 examples", () => {
    const failures = parseFailures(taskBatchCreateInputBaseSchema, {
      items: [{ name: "Task B", dueDate: "2025-03-01T10:00:00" }],
    });
    assertFailure(failures);
    const dateFail = failures.find((f) => f.field === "items[0].dueDate");
    expect(dateFail).toBeDefined();
    expect(dateFail?.sent).toBe("2025-03-01T10:00:00");
    expect(dateFail?.expected).toMatch(/ISO-8601|datetime|offset/i);
    expect(dateFail?.examples).toBeDefined();
    expect(Array.isArray(dateFail?.examples)).toBe(true);
    expect(dateFail?.examples?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Out-of-bound numeric — task_list limit: -1 (below min of 1)
// ---------------------------------------------------------------------------

describe("out-of-bound numeric — task_list limit below minimum", () => {
  it("reports too_small with a ≥ 1 expected message", () => {
    const failures = parseFailures(taskListInputBaseSchema, { limit: -1 });
    assertFailure(failures);
    const limitFail = failures.find((f) => f.field === "limit");
    expect(limitFail).toBeDefined();
    expect(limitFail?.sent).toBe(-1);
    expect(limitFail?.expected).toMatch(/≥\s*1|at least 1/i);
  });

  it("reports too_big with a ≤ 1000 expected message for limit: 99999", () => {
    const failures = parseFailures(taskListInputBaseSchema, { limit: 99999 });
    assertFailure(failures);
    const limitFail = failures.find((f) => f.field === "limit");
    expect(limitFail).toBeDefined();
    expect(limitFail?.sent).toBe(99999);
    expect(limitFail?.expected).toMatch(/≤\s*1000|at most 1000/i);
  });
});

// ---------------------------------------------------------------------------
// Out-of-bound numeric — task_batch_update estimatedMinutes: 0 (must be positive)
// ---------------------------------------------------------------------------

describe("out-of-bound numeric — task_batch_update estimatedMinutes not positive", () => {
  it("rejects estimatedMinutes: 0 and reports a bound failure", () => {
    const failures = parseFailures(taskBatchUpdateInputBaseSchema, {
      items: [{ id: "abc123def456", patch: { estimatedMinutes: 0 } }],
    });
    assertFailure(failures);
    const estFail = failures.find((f) => f.field.includes("estimatedMinutes"));
    expect(estFail).toBeDefined();
    expect(estFail?.sent).toBe(0);
    expect(estFail?.expected).toMatch(/>\s*0|≥\s*1|positive/i);
  });
});

// ---------------------------------------------------------------------------
// Enum mismatch — note_set targetKind: "folder" (not in "task" | "project")
// ---------------------------------------------------------------------------

describe("enum mismatch — note_set targetKind", () => {
  it("lists accepted values and surfaces the bad value in sent", () => {
    const failures = parseFailures(noteSetInputBaseSchema, {
      targetId: "abc123def456",
      targetKind: "folder",
      content: "some note",
    });
    assertFailure(failures);
    const kindFail = failures.find((f) => f.field === "targetKind");
    expect(kindFail).toBeDefined();
    expect(kindFail?.sent).toBe("folder");
    expect(kindFail?.expected).toMatch(/task|project/i);
    expect(kindFail?.examples).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Bad ID format — task_batch_assign taskId that is not valid alphanumeric
// ---------------------------------------------------------------------------

describe("bad ID format — task_batch_assign taskId with spaces", () => {
  it("rejects a taskId containing spaces and reports the offending value", () => {
    const failures = parseFailures(taskBatchAssignInputSchema, {
      assignments: [{ taskId: "bad id here", flagged: true }],
    });
    assertFailure(failures);
    const idFail = failures.find((f) => f.field === "assignments[0].taskId");
    expect(idFail).toBeDefined();
    expect(String(idFail?.sent)).toContain("bad id");
  });
});

// ---------------------------------------------------------------------------
// Empty batch — task_batch_create items must have ≥ 1 item
// ---------------------------------------------------------------------------

describe("empty batch — task_batch_create items array empty", () => {
  it("reports a too_small failure on items[]", () => {
    const failures = parseFailures(taskBatchCreateInputBaseSchema, { items: [] });
    assertFailure(failures);
    const itemsFail = failures.find((f) => f.field === "items");
    expect(itemsFail).toBeDefined();
    expect(itemsFail?.expected).toMatch(/≥\s*1|at least 1/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-field refinement — validateRefined path (task_batch_assign assignment with no fields set)
// The base schema accepts the object; the refinement rejects it.
// We test through validateRefined directly since the SDK strips this guard.
// ---------------------------------------------------------------------------

describe("cross-field refinement via validateRefined — task_batch_assign empty assignment", () => {
  it("throws ValidationError with details.failures when no field is set on an assignment", () => {
    let caught: unknown;
    try {
      validateRefined(taskBatchAssignInputSchema, {
        assignments: [{ taskId: "abc123def456" }],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    if (!(caught instanceof ValidationError)) return;
    expect(caught.code).toBe("OF_VALIDATION");
    const details = caught.details as { failures?: ActionableValidation[] } | undefined;
    expect(details?.failures).toBeDefined();
    expect(Array.isArray(details?.failures)).toBe(true);
    expect((details?.failures ?? []).length).toBeGreaterThan(0);
    const failure = details?.failures?.[0];
    expect(failure).toHaveProperty("field");
    expect(failure).toHaveProperty("expected");
  });
});

// ---------------------------------------------------------------------------
// Envelope shape sanity — every failure row has the required keys
// ---------------------------------------------------------------------------

describe("envelope shape contract — all failure rows are well-formed", () => {
  const badInputCases: Array<[string, typeof taskBatchCreateInputBaseSchema, unknown]> = [
    ["missing name", taskBatchCreateInputBaseSchema, { items: [{ flagged: true }] }],
    [
      "wrong type for flagged",
      taskBatchCreateInputBaseSchema,
      { items: [{ name: "T", flagged: "yes" }] },
    ],
    [
      "bad deferDate",
      taskBatchCreateInputBaseSchema,
      { items: [{ name: "T", deferDate: "not-a-date" }] },
    ],
  ];

  for (const [label, schema, input] of badInputCases) {
    it(`${label}: every row has field + sent + expected`, () => {
      const failures = parseFailures(schema, input);
      expect(failures.length).toBeGreaterThan(0);
      for (const f of failures) {
        expect(f).toHaveProperty("field");
        expect(f).toHaveProperty("sent");
        expect(f).toHaveProperty("expected");
        if (f.examples !== undefined) {
          expect(Array.isArray(f.examples)).toBe(true);
        }
      }
    });
  }
});
