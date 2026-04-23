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
import type { TaskId } from "../../domain/ids.js";
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

  it("deleteTask removes the task", async () => {
    await t.deleteTask(createdTaskId);
    const tasks = await t.listTasks({});
    const found = tasks.find((task) => task.id === createdTaskId);
    expect(found).toBeUndefined();
  });
});
