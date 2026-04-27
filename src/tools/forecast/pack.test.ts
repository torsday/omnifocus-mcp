/**
 * Unit tests for the pure `pack()` algorithm.
 *
 * The handler / tool wiring is integration-tested elsewhere; these tests
 * pin the deterministic pack semantics: sort key, budget enforcement,
 * skip taxonomy, filter behavior.
 */

import { describe, expect, it } from "vitest";
import type { TagId, TaskId } from "../../domain/ids.js";
import { TagId as TagIdCtor, TaskId as TaskIdCtor } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { pack, packCompareTasks } from "./pack.js";

const NOW = "2026-01-01T00:00:00.000Z";

const T = {
  a: TaskIdCtor.of("task-aaa"),
  b: TaskIdCtor.of("task-bbb"),
  c: TaskIdCtor.of("task-ccc"),
  d: TaskIdCtor.of("task-ddd"),
  e: TaskIdCtor.of("task-eee"),
};

const TAG = {
  deep: TagIdCtor.of("tag-deep"),
  errand: TagIdCtor.of("tag-errand"),
};

function makeTask(overrides: Partial<Task> & { id: TaskId }): Task {
  return {
    name: "Task",
    note: null,
    noteHtml: null,
    projectId: null,
    parentId: null,
    tagIds: [] as TagId[],
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
    createdAt: NOW,
    modifiedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// packCompareTasks — sort key
// ---------------------------------------------------------------------------

describe("packCompareTasks", () => {
  it("flagged tasks sort before unflagged", () => {
    const flagged = makeTask({ id: T.a, flagged: true });
    const plain = makeTask({ id: T.b, flagged: false });
    expect(packCompareTasks(flagged, plain)).toBeLessThan(0);
    expect(packCompareTasks(plain, flagged)).toBeGreaterThan(0);
  });

  it("within the same flagged tier, earlier dueDate sorts first", () => {
    const earlier = makeTask({ id: T.a, dueDate: "2026-01-01T00:00:00.000Z" });
    const later = makeTask({ id: T.b, dueDate: "2026-02-01T00:00:00.000Z" });
    expect(packCompareTasks(earlier, later)).toBeLessThan(0);
  });

  it("null dueDate sorts after non-null within the same flagged tier", () => {
    const dated = makeTask({ id: T.a, dueDate: "2026-01-01T00:00:00.000Z" });
    const undated = makeTask({ id: T.b, dueDate: null });
    expect(packCompareTasks(dated, undated)).toBeLessThan(0);
    expect(packCompareTasks(undated, dated)).toBeGreaterThan(0);
  });

  it("ties break stably by task ID", () => {
    const a = makeTask({ id: T.a });
    const b = makeTask({ id: T.b });
    expect(packCompareTasks(a, b)).toBeLessThan(0);
    expect(packCompareTasks(b, a)).toBeGreaterThan(0);
    expect(packCompareTasks(a, a)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pack — budget enforcement
// ---------------------------------------------------------------------------

describe("pack — budget enforcement", () => {
  it("selects tasks until adding the next one would exceed the budget", () => {
    // Budget 60: pick 30 + 20 = 50; next is 30, 50+30=80 > 60 → skip
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, dueDate: "2026-01-01T09:00:00Z" }),
      makeTask({ id: T.b, estimatedMinutes: 20, dueDate: "2026-01-01T10:00:00Z" }),
      makeTask({ id: T.c, estimatedMinutes: 30, dueDate: "2026-01-01T11:00:00Z" }),
    ];
    const result = pack(tasks, 60);

    expect(result.selected.map((t) => t.taskId)).toEqual([T.a, T.b]);
    expect(result.totalMinutes).toBe(50);
    expect(result.skipped).toEqual([
      { taskId: T.c, name: "Task", estimatedMinutes: 30, reason: "exceeds-budget" },
    ]);
  });

  it("packs zero tasks when budget is smaller than every estimate", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30 }),
      makeTask({ id: T.b, estimatedMinutes: 60 }),
    ];
    const result = pack(tasks, 15);
    expect(result.selected).toEqual([]);
    expect(result.totalMinutes).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["exceeds-budget", "exceeds-budget"]);
  });

  it("packs every task when budget exceeds total", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 10 }),
      makeTask({ id: T.b, estimatedMinutes: 20 }),
    ];
    const result = pack(tasks, 1000);
    expect(result.selected.map((t) => t.taskId)).toEqual([T.a, T.b]);
    expect(result.totalMinutes).toBe(30);
    expect(result.skipped).toEqual([]);
  });

  it("respects the budget exactly when totals tie", () => {
    // 30 + 30 = 60 fits a budget of 60 (≤, not <)
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30 }),
      makeTask({ id: T.b, estimatedMinutes: 30 }),
    ];
    const result = pack(tasks, 60);
    expect(result.selected).toHaveLength(2);
    expect(result.totalMinutes).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// pack — skip taxonomy
