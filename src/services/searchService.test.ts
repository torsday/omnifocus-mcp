/**
 * Tests for SearchService pagination ordering.
 *
 * Pins that the page sort and the cursor predicate (`isAfterCursor`) use the
 * SAME comparator — code-unit order, not ICU collation. OmniFocus persistent
 * ids are mixed-case base62 and createdAt ties are routine (e.g. after
 * task_batch_create); a localeCompare sort ('a1' < 'B1') paired with a
 * code-unit cursor predicate ('B1' < 'a1') silently drops or duplicates
 * results across page boundaries.
 */

import { describe, expect, it } from "vitest";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { TaskId } from "../domain/ids.js";
import type { Task } from "../domain/task.js";
import { SearchService } from "./searchService.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Omit<Task, "id">> & { id: string }): Task {
  return {
    name: "match me",
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
    id: TaskId.of(overrides.id) as Task["id"],
  };
}

/** Stub adapter — SearchService only calls `searchTasks`. */
function makeService(tasks: Task[]) {
  const adapter = {
    searchTasks: async () => tasks,
  } as unknown as OmniFocusAdapter;
  return new SearchService({ adapter });
}

// ---------------------------------------------------------------------------
// Sort / cursor-predicate consistency
// ---------------------------------------------------------------------------

describe("SearchService.search — sort matches cursor predicate (code units)", () => {
  // Tied createdAt; ids diverge between ICU collation ('a…' < 'B…') and
  // code-unit order ('B…' < 'a…').
  const tied = [makeTask({ id: "aQzR7tK2mXp" }), makeTask({ id: "BQzR7tK2mXp" })];

  it("orders case-divergent ids by code unit on createdAt ties", async () => {
    const service = makeService(tied);
    const { tasks } = await service.search({ q: "match", limit: 10 });
    expect(tasks.map((t) => t.id)).toEqual(["BQzR7tK2mXp", "aQzR7tK2mXp"]);
  });

  it("pages across a createdAt tie with no skipped or duplicated results", async () => {
    const service = makeService(tied);

    const page1 = await service.search({ q: "match", limit: 1 });
    expect(page1.tasks.map((t) => t.id)).toEqual(["BQzR7tK2mXp"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.search({
      q: "match",
      limit: 1,
      cursor: page1.nextCursor as string,
    });
    expect(page2.tasks.map((t) => t.id)).toEqual(["aQzR7tK2mXp"]);
    expect(page2.hasMore).toBe(false);
  });
});
