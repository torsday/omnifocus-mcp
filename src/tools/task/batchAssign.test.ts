/**
 * Unit tests for `task_batch_assign`.
 *
 * Coverage:
 *   - Pure helpers (`applyTagDiff`, `buildPatchForAssignment`)
 *   - Move-only assignments
 *   - Update-only assignments (defer/due/flagged + tag diff)
 *   - Combined move+update assignments
 *   - Failure cascade: a failed move suppresses the update
 *   - Combined outcome maps batch indices back to original-input indices
 *   - Schema-level "at least one field" enforcement
 *   - Registration shape
 */

import { describe, expect, it, vi } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { TagId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";

import {
  applyTagDiff,
  buildPatchForAssignment,
  handleTaskBatchAssign,
  registerTaskBatchAssignTool,
  taskBatchAssignInputSchema,
} from "./batchAssign.js";

const META: ResponseMeta = {
  correlationId: "01TESTBATCHASSIGN",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

function makeCtx(adapter: InMemoryAdapter) {
  return {
    adapter,
    makeMeta: (partial: Partial<ResponseMeta> = {}) => ({ ...META, ...partial }),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("applyTagDiff", () => {
  it("adds new tags, preserves existing", () => {
    const result = applyTagDiff(
      ["tag_aaa", "tag_bbb"] as TagId[],
      ["tag_ccc"] as TagId[],
      undefined,
    );
    expect(new Set(result.map(String))).toEqual(new Set(["tag_aaa", "tag_bbb", "tag_ccc"]));
  });

  it("removes tags from current", () => {
    const result = applyTagDiff(["tag_aaa", "tag_bbb", "tag_ccc"] as TagId[], undefined, [
      "tag_bbb",
    ] as TagId[]);
    expect(new Set(result.map(String))).toEqual(new Set(["tag_aaa", "tag_ccc"]));
  });

  it("when a tag is in both add and remove, remove wins", () => {
    const result = applyTagDiff(
      ["tag_aaa"] as TagId[],
      ["tag_bbb"] as TagId[],
      ["tag_bbb"] as TagId[],
    );
    expect(new Set(result.map(String))).toEqual(new Set(["tag_aaa"]));
  });

  it("de-duplicates tags already present", () => {
    const result = applyTagDiff(
      ["tag_aaa"] as TagId[],
      ["tag_aaa", "tag_bbb"] as TagId[],
      undefined,
    );
    expect(new Set(result.map(String))).toEqual(new Set(["tag_aaa", "tag_bbb"]));
  });
});

describe("buildPatchForAssignment", () => {
  it("returns null for an assignment with only projectId (no patch needed)", () => {
    const patch = buildPatchForAssignment(
      { taskId: "t" as never, projectId: "p" as never },
      undefined,
    );
    expect(patch).toBeNull();
  });

  it("returns a patch with deferDate, dueDate, flagged when set", () => {
    const patch = buildPatchForAssignment(
      {
        taskId: "t" as never,
        deferDate: "2026-01-01T00:00:00.000Z",
        dueDate: "2026-02-01T00:00:00.000Z",
        flagged: true,
      },
      undefined,
    );
    expect(patch).toEqual({
      deferDate: "2026-01-01T00:00:00.000Z",
      dueDate: "2026-02-01T00:00:00.000Z",
      flagged: true,
    });
  });

  it("resolves additive tag diff using current tagIds", () => {
    const patch = buildPatchForAssignment(
      {
        taskId: "task_xxx" as never,
        addTagIds: ["tag_bbb"] as TagId[],
        removeTagIds: ["tag_aaa"] as TagId[],
      },
      ["tag_aaa", "tag_ccc"] as TagId[],
    );
    expect(patch?.tagIds && new Set((patch.tagIds as TagId[]).map(String))).toEqual(
      new Set(["tag_bbb", "tag_ccc"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Handler — move-only
// ---------------------------------------------------------------------------

describe("handleTaskBatchAssign — move only", () => {
  it("moves a task from inbox to a project", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "target" });
    const taskId = await adapter.createTask({ name: "inbox-item" }); // no projectId → inbox

    const env = await handleTaskBatchAssign(
      { assignments: [{ taskId, projectId: projId }] },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.assigned).toHaveLength(1);
    expect(env.data.failed).toHaveLength(0);

    const moved = await adapter.getTask(taskId);
    expect(String(moved.projectId)).toBe(String(projId));
  });
});

// ---------------------------------------------------------------------------
// Handler — update only
// ---------------------------------------------------------------------------

describe("handleTaskBatchAssign — update only", () => {
  it("sets defer/due/flagged on existing tasks without moving them", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const taskId = await adapter.createTask({ name: "t", projectId: projId });

    const env = await handleTaskBatchAssign(
      {
        assignments: [
          {
            taskId,
            deferDate: "2026-05-01T00:00:00.000Z",
            dueDate: "2026-05-10T00:00:00.000Z",
            flagged: true,
          },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.assigned.length !== 1) {
      expect.fail("expected one assigned");
      return;
    }
    const t = await adapter.getTask(taskId);
    expect(t.deferDate).toBe("2026-05-01T00:00:00.000Z");
    expect(t.dueDate).toBe("2026-05-10T00:00:00.000Z");
    expect(t.flagged).toBe(true);
  });

  it("applies additive tag diff: pre-reads current tags, computes union/diff, writes full set", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagA = await adapter.createTag({ name: "a" });
    const tagB = await adapter.createTag({ name: "b" });
    const tagC = await adapter.createTag({ name: "c" });
    const taskId = await adapter.createTask({ name: "t", projectId: projId, tagIds: [tagA, tagB] });

    const env = await handleTaskBatchAssign(
      {
        assignments: [
          {
            taskId,
            addTagIds: [tagC],
            removeTagIds: [tagA],
          },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.assigned.length !== 1) {
      expect.fail("expected one assigned");
      return;
    }
    const t = await adapter.getTask(taskId);
    expect(new Set(t.tagIds.map(String))).toEqual(new Set([String(tagB), String(tagC)]));
  });
});

// ---------------------------------------------------------------------------
// Handler — combined move + update
// ---------------------------------------------------------------------------

describe("handleTaskBatchAssign — combined move + update", () => {
  it("moves to project AND sets defer/due/flagged in one call", async () => {
    const adapter = new InMemoryAdapter();
    const targetProj = await adapter.createProject({ name: "target" });
    const taskId = await adapter.createTask({ name: "inbox-item" });

    const env = await handleTaskBatchAssign(
      {
        assignments: [
          {
            taskId,
            projectId: targetProj,
            dueDate: "2026-05-10T00:00:00.000Z",
            flagged: true,
          },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.assigned.length !== 1) {
      expect.fail("expected one assigned");
      return;
    }
    const t = await adapter.getTask(taskId);
    expect(String(t.projectId)).toBe(String(targetProj));
    expect(t.dueDate).toBe("2026-05-10T00:00:00.000Z");
    expect(t.flagged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-item batches with mixed shapes
// ---------------------------------------------------------------------------

describe("handleTaskBatchAssign — multi-item batches", () => {
  it("preserves original-input indices in the outcome", async () => {
    const adapter = new InMemoryAdapter();
    const projA = await adapter.createProject({ name: "A" });
    const projB = await adapter.createProject({ name: "B" });

    const t0 = await adapter.createTask({ name: "t0" }); // inbox → projA
    const t1 = await adapter.createTask({ name: "t1", projectId: projA }); // existing → flagged
    const t2 = await adapter.createTask({ name: "t2" }); // inbox → projB

    const env = await handleTaskBatchAssign(
      {
        assignments: [
          { taskId: t0, projectId: projA },
          { taskId: t1, flagged: true },
          { taskId: t2, projectId: projB, dueDate: "2026-06-01T00:00:00.000Z" },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.assigned).toHaveLength(3);
    expect(env.data.failed).toHaveLength(0);
    // Indices preserved
    expect(new Set(env.data.assigned.map((s) => s.index))).toEqual(new Set([0, 1, 2]));
  });

  it("emits syncPending=true when at least one assignment succeeded", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const taskId = await adapter.createTask({ name: "t", projectId: projId });

    const env = await handleTaskBatchAssign(
      { assignments: [{ taskId, flagged: true }] },
      makeCtx(adapter),
    );

    if (!("data" in env)) return;
    expect(env.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failure cascade — a failed move suppresses the update
// ---------------------------------------------------------------------------

describe("handleTaskBatchAssign — failure cascade", () => {
  it("marks the item failed with errorCode prefixed 'move:' when batchMove fails", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const realTask = await adapter.createTask({ name: "real", projectId: projId });

    // Stub the adapter's batchMoveTasks to return a failure for the only item.
    const originalBatchMove = adapter.batchMoveTasks.bind(adapter);
    adapter.batchMoveTasks = async (items) => ({
      succeeded: [],
      failed: items.map((_, index) => ({
        index,
        errorCode: "OF_NOT_FOUND",
        message: "stub failure",
      })),
    });

    try {
      const env = await handleTaskBatchAssign(
        {
          assignments: [{ taskId: realTask, projectId: projId, flagged: true }],
        },
        makeCtx(adapter),
      );
      if (!("data" in env)) {
        expect.fail("expected ok envelope");
        return;
      }
      expect(env.data.assigned).toHaveLength(0);
      expect(env.data.failed).toHaveLength(1);
      expect(env.data.failed[0]?.errorCode).toBe("move:OF_NOT_FOUND");

      // Update was not attempted — flagged should still be its default (false)
      const t = await adapter.getTask(realTask);
      expect(t.flagged).toBe(false);
    } finally {
      adapter.batchMoveTasks = originalBatchMove;
    }
  });

  it("marks the item failed with errorCode prefixed 'update:' when batchUpdate fails", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const taskId = await adapter.createTask({ name: "t", projectId: projId });

    const originalBatchUpdate = adapter.batchUpdateTasks.bind(adapter);
    adapter.batchUpdateTasks = async (updates) => ({
      succeeded: [],
      failed: updates.map((_, index) => ({
        index,
        errorCode: "OF_VALIDATION",
        message: "stub validation failure",
      })),
    });

    try {
      const env = await handleTaskBatchAssign(
        { assignments: [{ taskId, flagged: true }] },
        makeCtx(adapter),
      );
      if (!("data" in env)) return;
      expect(env.data.failed).toHaveLength(1);
      expect(env.data.failed[0]?.errorCode).toBe("update:OF_VALIDATION");
    } finally {
      adapter.batchUpdateTasks = originalBatchUpdate;
    }
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("taskBatchAssignInputSchema", () => {
  it("rejects an assignment with no fields beyond taskId", () => {
    const result = taskBatchAssignInputSchema.safeParse({
      assignments: [{ taskId: "abc123def456" }],
    });
    expect(result.success).toBe(false);
  });

  it("requires assignments[] to be non-empty", () => {
    const result = taskBatchAssignInputSchema.safeParse({ assignments: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid assignment (just flagged)", () => {
    const result = taskBatchAssignInputSchema.safeParse({
      assignments: [{ taskId: "abc123def456", flagged: false }],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerTaskBatchAssignTool", () => {
  it("registers under the canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<typeof registerTaskBatchAssignTool>[0];
    const adapter = new InMemoryAdapter();
    registerTaskBatchAssignTool(server, makeCtx(adapter));
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toBe("task_batch_assign");
  });
});
