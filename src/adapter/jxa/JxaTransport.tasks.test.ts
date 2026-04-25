/**
 * Unit tests for `JxaTransport` — task domain methods.
 *
 * All tests use a fake spawner that returns pre-shaped JSON, so no `osascript`
 * binary is required. Integration tests against a live OmniFocus instance are
 * in JxaTransport.tasks.integration.test.ts and gated behind
 * `OMNIFOCUS_INTEGRATION=1`.
 *
 * @see src/adapter/jxa/JxaTransport.ts — implementation
 * @see src/scripts/jxa/task_*.js — underlying scripts
 */

import { describe, expect, it, vi } from "vitest";
import type { ProjectId, TaskId } from "../../domain/ids.js";
import { NotFound, ScriptError } from "../../errors/index.js";
import { JxaTransport } from "./JxaTransport.js";
import type { ScriptSpawner, SpawnResult } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnerReturning(payload: unknown): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: JSON.stringify(payload),
      stderr: "",
      exitCode: 0,
      timedOut: false,
    }),
  );
}

function spawnerFailing(stderr: string): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr,
      exitCode: 1,
      timedOut: false,
    }),
  );
}

const BASE_TASK = {
  id: "task_aaa",
  name: "Write tests",
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
  modifiedAt: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe("JxaTransport — listTasks", () => {
  it("returns parsed tasks with branded IDs", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tasks: [BASE_TASK] }) });
    const tasks = await t.listTasks({});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task_aaa");
    expect(tasks[0]?.name).toBe("Write tests");
    expect(tasks[0]?.available).toBe(true);
  });

  it("passes all filter fields to the script", async () => {
    const spawner = spawnerReturning({ tasks: [] });
    const t = new JxaTransport({ spawner });
    await t.listTasks({ flagged: true, completed: false, dueBefore: "2026-12-31T00:00:00Z" });
    const call = (spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const arg = JSON.parse(call[1]) as { flagged: boolean; completed: boolean; dueBefore: string };
    expect(arg.flagged).toBe(true);
    expect(arg.completed).toBe(false);
    expect(arg.dueBefore).toBe("2026-12-31T00:00:00Z");
  });

  it("returns empty array when no tasks", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tasks: [] }) });
    expect(await t.listTasks({})).toEqual([]);
  });

  it("surfaces ScriptError on script failure", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("OmniFocus got an error") });
    await expect(t.listTasks({})).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