// ---------------------------------------------------------------------------

describe("pack — skip taxonomy", () => {
  it("surfaces tasks without estimatedMinutes under reason: 'no-estimate'", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30 }),
      makeTask({ id: T.b, estimatedMinutes: null, name: "Mystery" }),
    ];
    const result = pack(tasks, 60);
    expect(result.selected.map((t) => t.taskId)).toEqual([T.a]);
    expect(result.skipped).toEqual([
      { taskId: T.b, name: "Mystery", estimatedMinutes: null, reason: "no-estimate" },
    ]);
  });

  it("no-estimate skip is independent of budget — still skipped even when budget is huge", () => {
    const tasks = [makeTask({ id: T.a, estimatedMinutes: null })];
    const result = pack(tasks, 999999);
    expect(result.selected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("no-estimate");
  });
});

// ---------------------------------------------------------------------------
// pack — sort + budget interaction
// ---------------------------------------------------------------------------

describe("pack — sort + budget interaction", () => {
  it("flagged tasks pack first, bumping unflagged into skipped even when smaller", () => {
    // Unflagged 10-min task would otherwise fit; flagged 60-min consumes the budget first
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 10, flagged: false }),
      makeTask({ id: T.b, estimatedMinutes: 60, flagged: true }),
    ];
    const result = pack(tasks, 60);
    expect(result.selected.map((t) => t.taskId)).toEqual([T.b]);
    expect(result.skipped[0]).toEqual({
      taskId: T.a,
      name: "Task",
      estimatedMinutes: 10,
      reason: "exceeds-budget",
    });
  });

  it("earlier dueDate beats later within the same flagged tier", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, dueDate: "2026-02-01T00:00:00Z" }),
      makeTask({ id: T.b, estimatedMinutes: 30, dueDate: "2026-01-01T00:00:00Z" }),
    ];
    const result = pack(tasks, 30);
    // Only one fits; the earlier-due one must win
    expect(result.selected.map((t) => t.taskId)).toEqual([T.b]);
  });
});

// ---------------------------------------------------------------------------
// pack — filter
// ---------------------------------------------------------------------------

describe("pack — tag filter", () => {
  it("restricts candidates to tasks bearing at least one of the supplied tagIds", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, tagIds: [TAG.deep] }),
      makeTask({ id: T.b, estimatedMinutes: 30, tagIds: [TAG.errand] }),
      makeTask({ id: T.c, estimatedMinutes: 30, tagIds: [TAG.deep, TAG.errand] }),
    ];
    const result = pack(tasks, 1000, { tagIds: [TAG.deep] });
    expect(result.selected.map((t) => t.taskId).sort()).toEqual([T.a, T.c].sort());
  });

  it("filtered-out tasks do NOT appear in skipped — they aren't candidates", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, tagIds: [TAG.deep] }),
      makeTask({ id: T.b, estimatedMinutes: 30, tagIds: [TAG.errand] }),
    ];
    const result = pack(tasks, 1000, { tagIds: [TAG.deep] });
    expect(result.skipped).toEqual([]);
    expect(result.selected).toHaveLength(1);
  });

  it("empty tagIds filter is a no-op", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, tagIds: [TAG.deep] }),
      makeTask({ id: T.b, estimatedMinutes: 30, tagIds: [] }),
    ];
    const result = pack(tasks, 1000, { tagIds: [] });
    expect(result.selected).toHaveLength(2);
  });

  it("undefined filter is a no-op", () => {
    const tasks = [makeTask({ id: T.a, estimatedMinutes: 30, tagIds: [TAG.deep] })];
    const result = pack(tasks, 1000);
    expect(result.selected).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// pack — edge cases
// ---------------------------------------------------------------------------

describe("pack — edge cases", () => {
  it("empty input returns empty result", () => {
    const result = pack([], 60);
    expect(result).toEqual({ selected: [], totalMinutes: 0, skipped: [] });
  });

  it("output shape is fully deterministic for identical input", () => {
    const tasks = [
      makeTask({ id: T.a, estimatedMinutes: 30, flagged: true, dueDate: "2026-01-01T09:00:00Z" }),
      makeTask({ id: T.b, estimatedMinutes: 20, flagged: false }),
      makeTask({ id: T.c, estimatedMinutes: null }),
    ];
    const a = pack(tasks, 60);
    const b = pack(tasks, 60);
    expect(a).toEqual(b);
  });
});
