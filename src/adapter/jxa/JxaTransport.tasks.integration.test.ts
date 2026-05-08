/**
 * Integration tests for `JxaTransport` — task domain methods.
 *
 * These tests require a running OmniFocus instance and are gated behind the
 * `OMNIFOCUS_INTEGRATION=1` environment variable. They exercise real JXA
 * calls via `osascript` rather than a mocked spawner.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * @see src/adapter/jxa/JxaTransport.tasks.test.ts — unit tests (no OF required)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import { JxaTransport } from "./JxaTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("JxaTransport — task integration", () => {
  const t = new JxaTransport();
  let createdTaskId: TaskId;

  beforeAll(async () => {
    createdTaskId = await t.createTask({ name: "__mcp_test_task__" });
  });

  afterAll(async () => {
    if (createdTaskId) {
      await t.deleteTask(createdTaskId).catch(() => {
        /* already deleted */
      });
    }
  });

  it("createTask returns a valid ID", () => {
    expect(typeof createdTaskId).toBe("string");
    expect(createdTaskId.length).toBeGreaterThan(0);
  });

  it("getTask returns the created task", async () => {
    const task = await t.getTask(createdTaskId);
    expect(task.id).toBe(createdTaskId);
    expect(task.name).toBe("__mcp_test_task__");
    expect(task.completed).toBe(false);
  });

  it("listTasks includes the created task", async () => {
    const tasks = await t.listTasks({});
    const found = tasks.find((task) => task.id === createdTaskId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("__mcp_test_task__");
  });

  it("getTasksMany returns the created task by id", async () => {
    const results = await t.getTasksMany([createdTaskId]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(createdTaskId);
  });

  it("updateTask renames the task", async () => {
    await t.updateTask(createdTaskId, { name: "__mcp_test_task_renamed__" });
    const task = await t.getTask(createdTaskId);
    expect(task.name).toBe("__mcp_test_task_renamed__");
  });

  it("updateTask sets flagged", async () => {
    await t.updateTask(createdTaskId, { flagged: true });
    const task = await t.getTask(createdTaskId);
    expect(task.flagged).toBe(true);
  });

  it("dropTask marks task as dropped", async () => {
    await t.dropTask(createdTaskId);
    const task = await t.getTask(createdTaskId);
    expect(task.dropped).toBe(true);
  });

  it("undropTask restores task from dropped", async () => {
    await t.undropTask(createdTaskId);
    const task = await t.getTask(createdTaskId);
    expect(task.dropped).toBe(false);
  });

  it("completeTask marks task completed", async () => {
    await t.completeTask(createdTaskId);
    const task = await t.getTask(createdTaskId);
    expect(task.completed).toBe(true);
  });

  it("uncompleteTask marks task incomplete", async () => {
    await t.uncompleteTask(createdTaskId);
    const task = await t.getTask(createdTaskId);
    expect(task.completed).toBe(false);
  });

  it("moveTask moves the task into a target project", async () => {
    // Create a short-lived target project, move the task into it, then clean up.
    let targetProjectId: ProjectId | undefined;
    try {
      targetProjectId = await t.createProject({ name: "__mcp_test_move_target__" });
      await t.moveTask(createdTaskId, { projectId: targetProjectId });
      const task = await t.getTask(createdTaskId);
      expect(task.projectId).toBe(targetProjectId);
    } finally {
      if (targetProjectId !== undefined) {
        await t.deleteProject(targetProjectId).catch(() => {
          /* best-effort cleanup */
        });
      }
    }
  });

  it("deleteTask removes the task", async () => {
    await t.deleteTask(createdTaskId);
    const tasks = await t.listTasks({});
    const found = tasks.find((task) => task.id === createdTaskId);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tag-mutation regression — #716
//
// OmniFocus 4.x JXA's task.addTag(tag) / task.removeTag(tag) silently no-op
// on existing tasks resolved by id — the call returns without error but no
// row is written to the underlying SQLite TaskToTag join table. The fix
// (#716) routes the tag-set replacement through OmniJS via
// ofApp.evaluateJavascript inside the JXA script. This suite guards against
// regression by verifying that updateTask / batchUpdateTasks actually
// persist tagIds against a real OmniFocus instance.
//
// Isolated lifecycle (own task + own tags) so we don't depend on shared
// state from the suite above.
// ---------------------------------------------------------------------------

describe.skipIf(!INTEGRATION)("JxaTransport — task tag persistence (#716)", () => {
  const t = new JxaTransport();
  // Initialised in beforeAll; never undefined in test bodies. Using definite-
  // assignment-by-cast keeps the inner tests free of `!` non-null assertions.
  let taskId = "" as TaskId;
  let tagAId = "" as TagId;
  let tagBId = "" as TagId;

  beforeAll(async () => {
    taskId = await t.createTask({ name: "__mcp_test_task_716__" });
    tagAId = await t.createTag({ name: "__mcp_test_tag_a_716__" });
    tagBId = await t.createTag({ name: "__mcp_test_tag_b_716__" });
  });

  afterAll(async () => {
    if (taskId)
      await t.deleteTask(taskId).catch(() => {
        /* best-effort cleanup */
      });
    if (tagAId)
      await t.deleteTag(tagAId).catch(() => {
        /* best-effort cleanup */
      });
    if (tagBId)
      await t.deleteTag(tagBId).catch(() => {
        /* best-effort cleanup */
      });
  });

  it("updateTask persists tagIds: add to empty task", async () => {
    await t.updateTask(taskId, { tagIds: [tagAId] });
    const task = await t.getTask(taskId);
    expect(task.tagIds).toContain(tagAId);
  });

  it("updateTask persists tagIds: replacement swaps A for B", async () => {
    await t.updateTask(taskId, { tagIds: [tagBId] });
    const task = await t.getTask(taskId);
    expect(task.tagIds).toContain(tagBId);
    expect(task.tagIds).not.toContain(tagAId);
  });

  it("updateTask persists tagIds: empty array clears all tags", async () => {
    await t.updateTask(taskId, { tagIds: [] });
    const task = await t.getTask(taskId);
    expect(task.tagIds).toEqual([]);
  });

  it("batchUpdateTasks persists tagIds", async () => {
    await t.batchUpdateTasks([{ id: taskId, patch: { tagIds: [tagAId, tagBId] } }]);
    const task = await t.getTask(taskId);
    expect(task.tagIds).toContain(tagAId);
    expect(task.tagIds).toContain(tagBId);
  });
});
