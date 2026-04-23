/**
 * Tests for task_find_by_name tool.
 *
 * Covers: schema validation, exact/prefix/contains modes, case sensitivity,
 * zero matches (empty array, not error), single match, multiple matches, limit.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskFindByName, taskFindByNameInputSchema } from "./findByName.js";

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

describe("task_find_by_name — input schema", () => {
  it("requires query", () => {
    expect(() => taskFindByNameInputSchema.parse({})).toThrow();
  });

  it("rejects empty query", () => {
    expect(() => taskFindByNameInputSchema.parse({ query: "" })).toThrow();
  });

  it("accepts minimal input", () => {
    const parsed = taskFindByNameInputSchema.parse({ query: "Buy groceries" });
    expect(parsed.query).toBe("Buy groceries");
  });

  it("accepts full input surface", () => {
    const parsed = taskFindByNameInputSchema.parse({
      query: "standup",
      mode: "prefix",
      caseSensitive: true,
      limit: 10,
    });
    expect(parsed.mode).toBe("prefix");
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.limit).toBe(10);
  });

  it("rejects unknown mode", () => {
    expect(() => taskFindByNameInputSchema.parse({ query: "x", mode: "fuzzy" })).toThrow();
  });

  it("rejects limit above 500", () => {
    expect(() => taskFindByNameInputSchema.parse({ query: "x", limit: 501 })).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => taskFindByNameInputSchema.parse({ query: "x", limit: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zero matches
// ---------------------------------------------------------------------------

describe("task_find_by_name — zero matches", () => {
  it("returns empty array (not an error) when nothing matches", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });
    const envelope = await handleTaskFindByName({ query: "Standup" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
    expect(envelope.data.matchCount).toBe(0);
  });

  it("returns empty array when store is empty", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskFindByName({ query: "anything" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Exact mode (default)
// ---------------------------------------------------------------------------

describe("task_find_by_name — exact mode", () => {
  it("returns exact match (case-insensitive by default)", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Daily Standup" });
    await adapter.createTask({ name: "Buy groceries" });

    const envelope = await handleTaskFindByName({ query: "daily standup" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("Daily Standup");
  });

  it("returns multiple tasks with the same name", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Review PR" });
    await adapter.createTask({ name: "Review PR" });
    await adapter.createTask({ name: "Different task" });

    const envelope = await handleTaskFindByName({ query: "Review PR" }, ctx);
    expect(envelope.data.tasks).toHaveLength(2);
    expect(envelope.data.matchCount).toBe(2);
  });

  it("does NOT match partial names in exact mode", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Daily Standup Notes" });
    const envelope = await handleTaskFindByName({ query: "Daily Standup" }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
  });

  it("case-sensitive exact match misses case variants", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Daily Standup" });
    const envelope = await handleTaskFindByName(
      { query: "daily standup", caseSensitive: true },
      ctx,
    );
    expect(envelope.data.tasks).toHaveLength(0);
  });

  it("case-sensitive exact match finds exact case", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Daily Standup" });
    const envelope = await handleTaskFindByName(
      { query: "Daily Standup", caseSensitive: true },
      ctx,
    );
    expect(envelope.data.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Prefix mode
// ---------------------------------------------------------------------------

describe("task_find_by_name — prefix mode", () => {
  it("matches tasks whose names start with the query", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });
    await adapter.createTask({ name: "Buy milk" });
    await adapter.createTask({ name: "Sell stocks" });

    const envelope = await handleTaskFindByName({ query: "buy", mode: "prefix" }, ctx);
    expect(envelope.data.tasks).toHaveLength(2);
  });

  it("is case-insensitive by default", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "BUDGET review" });
    const envelope = await handleTaskFindByName({ query: "budget", mode: "prefix" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
  });

  it("case-sensitive prefix respects case", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Budget review" });
    const envelope = await handleTaskFindByName(
      { query: "budget", mode: "prefix", caseSensitive: true },
      ctx,
    );
    expect(envelope.data.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Contains mode
// ---------------------------------------------------------------------------

describe("task_find_by_name — contains mode", () => {
  it("matches tasks with the query anywhere in the name", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Weekly standup meeting" });
    await adapter.createTask({ name: "Daily standup notes" });
    await adapter.createTask({ name: "Buy groceries" });

    const envelope = await handleTaskFindByName({ query: "standup", mode: "contains" }, ctx);
    expect(envelope.data.tasks).toHaveLength(2);
  });

  it("is case-insensitive by default", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Q1 BUDGET planning" });
    const envelope = await handleTaskFindByName({ query: "budget", mode: "contains" }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Limit
// ---------------------------------------------------------------------------

describe("task_find_by_name — limit", () => {
  it("respects limit and reports full matchCount", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 10; i++) await adapter.createTask({ name: `Task ${i}` });

    const envelope = await handleTaskFindByName({ query: "Task", mode: "prefix", limit: 3 }, ctx);
    expect(envelope.data.tasks).toHaveLength(3);
    expect(envelope.data.matchCount).toBe(10);
  });

  it("defaults to limit 50", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 60; i++) await adapter.createTask({ name: "Same Name" });

    const envelope = await handleTaskFindByName({ query: "Same Name" }, ctx);
    expect(envelope.data.tasks).toHaveLength(50);
    expect(envelope.data.matchCount).toBe(60);
  });
});
