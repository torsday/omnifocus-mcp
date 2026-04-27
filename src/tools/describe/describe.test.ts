/**
 * Tests for *_describe preview tools.
 *
 * Verifies:
 * - Description strings contain expected fragments
 * - No mutating adapter methods are called
 * - plannedChanges records are populated correctly
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleFolderCreateDescribe } from "../folder/createDescribe.js";
import { handleFolderDeleteDescribe } from "../folder/deleteDescribe.js";
import { handleFolderMoveDescribe } from "../folder/moveDescribe.js";
import { handleFolderUpdateDescribe } from "../folder/updateDescribe.js";
import { handleProjectCompleteDescribe } from "../project/completeDescribe.js";
import { handleProjectCreateDescribe } from "../project/createDescribe.js";
import { handleProjectDeleteDescribe } from "../project/deleteDescribe.js";
import { handleProjectUpdateDescribe } from "../project/updateDescribe.js";
import { handleTagCreateDescribe } from "../tag/createDescribe.js";
import { handleTagDeleteDescribe } from "../tag/deleteDescribe.js";
import { handleTagUpdateDescribe } from "../tag/updateDescribe.js";
import { handleTaskBatchCreateDescribe } from "../task/batchCreateDescribe.js";
import { handleTaskCompleteDescribe } from "../task/completeDescribe.js";
import { handleTaskCreateDescribe } from "../task/createDescribe.js";
import { handleTaskDeleteDescribe } from "../task/deleteDescribe.js";
import { handleTaskDropDescribe } from "../task/dropDescribe.js";
import { handleTaskUpdateDescribe } from "../task/updateDescribe.js";

const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
  correlationId: "test-cid",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "test",
  ...partial,
});

function makeCtx() {
  const adapter = new InMemoryAdapter();
  return { adapter, ctx: { adapter, makeMeta } };
}

function assertOk<T>(envelope: unknown): T {
  const e = envelope as { data?: T };
  if (!("data" in (envelope as object))) {
    throw new Error(`expected success envelope, got: ${JSON.stringify(envelope)}`);
  }
  return e.data as T;
}

// ---------------------------------------------------------------------------
// task_create_describe
// ---------------------------------------------------------------------------

describe("task_create_describe", () => {
  it("describes an inbox task", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "createTask");
    const env = await handleTaskCreateDescribe({ name: "My Task" }, ctx);
    const data = assertOk<{ description: string; plannedChanges: unknown[] }>(env);
    expect(data.description).toContain("'My Task'");
    expect(data.description).toContain("Inbox");
    expect(spy).not.toHaveBeenCalled();
  });

  it("describes a task in a project (name resolved)", async () => {
    const { ctx, adapter } = makeCtx();
    const projId = await adapter.createProject({ name: "Work" });
    const env = await handleTaskCreateDescribe({ name: "Task A", projectId: projId }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Work'");
    expect(data.description).toContain("project");
  });

  it("records plannedChanges for name", async () => {
    const { ctx } = makeCtx();
    const env = await handleTaskCreateDescribe({ name: "X" }, ctx);
    const data = assertOk<{ plannedChanges: Array<{ field: string }> }>(env);
    expect(data.plannedChanges.some((c) => c.field === "name")).toBe(true);
  });

  it("falls back to ID when project lookup fails", async () => {
    const { ctx } = makeCtx();
    const env = await handleTaskCreateDescribe(
      { name: "T", projectId: "proj-unknown" as import("../../domain/ids.js").ProjectId },
      ctx,
    );
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("proj-unknown");
  });
});

// ---------------------------------------------------------------------------
// task_update_describe
// ---------------------------------------------------------------------------

describe("task_update_describe", () => {
  it("describes renaming a task", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "updateTask");
    const id = await adapter.createTask({ name: "Old Name" });
    const env = await handleTaskUpdateDescribe({ id, name: "New Name" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'New Name'");
    expect(spy).not.toHaveBeenCalled();
  });

  it("includes oldValue from current task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Existing" });
    const env = await handleTaskUpdateDescribe({ id, name: "Renamed" }, ctx);
    const data = assertOk<{ plannedChanges: Array<{ field: string; oldValue?: string | null }> }>(
      env,
    );
    const nameChange = data.plannedChanges.find((c) => c.field === "name");
    expect(nameChange?.oldValue).toBe("Existing");
  });
});

// ---------------------------------------------------------------------------
// task_complete_describe
// ---------------------------------------------------------------------------

describe("task_complete_describe", () => {
  it("describes completing a task", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "completeTask");
    const id = await adapter.createTask({ name: "Finish Me" });
    const env = await handleTaskCompleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Finish Me'");
    expect(data.description).toContain("done");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports no-op when task already completed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Already Done" });
    await adapter.completeTask(id);
    const env = await handleTaskCompleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("no-op");
  });
});

// ---------------------------------------------------------------------------
// task_drop_describe
// ---------------------------------------------------------------------------

describe("task_drop_describe", () => {
  it("describes dropping a task", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "dropTask");
    const id = await adapter.createTask({ name: "Defer Me" });
    const env = await handleTaskDropDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Defer Me'");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// task_delete_describe
// ---------------------------------------------------------------------------

describe("task_delete_describe", () => {
  it("describes deleting a task", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "deleteTask");
    const id = await adapter.createTask({ name: "Delete Me" });
    const env = await handleTaskDeleteDescribe({ id, confirm: true }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Delete Me'");
    expect(data.description).toContain("IRREVERSIBLE");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// task_batch_create_describe
// ---------------------------------------------------------------------------

describe("task_batch_create_describe", () => {
  it("summarises multiple tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "createTask");
    const env = await handleTaskBatchCreateDescribe(
      { items: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      ctx,
    );
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("3 tasks");
    expect(data.description).toContain("'A'");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// project_create_describe
// ---------------------------------------------------------------------------

describe("project_create_describe", () => {
  it("describes creating a project at root", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "createProject");
    const env = await handleProjectCreateDescribe({ name: "My Project" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'My Project'");
    expect(data.description).toContain("root");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// project_update_describe
// ---------------------------------------------------------------------------

describe("project_update_describe", () => {
  it("describes renaming a project", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "updateProject");
    const id = await adapter.createProject({ name: "Old" });
    const env = await handleProjectUpdateDescribe({ id, name: "New" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'New'");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// project_complete_describe
// ---------------------------------------------------------------------------

describe("project_complete_describe", () => {
  it("describes completing a project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Done Project" });
    const env = await handleProjectCompleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Done Project'");
    expect(data.description).toContain("completed");
  });
});

// ---------------------------------------------------------------------------
// project_delete_describe
// ---------------------------------------------------------------------------

describe("project_delete_describe", () => {
  it("describes deleting a project", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "deleteProject");
    const id = await adapter.createProject({ name: "Bye Project" });
    const env = await handleProjectDeleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Bye Project'");
    expect(data.description).toContain("IRREVERSIBLE");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tag_create_describe
// ---------------------------------------------------------------------------

describe("tag_create_describe", () => {
  it("describes creating a root tag", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "createTag");
    const env = await handleTagCreateDescribe({ name: "urgent" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'urgent'");
    expect(data.description).toContain("root");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tag_update_describe
// ---------------------------------------------------------------------------

describe("tag_update_describe", () => {
  it("describes renaming a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "updateTag");
    const id = await adapter.createTag({ name: "old-tag" });
    const env = await handleTagUpdateDescribe({ id, name: "new-tag" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'new-tag'");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tag_delete_describe
// ---------------------------------------------------------------------------

describe("tag_delete_describe", () => {
  it("describes deleting a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "deleteTag");
    const id = await adapter.createTag({ name: "bye-tag" });
    const env = await handleTagDeleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'bye-tag'");
    expect(data.description).toContain("IRREVERSIBLE");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// folder_create_describe
// ---------------------------------------------------------------------------

describe("folder_create_describe", () => {
  it("describes creating a root folder", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "createFolder");
    const env = await handleFolderCreateDescribe({ name: "Personal" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Personal'");
    expect(data.description).toContain("root");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// folder_update_describe
// ---------------------------------------------------------------------------

describe("folder_update_describe", () => {
  it("describes renaming a folder", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "updateFolder");
    const id = await adapter.createFolder({ name: "Work" });
    const env = await handleFolderUpdateDescribe({ id, name: "Career" }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Career'");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// folder_delete_describe
// ---------------------------------------------------------------------------

describe("folder_delete_describe", () => {
  it("describes deleting a folder", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "deleteFolder");
    const id = await adapter.createFolder({ name: "Old Folder" });
    const env = await handleFolderDeleteDescribe({ id }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("'Old Folder'");
    expect(data.description).toContain("IRREVERSIBLE");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// folder_move_describe
// ---------------------------------------------------------------------------

describe("folder_move_describe", () => {
  it("describes moving a folder to root", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createFolder({ name: "Sub" });
    const env = await handleFolderMoveDescribe({ id, parentId: null }, ctx);
    const data = assertOk<{ description: string }>(env);
    expect(data.description).toContain("root level");
  });
});