describe("JxaTransport — getTask", () => {
  it("returns a single task", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ task: BASE_TASK }) });
    const task = await t.getTask("task_aaa" as TaskId);
    expect(task.id).toBe("task_aaa");
    expect(task.name).toBe("Write tests");
    expect(task.flagged).toBe(false);
  });

  it("passes the id to the script", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.getTask("task_aaa" as TaskId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string };
    expect(arg.id).toBe("task_aaa");
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("task not found") });
    await expect(t.getTask("task_missing" as TaskId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// getTasksMany
// ---------------------------------------------------------------------------

describe("JxaTransport — getTasksMany", () => {
  it("returns tasks with branded IDs, nulls for missing", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tasks: [BASE_TASK, null] }),
    });
    const tasks = await t.getTasksMany(["task_aaa" as TaskId, "task_missing" as TaskId]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toBe("task_aaa");
    expect(tasks[1]).toBeNull();
  });

  it("passes ids array to the script", async () => {
    const spawner = spawnerReturning({ tasks: [BASE_TASK] });
    const t = new JxaTransport({ spawner });
    await t.getTasksMany(["task_aaa" as TaskId]);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { ids: string[] };
    expect(arg.ids).toEqual(["task_aaa"]);
  });
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe("JxaTransport — createTask", () => {
  it("returns the new task's branded ID", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ task: BASE_TASK }) });
    const id = await t.createTask({ name: "Write tests" });
    expect(id).toBe("task_aaa");
  });

  it("passes name and defaults to the script", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.createTask({ name: "Write tests" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { name: string; projectId: null; flagged: boolean; tagIds: string[] };
    expect(arg.name).toBe("Write tests");
    expect(arg.projectId).toBeNull();
    expect(arg.flagged).toBe(false);
    expect(arg.tagIds).toEqual([]);
  });

  it("passes projectId when supplied", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.createTask({ name: "Write tests", projectId: "proj_zzz" as ProjectId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { projectId: string };
    expect(arg.projectId).toBe("proj_zzz");
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe("JxaTransport — updateTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ task: { ...BASE_TASK, name: "Updated" } }),
    });
    await expect(t.updateTask("task_aaa" as TaskId, { name: "Updated" })).resolves.toBeUndefined();
  });

  it("passes only supplied patch fields to the script", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.updateTask("task_aaa" as TaskId, { flagged: true });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; flagged: boolean; name?: string };
    expect(arg.id).toBe("task_aaa");
    expect(arg.flagged).toBe(true);
    expect(arg.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// completeTask
// ---------------------------------------------------------------------------

describe("JxaTransport — completeTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(t.completeTask("task_aaa" as TaskId)).resolves.toBeUndefined();
  });

  it("passes null completionDate when not supplied", async () => {
    const spawner = spawnerReturning({ id: "task_aaa" });
    const t = new JxaTransport({ spawner });
    await t.completeTask("task_aaa" as TaskId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; completionDate: null };
    expect(arg.id).toBe("task_aaa");
    expect(arg.completionDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// uncompleteTask
// ---------------------------------------------------------------------------

describe("JxaTransport — uncompleteTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(t.uncompleteTask("task_aaa" as TaskId)).resolves.toBeUndefined();
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("task not found") });
    await expect(t.uncompleteTask("task_missing" as TaskId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// dropTask
// ---------------------------------------------------------------------------

describe("JxaTransport — dropTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(t.dropTask("task_aaa" as TaskId)).resolves.toBeUndefined();
  });

  it("passes null droppedAt when not supplied", async () => {
    const spawner = spawnerReturning({ id: "task_aaa" });
    const t = new JxaTransport({ spawner });
    await t.dropTask("task_aaa" as TaskId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; droppedAt: null };
    expect(arg.id).toBe("task_aaa");
    expect(arg.droppedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// undropTask
// ---------------------------------------------------------------------------

describe("JxaTransport — undropTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(t.undropTask("task_aaa" as TaskId)).resolves.toBeUndefined();
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("task not found") });
    await expect(t.undropTask("task_missing" as TaskId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe("JxaTransport — deleteTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(t.deleteTask("task_aaa" as TaskId)).resolves.toBeUndefined();
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("task not found") });
    await expect(t.deleteTask("task_missing" as TaskId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// moveTask
// ---------------------------------------------------------------------------

describe("JxaTransport — moveTask", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "task_aaa" }) });
    await expect(
      t.moveTask("task_aaa" as TaskId, { projectId: "proj_bbb" as ProjectId }),
    ).resolves.toBeUndefined();
  });

  it("passes projectId destination to the script", async () => {
    const spawner = spawnerReturning({ id: "task_aaa" });
    const t = new JxaTransport({ spawner });
    await t.moveTask("task_aaa" as TaskId, { projectId: "proj_bbb" as ProjectId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; projectId: string; parentId: null };
    expect(arg.id).toBe("task_aaa");
    expect(arg.projectId).toBe("proj_bbb");
    expect(arg.parentId).toBeNull();
  });

  it("passes null for unspecified destination fields", async () => {
    const spawner = spawnerReturning({ id: "task_aaa" });
    const t = new JxaTransport({ spawner });
    await t.moveTask("task_aaa" as TaskId, {});
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { projectId: null; parentId: null };
    expect(arg.projectId).toBeNull();
    expect(arg.parentId).toBeNull();
  });
});
