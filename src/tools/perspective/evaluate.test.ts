/**
 * Tests for the `perspective_evaluate` tool — schema parsing + handler behaviour.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { PerspectiveService } from "../../services/perspectiveService.js";
import {
  handlePerspectiveEvaluate,
  PERSPECTIVE_EVALUATE_DESCRIPTION,
  perspectiveEvaluateInputSchema,
} from "./evaluate.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const perspectiveService = new PerspectiveService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { perspectiveService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("perspective_evaluate — input schema", () => {
  it("accepts a valid built-in perspective id", () => {
    expect(perspectiveEvaluateInputSchema.parse({ perspectiveId: "inbox" })).toEqual({
      perspectiveId: "inbox",
    });
  });

  it("accepts a custom perspective id (opaque string)", () => {
    expect(perspectiveEvaluateInputSchema.parse({ perspectiveId: "custom-foo" })).toEqual({
      perspectiveId: "custom-foo",
    });
  });

  it("rejects an empty perspective id", () => {
    expect(() => perspectiveEvaluateInputSchema.parse({ perspectiveId: "" })).toThrow();
  });

  it("accepts all 7 built-in perspective ids", () => {
    for (const id of ["inbox", "projects", "tags", "forecast", "flagged", "nearby", "review"]) {
      expect(() => perspectiveEvaluateInputSchema.parse({ perspectiveId: id })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("perspective_evaluate — description", () => {
  it("mentions built-in perspectives", () => {
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/inbox/i);
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/forecast/i);
  });

  it("mentions custom perspectives + Pro gating", () => {
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/custom/i);
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/Pro/);
  });

  it("mentions review special-case", () => {
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/review/i);
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/review_list_due/);
  });

  it("mentions no side effects", () => {
    expect(PERSPECTIVE_EVALUATE_DESCRIPTION).toMatch(/No side effects/i);
  });
});

// ---------------------------------------------------------------------------
// Handler — inbox
// ---------------------------------------------------------------------------

describe("perspective_evaluate — inbox", () => {
  it("returns inbox tasks (no projectId)", async () => {
    const { ctx, adapter } = makeCtx();
    // Create an inbox task (no project)
    await adapter.createTask({ name: "inbox task" });
    // Create a project and a task in it
    const projectId = await adapter.createProject({ name: "My Project" });
    await adapter.createTask({ name: "project task", projectId });

    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("inbox task");
  });

  it("excludes completed inbox tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "done" });
    await adapter.completeTask(id);
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Handler — flagged
// ---------------------------------------------------------------------------

describe("perspective_evaluate — flagged", () => {
  it("returns flagged tasks", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "flagged task", flagged: true });
    await adapter.createTask({ name: "unflagged task", flagged: false });

    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "flagged" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("flagged task");
  });

  it("excludes completed flagged tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "flagged done", flagged: true });
    await adapter.completeTask(id);
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "flagged" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Handler — review and nearby (empty)
// ---------------------------------------------------------------------------

describe("perspective_evaluate — review", () => {
  it("returns empty array for review", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "some task" });
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "review" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

describe("perspective_evaluate — nearby", () => {
  it("returns empty array for nearby", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "some task" });
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "nearby" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Envelope shape
// ---------------------------------------------------------------------------

describe("perspective_evaluate — envelope shape", () => {
  it("wraps result in ADR-0013 ok() envelope", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(envelope).toHaveProperty("data");
    expect(envelope).toHaveProperty("meta");
    expect(envelope.meta.correlationId).toBe("test-cid");
  });

  it("data contains tasks array", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(Array.isArray(envelope.data.tasks)).toBe(true);
  });

  it("sets cacheHit=false in meta", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(envelope.meta.cacheHit).toBe(false);
  });

  it("includes pagination block with hasMore + cursor", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "inbox" }, ctx);
    expect(envelope.pagination).toBeDefined();
    expect(envelope.pagination?.hasMore).toBe(false);
    expect(envelope.pagination?.cursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pagination — #795
// ---------------------------------------------------------------------------

describe("perspective_evaluate — pagination", () => {
  async function seedFlagged(adapter: InMemoryAdapter, count: number) {
    for (let i = 0; i < count; i++) {
      await adapter.createTask({ name: `flagged-${String(i).padStart(3, "0")}`, flagged: true });
    }
  }

  it("defaults to 50 items when limit is omitted", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 60);
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "flagged" }, ctx);
    expect(envelope.data.tasks).toHaveLength(50);
    expect(envelope.pagination?.hasMore).toBe(true);
    expect(envelope.pagination?.cursor).not.toBeNull();
  });

  it("respects custom limit", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 30);
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 10 }, ctx);
    expect(envelope.data.tasks).toHaveLength(10);
    expect(envelope.pagination?.hasMore).toBe(true);
  });

  it("returns hasMore=false when total ≤ limit", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 5);
    const envelope = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 50 }, ctx);
    expect(envelope.data.tasks).toHaveLength(5);
    expect(envelope.pagination?.hasMore).toBe(false);
    expect(envelope.pagination?.cursor).toBeNull();
  });

  it("paginates through all items via cursor", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 25);

    const page1 = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 10 }, ctx);
    expect(page1.data.tasks).toHaveLength(10);
    expect(page1.pagination?.hasMore).toBe(true);

    const page2 = await handlePerspectiveEvaluate(
      { perspectiveId: "flagged", limit: 10, cursor: page1.pagination!.cursor! },
      ctx,
    );
    expect(page2.data.tasks).toHaveLength(10);
    expect(page2.pagination?.hasMore).toBe(true);

    const page3 = await handlePerspectiveEvaluate(
      { perspectiveId: "flagged", limit: 10, cursor: page2.pagination!.cursor! },
      ctx,
    );
    expect(page3.data.tasks).toHaveLength(5);
    expect(page3.pagination?.hasMore).toBe(false);
    expect(page3.pagination?.cursor).toBeNull();

    // No overlapping IDs across pages.
    const allIds = [
      ...page1.data.tasks.map((t) => t.id),
      ...page2.data.tasks.map((t) => t.id),
      ...page3.data.tasks.map((t) => t.id),
    ];
    expect(new Set(allIds).size).toBe(25);
  });

  it("rejects a cursor for a different perspective with filterHash mismatch", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 20);
    await adapter.createTask({ name: "inbox-1" });

    const page1 = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 5 }, ctx);
    await expect(
      handlePerspectiveEvaluate({ perspectiveId: "inbox", cursor: page1.pagination!.cursor! }, ctx),
    ).rejects.toThrow(/filter hash/i);
  });

  it("rejects a cursor when fields[] differs mid-sequence", async () => {
    const { ctx, adapter } = makeCtx();
    await seedFlagged(adapter, 20);
    const page1 = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 5 }, ctx);
    await expect(
      handlePerspectiveEvaluate(
        { perspectiveId: "flagged", fields: ["name"], cursor: page1.pagination!.cursor! },
        ctx,
      ),
    ).rejects.toThrow(/filter hash/i);
  });

  it("enforces limit max of 200 at the schema layer", () => {
    expect(() =>
      perspectiveEvaluateInputSchema.parse({ perspectiveId: "flagged", limit: 201 }),
    ).toThrow();
  });

  it("falls back to page-1 when the cursor's lastId is no longer in the result", async () => {
    const { ctx, adapter } = makeCtx();
    const firstId = await adapter.createTask({ name: "flagged-A", flagged: true });
    await adapter.createTask({ name: "flagged-B", flagged: true });
    await adapter.createTask({ name: "flagged-C", flagged: true });

    const page1 = await handlePerspectiveEvaluate({ perspectiveId: "flagged", limit: 1 }, ctx);
    expect(page1.pagination?.hasMore).toBe(true);

    // Drop the task whose id was emitted as the cursor anchor.
    await adapter.deleteTask(firstId);

    // The cursor still validates (filterHash unchanged) but its lastId is
    // absent — the handler restarts at index 0 rather than throwing.
    const page2 = await handlePerspectiveEvaluate(
      { perspectiveId: "flagged", limit: 5, cursor: page1.pagination!.cursor! },
      ctx,
    );
    expect(page2.data.tasks.length).toBeGreaterThan(0);
    expect(page2.pagination?.hasMore).toBe(false);
  });
});
