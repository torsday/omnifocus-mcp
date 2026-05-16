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
import { JxaTransport, NOTE_INLINE_THRESHOLD_BYTES } from "./JxaTransport.js";
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

  it("inlines a small note in the initial create call (#937)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    const smallNote = "a".repeat(NOTE_INLINE_THRESHOLD_BYTES); // == threshold, not >
    await t.createTask({ name: "Write tests", note: smallNote });
    const mock = spawner as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(1);
    const arg = JSON.parse((mock.mock.calls[0] as [string, string])[1]) as { note: string | null };
    expect(arg.note).toBe(smallNote);
  });

  it("splits a large note into a phase-2 note-only update (#937)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    const bigNote = "x".repeat(NOTE_INLINE_THRESHOLD_BYTES + 1);
    await t.createTask({
      name: "Write tests",
      note: bigNote,
      projectId: "proj_zzz" as ProjectId,
      flagged: true,
    });
    const mock = spawner as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(2);
    // Phase 1: create call drops the note but keeps everything else.
    const phase1Script = (mock.mock.calls[0] as [string, string])[0];
    const phase1Arg = JSON.parse((mock.mock.calls[0] as [string, string])[1]) as {
      name: string;
      projectId: string;
      flagged: boolean;
      note: string | null;
    };
    expect(phase1Script).toContain("task_create");
    expect(phase1Arg.name).toBe("Write tests");
    expect(phase1Arg.projectId).toBe("proj_zzz");
    expect(phase1Arg.flagged).toBe(true);
    expect(phase1Arg.note).toBeNull();
    // Phase 2: note-only update against the just-created task ID.
    const phase2Script = (mock.mock.calls[1] as [string, string])[0];
    const phase2Arg = JSON.parse((mock.mock.calls[1] as [string, string])[1]) as {
      id: string;
      note: string;
      name?: string;
      flagged?: boolean;
    };
    expect(phase2Script).toContain("task_update");
    expect(phase2Arg.id).toBe("task_aaa");
    expect(phase2Arg.note).toBe(bigNote);
    expect(phase2Arg.name).toBeUndefined();
    expect(phase2Arg.flagged).toBeUndefined();
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

  it("forwards a repetition rule to the script (#938)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.updateTask("task_aaa" as TaskId, {
      repetition: { method: "start-again", unit: "days", steps: 1 },
    });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; repetition: { method: string; unit: string; steps: number } };
    expect(arg.repetition).toEqual({ method: "start-again", unit: "days", steps: 1 });
  });

  it("forwards a null repetition (clear) to the script (#938)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    await t.updateTask("task_aaa" as TaskId, { repetition: null });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; repetition: unknown };
    expect(arg.repetition).toBeNull();
  });

  it("inlines a small note in the single update call (#937)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    const smallNote = "a".repeat(NOTE_INLINE_THRESHOLD_BYTES); // == threshold, not >
    await t.updateTask("task_aaa" as TaskId, { name: "x", note: smallNote });
    const mock = spawner as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(1);
    const arg = JSON.parse((mock.mock.calls[0] as [string, string])[1]) as {
      note: string;
      name: string;
    };
    expect(arg.note).toBe(smallNote);
    expect(arg.name).toBe("x");
  });

  it("splits a large note off when other fields are present (#937)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    const bigNote = "x".repeat(NOTE_INLINE_THRESHOLD_BYTES + 1);
    await t.updateTask("task_aaa" as TaskId, { name: "Renamed", note: bigNote, flagged: true });
    const mock = spawner as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(2);
    const phase1Arg = JSON.parse((mock.mock.calls[0] as [string, string])[1]) as {
      id: string;
      name: string;
      flagged: boolean;
      note?: string;
    };
    expect(phase1Arg.id).toBe("task_aaa");
    expect(phase1Arg.name).toBe("Renamed");
    expect(phase1Arg.flagged).toBe(true);
    expect(phase1Arg.note).toBeUndefined();
    const phase2Arg = JSON.parse((mock.mock.calls[1] as [string, string])[1]) as {
      id: string;
      note: string;
      name?: string;
    };
    expect(phase2Arg.id).toBe("task_aaa");
    expect(phase2Arg.note).toBe(bigNote);
    expect(phase2Arg.name).toBeUndefined();
  });

  it("does not split when only a large note is supplied (#937)", async () => {
    const spawner = spawnerReturning({ task: BASE_TASK });
    const t = new JxaTransport({ spawner });
    const bigNote = "y".repeat(NOTE_INLINE_THRESHOLD_BYTES + 1);
    await t.updateTask("task_aaa" as TaskId, { note: bigNote });
    const mock = spawner as ReturnType<typeof vi.fn>;
    // Single-field note-only patch already avoids the property-bag bottleneck —
    // a recursive split would be both wasteful and a stack hazard.
    expect(mock.mock.calls).toHaveLength(1);
    const arg = JSON.parse((mock.mock.calls[0] as [string, string])[1]) as {
      id: string;
      note: string;
    };
    expect(arg.note).toBe(bigNote);
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
