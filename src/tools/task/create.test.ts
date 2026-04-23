/**
 * Tests for task_create tool.
 *
 * Covers: schema validation, inbox task creation, project task creation,
 * mutual-exclusion refine, syncPending meta, and description content.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TASK_CREATE_DESCRIPTION, handleTaskCreate, taskCreateInputSchema } from "./create.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { adapter, ctx: { adapter, makeMeta } };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_create — input schema", () => {
  it("accepts minimal inbox task", () => {
    expect(taskCreateInputSchema.safeParse({ name: "Test" }).success).toBe(true);
  });

  it("accepts project task with optional fields", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      projectId: "proj-abc123",
      flagged: true,
      dueDate: "2025-01-01T00:00:00+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = taskCreateInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects both projectId and parentTaskId", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      projectId: "proj-abc123",
      parentTaskId: "task-abc123",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_create — handler", () => {
  it("creates an inbox task and returns an id", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskCreate({ name: "Inbox task" }, ctx);
    expect(typeof envelope.data.id).toBe("string");
    expect(envelope.data.id.length).toBeGreaterThan(0);
  });

  it("creates a project task", async () => {
    const { adapter, ctx } = makeCtx();
    const pid = await adapter.createProject({ name: "TestProject" });
    const envelope = await handleTaskCreate({ name: "Project task", projectId: pid }, ctx);
    expect(typeof envelope.data.id).toBe("string");
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskCreate({ name: "Task" }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("task_create — description", () => {
  it("mentions inbox", () => {
    expect(TASK_CREATE_DESCRIPTION).toContain("inbox");
  });

  it("mentions sync_trigger", () => {
    expect(TASK_CREATE_DESCRIPTION).toContain("sync_trigger");
  });
});
