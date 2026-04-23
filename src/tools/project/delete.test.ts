/**
 * Tests for project_delete tool.
 *
 * Covers: schema validation, successful deletion, NotFound for unknown ID,
 * double-delete raises NotFound, cascade behavior (contained tasks are
 * disassociated from the project), and response shape.
 *
 * NOTE: The InMemoryAdapter orphans contained tasks (sets projectId=null)
 * rather than hard-deleting them — this matches the observable outcome for
 * the project scope but differs from real OmniFocus which hard-deletes tasks.
 * Integration tests cover the JXA cascade behavior.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleProjectDelete, projectDeleteInputSchema } from "./delete.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { adapter, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_delete — input schema", () => {
  it("requires id", () => {
    expect(() => projectDeleteInputSchema.parse({})).toThrow();
  });

  it("accepts a valid project ID", () => {
    const parsed = projectDeleteInputSchema.parse({ id: "project_000001" });
    expect(parsed.id).toBe("project_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_delete — handler", () => {
  it("deletes an existing project and returns { deleted: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "To delete" });

    const envelope = await handleProjectDelete({ id }, ctx);

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true on deletion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleProjectDelete({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("removes the project from the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleProjectDelete({ id }, ctx);
    await expect(adapter.getProject(id)).rejects.toThrow();
  });

  it("throws NotFound for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectDelete({ id: "project_999999" as import("../../domain/ids.js").ProjectId }, ctx),
    ).rejects.toThrow();
  });

  it("double-delete raises NotFound (not silent)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleProjectDelete({ id }, ctx);
    await expect(handleProjectDelete({ id }, ctx)).rejects.toThrow();
  });

  it("cascade: contained tasks are no longer associated with the deleted project", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "My Project" });
    const taskId = await adapter.createTask({ name: "Task in project", projectId });

    // Verify task is in the project before deletion
    const before = await adapter.getTask(taskId);
    expect(before.projectId).toBe(projectId);

    await handleProjectDelete({ id: projectId }, ctx);

    // After deletion, the project is gone
    await expect(adapter.getProject(projectId)).rejects.toThrow();

    // The task is orphaned (InMemoryAdapter behavior; real OF hard-deletes tasks)
    const after = await adapter.getTask(taskId);
    expect(after.projectId).toBeNull();
  });

  it("deleting one project does not affect sibling projects", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createProject({ name: "A" });
    const idB = await adapter.createProject({ name: "B" });
    await handleProjectDelete({ id: idA }, ctx);
    const remaining = await adapter.listProjects({});
    expect(remaining.some((p) => p.id === idB)).toBe(true);
    expect(remaining.some((p) => p.id === idA)).toBe(false);
  });
});
