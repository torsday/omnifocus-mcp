/**
 * Tests for search_query tool and SearchService.
 *
 * Covers: schema parsing, text matching by scope, filter narrowing,
 * pagination (cursor, hasMore, limit), and filter-hash mismatch rejection.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { SearchService } from "../../services/searchService.js";
import { handleSearchQuery, searchQueryInputSchema } from "./query.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const searchService = new SearchService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { searchService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("search_query — input schema", () => {
  it("requires q", () => {
    expect(() => searchQueryInputSchema.parse({})).toThrow();
  });

  it("accepts minimal input", () => {
    expect(searchQueryInputSchema.parse({ q: "hello" })).toMatchObject({ q: "hello" });
  });

  it("accepts full input surface", () => {
    const parsed = searchQueryInputSchema.parse({
      q: "standup",
      scope: "name",
      projectId: "proj_000001",
      tagIds: ["tag_000001"],
      flagged: true,
      completed: "exclude",
      limit: 50,
    });
    expect(parsed.scope).toBe("name");
    expect(parsed.completed).toBe("exclude");
  });

  it("rejects limit above 500", () => {
    expect(() => searchQueryInputSchema.parse({ q: "x", limit: 501 })).toThrow();
  });

  it("rejects unknown scope", () => {
    expect(() => searchQueryInputSchema.parse({ q: "x", scope: "title" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

describe("search_query — text matching", () => {
  it("returns empty results when no tasks match", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });
    const envelope = await handleSearchQuery({ q: "standup" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });

  it("matches by task name (case-insensitive)", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Daily Standup" });
    await adapter.createTask({ name: "Buy groceries" });
    const envelope = await handleSearchQuery({ q: "standup" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("Daily Standup");
  });

  it("matches by task note when scope=note", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Task A", note: "meeting notes here" });
    await adapter.createTask({ name: "Task B", note: "nothing" });
    const envelope = await handleSearchQuery({ q: "meeting", scope: "note" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("Task A");
  });

  it("scope=name does NOT match note content", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Task A", note: "secret content" });
    const envelope = await handleSearchQuery({ q: "secret", scope: "name" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });

  it("scope=all matches both name and note", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Alpha task", note: "nothing" });
    await adapter.createTask({ name: "Task B", note: "alpha in note" });
    const envelope = await handleSearchQuery({ q: "alpha", scope: "all" }, ctx);
    expect(envelope.data.tasks).toHaveLength(2);
  });

  it("empty q with filter returns all matching tasks", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Task A", flagged: true });
    await adapter.createTask({ name: "Task B", flagged: false });
    const envelope = await handleSearchQuery({ q: "", flagged: true }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
  });

  it("matches UTF-8 content", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Réunion équipe" });
    const envelope = await handleSearchQuery({ q: "équipe" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Filter narrowing
// ---------------------------------------------------------------------------

describe("search_query — filter narrowing", () => {
  it("narrows by projectId", async () => {
    const { ctx, adapter } = makeCtx();
    const projId = await adapter.createProject({ name: "Work" });
    await adapter.createTask({ name: "Standup task", projectId: projId });
    await adapter.createTask({ name: "Standup other" });
    const envelope = await handleSearchQuery({ q: "standup", projectId: projId }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.projectId).toBe(projId);
  });

  it("narrows by flagged=true", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Action item", flagged: true });
    await adapter.createTask({ name: "Action unflagged", flagged: false });
    const envelope = await handleSearchQuery({ q: "action", flagged: true }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.flagged).toBe(true);
  });

  it("narrows by completed=only", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Done task" });
    await adapter.createTask({ name: "Done but active" });
    await adapter.completeTask(id1);
    const envelope = await handleSearchQuery({ q: "done", completed: "only" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.completedAt).not.toBeNull();
  });

  it("narrows by completed=exclude", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Done task" });
    await adapter.createTask({ name: "Done active" });
    await adapter.completeTask(id1);
    const envelope = await handleSearchQuery({ q: "done", completed: "exclude" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.completedAt).toBeNull();
  });

  it("narrows by tagIds (ALL must match)", async () => {
    const { ctx, adapter } = makeCtx();
    const tagId = await adapter.createTag({ name: "urgent" });
    await adapter.createTask({ name: "Tagged task", tagIds: [tagId] });
    await adapter.createTask({ name: "Untagged task" });
    const envelope = await handleSearchQuery({ q: "task", tagIds: [tagId] }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("Tagged task");
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("search_query — pagination", () => {
  it("respects limit", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 5; i++) await adapter.createTask({ name: `Task ${i}` });
    const envelope = await handleSearchQuery({ q: "task", limit: 3 }, ctx);
    expect(envelope.data.tasks).toHaveLength(3);
    expect(envelope.meta).toBeDefined();
  });

  it("returns hasMore=true when results exceed limit", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 5; i++) await adapter.createTask({ name: `Task ${i}` });
    const envelope = await handleSearchQuery({ q: "task", limit: 3 }, ctx);
    expect(envelope.pagination?.hasMore).toBe(true);
    expect(envelope.pagination?.cursor).toBeTruthy();
  });

  it("returns hasMore=false on the last page", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 3; i++) await adapter.createTask({ name: `Task ${i}` });
    const envelope = await handleSearchQuery({ q: "task", limit: 10 }, ctx);
    expect(envelope.pagination?.hasMore).toBe(false);
    expect(envelope.pagination?.cursor).toBeNull();
  });

  it("cursor fetches the next page without overlap", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 5; i++) await adapter.createTask({ name: `Task ${i}` });
    const page1 = await handleSearchQuery({ q: "task", limit: 3 }, ctx);
    const cursor = page1.pagination?.cursor ?? "";
    expect(cursor).toBeTruthy();
    const page2 = await handleSearchQuery({ q: "task", limit: 3, cursor }, ctx);
    const ids1 = page1.data.tasks.map((t) => t.id);
    const ids2 = page2.data.tasks.map((t) => t.id);
    expect(ids2.every((id) => !ids1.includes(id))).toBe(true);
    expect(ids1.length + ids2.length).toBe(5);
  });

  it("rejects cursor when filters change", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 5; i++) await adapter.createTask({ name: `Task ${i}` });
    const page1 = await handleSearchQuery({ q: "task", limit: 3 }, ctx);
    const cursor = page1.pagination?.cursor ?? "";
    expect(cursor).toBeTruthy();
    await expect(handleSearchQuery({ q: "different", limit: 3, cursor }, ctx)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Field projection (#773)
  // -------------------------------------------------------------------------

  it("projects each returned task to the requested fields plus id", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Task one", note: "details", flagged: true });
    const result = await handleSearchQuery({ q: "task", fields: ["name"] }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    expect(Object.keys(task).sort()).toEqual(["id", "name"]);
  });

  it("emits WARN_UNKNOWN_FIELDS for unknown names in fields[]", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Task one" });
    const result = await handleSearchQuery({ q: "task", fields: ["name", "bogus"] }, ctx);
    const warning = result.meta.warnings?.find((w) => w.code === "WARN_UNKNOWN_FIELDS");
    expect(warning?.details).toMatchObject({ unknown: ["bogus"] });
  });
});
