/**
 * Unit tests for the task-predicate evaluator.
 *
 * The evaluator is pure, so this file is fixture-driven: build a minimal
 * Task and check that each predicate kind matches the expected outcome.
 */

import { describe, expect, it } from "vitest";

import type { ProjectId, TagId } from "./ids.js";
import type { Task } from "./task.js";

import { evaluatePredicate, type TaskPredicate } from "./taskPredicate.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_aaa" as Task["id"],
    name: "Default name",
    note: null,
    noteHtml: null,
    projectId: null,
    parentId: null,
    tagIds: [],
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    flagged: false,
    completed: false,
    completedAt: null,
    dropped: false,
    droppedAt: null,
    available: true,
    blocked: false,
    sequential: false,
    completedByChildren: false,
    repetition: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

// ---------------------------------------------------------------------------
// title-contains
// ---------------------------------------------------------------------------

describe("evaluatePredicate — title-contains", () => {
  it("matches case-insensitively by default", () => {
    const t = makeTask({ name: "Pay Quarterly Invoice" });
    expect(evaluatePredicate({ kind: "title-contains", value: "invoice" }, t)).toBe(true);
    expect(evaluatePredicate({ kind: "title-contains", value: "INVOICE" }, t)).toBe(true);
  });

  it("respects caseSensitive=true", () => {
    const t = makeTask({ name: "Pay Quarterly Invoice" });
    expect(
      evaluatePredicate({ kind: "title-contains", value: "invoice", caseSensitive: true }, t),
    ).toBe(false);
    expect(
      evaluatePredicate({ kind: "title-contains", value: "Invoice", caseSensitive: true }, t),
    ).toBe(true);
  });

  it("does not match when the needle is absent", () => {
    const t = makeTask({ name: "Buy groceries" });
    expect(evaluatePredicate({ kind: "title-contains", value: "invoice" }, t)).toBe(false);
  });

  it("matches the empty string vacuously", () => {
    const t = makeTask({ name: "Anything" });
    expect(evaluatePredicate({ kind: "title-contains", value: "" }, t)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tag
// ---------------------------------------------------------------------------

describe("evaluatePredicate — tag", () => {
  it("matches when the task carries the tag", () => {
    const tagId = "tag_finance" as TagId;
    const t = makeTask({ tagIds: [tagId] });
    expect(evaluatePredicate({ kind: "tag", tagId }, t)).toBe(true);
  });

  it("does not match when the task has a different tag", () => {
    const tagId = "tag_finance" as TagId;
    const otherTag = "tag_health" as TagId;
    const t = makeTask({ tagIds: [otherTag] });
    expect(evaluatePredicate({ kind: "tag", tagId }, t)).toBe(false);
  });

  it("does not match when the task is untagged", () => {
    const tagId = "tag_finance" as TagId;
    expect(evaluatePredicate({ kind: "tag", tagId }, makeTask({ tagIds: [] }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------

describe("evaluatePredicate — project", () => {
  it("matches when the task lives in the given project", () => {
    const projectId = "proj_alpha" as ProjectId;
    const t = makeTask({ projectId });
    expect(evaluatePredicate({ kind: "project", projectId }, t)).toBe(true);
  });

  it("does not match an inbox task (projectId null)", () => {
    const projectId = "proj_alpha" as ProjectId;
    const t = makeTask({ projectId: null });
    expect(evaluatePredicate({ kind: "project", projectId }, t)).toBe(false);
  });

  it("does not match a different project", () => {
    const projectId = "proj_alpha" as ProjectId;
    const other = "proj_beta" as ProjectId;
    const t = makeTask({ projectId: other });
    expect(evaluatePredicate({ kind: "project", projectId }, t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boolean composition
// ---------------------------------------------------------------------------

describe("evaluatePredicate — and / or / not", () => {
  const t = makeTask({
    name: "Pay invoice",
    tagIds: ["tag_finance" as TagId],
    projectId: "proj_alpha" as ProjectId,
  });

  it("and: every child must match", () => {
    const p: TaskPredicate = {
      kind: "and",
      predicates: [
        { kind: "title-contains", value: "invoice" },
        { kind: "tag", tagId: "tag_finance" as TagId },
      ],
    };
    expect(evaluatePredicate(p, t)).toBe(true);

    const failingAnd: TaskPredicate = {
      kind: "and",
      predicates: [
        { kind: "title-contains", value: "invoice" },
        { kind: "tag", tagId: "tag_other" as TagId },
      ],
    };
    expect(evaluatePredicate(failingAnd, t)).toBe(false);
  });

  it("and: empty predicate list matches vacuously", () => {
    expect(evaluatePredicate({ kind: "and", predicates: [] }, t)).toBe(true);
  });

  it("or: any child match suffices", () => {
    const p: TaskPredicate = {
      kind: "or",
      predicates: [
        { kind: "title-contains", value: "groceries" },
        { kind: "tag", tagId: "tag_finance" as TagId },
      ],
    };
    expect(evaluatePredicate(p, t)).toBe(true);

    const failing: TaskPredicate = {
      kind: "or",
      predicates: [
        { kind: "title-contains", value: "groceries" },
        { kind: "tag", tagId: "tag_other" as TagId },
      ],
    };
    expect(evaluatePredicate(failing, t)).toBe(false);
  });

  it("or: empty predicate list does not match (vacuously false)", () => {
    expect(evaluatePredicate({ kind: "or", predicates: [] }, t)).toBe(false);
  });

  it("not: inverts the inner result", () => {
    expect(
      evaluatePredicate(
        { kind: "not", predicate: { kind: "title-contains", value: "groceries" } },
        t,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { kind: "not", predicate: { kind: "title-contains", value: "invoice" } },
        t,
      ),
    ).toBe(false);
  });

  it("nested compositions evaluate correctly (AC fixture: invoice but not @finance)", () => {
    const tagged = makeTask({
      name: "Pay invoice",
      tagIds: ["tag_finance" as TagId],
    });
    const untagged = makeTask({
      name: "Pay invoice",
      tagIds: [],
    });

    const p: TaskPredicate = {
      kind: "and",
      predicates: [
        { kind: "title-contains", value: "invoice" },
        { kind: "not", predicate: { kind: "tag", tagId: "tag_finance" as TagId } },
      ],
    };
    expect(evaluatePredicate(p, tagged)).toBe(false);
    expect(evaluatePredicate(p, untagged)).toBe(true);
  });
});
