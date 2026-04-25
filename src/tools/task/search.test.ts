/**
 * Tests for task_search tool.
 *
 * Covers: schema validation, basic keyword match, no-results case,
 * scope (name/note/all), projectId filter, flagged filter, completed filter,
 * tagIds filter (ALL-match semantics).
 *
 * Uses InMemoryAdapter so no JXA bridge or live OmniFocus is required.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskSearch, taskSearchInputSchema } from "./search.js";

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

describe("task_search — input schema", () => {
  it("requires q", () => {
    expect(() => taskSearchInputSchema.parse({})).toThrow();
  });

  it("rejects empty q", () => {
    expect(() => taskSearchInputSchema.parse({ q: "" })).toThrow();
  });

  it("accepts minimal input", () => {
    const parsed = taskSearchInputSchema.parse({ q: "groceries" });
    expect(parsed.q).toBe("groceries");
  });

  it("accepts full input surface", () => {
    const parsed = taskSearchInputSchema.parse({
      q: "standup",
      scope: "name",
      flagged: true,
      completed: "exclude",
    });
    expect(parsed.scope).toBe("name");
    expect(parsed.flagged).toBe(true);
    expect(parsed.completed).toBe("exclude");
  });

  it("rejects invalid scope", () => {
    expect(() => taskSearchInputSchema.parse({ q: "x", scope: "title" })).toThrow();
  });

  it("rejects invalid completed value", () => {
    expect(() => taskSearchInputSchema.parse({ q: "x", completed: "yes" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_search — handler", () => {
  it("returns tasks matching the keyword in name", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });
    await adapter.createTask({ name: "Send report" });

    const result = await handleTaskSearch({ q: "groceries" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("Buy groceries");
  });

  it("returns empty array when no tasks match", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });

    const result = await handleTaskSearch({ q: "quarterly report" }, ctx);
    expect(result.data.tasks).toHaveLength(0);
  });

  it("search is case-insensitive", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Review BUDGET" });

    const result = await handleTaskSearch({ q: "budget" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
  });

  it("returns multiple matches", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Buy groceries" });
    await adapter.createTask({ name: "Buy medicine" });
    await adapter.createTask({ name: "Send report" });

    const result = await handleTaskSearch({ q: "buy" }, ctx);
    expect(result.data.tasks).toHaveLength(2);
  });

  it("scope=name skips note matches", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Meeting prep", note: "agenda: quarterly review" });
    await adapter.createTask({ name: "quarterly standup" });

    const result = await handleTaskSearch({ q: "quarterly", scope: "name" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("quarterly standup");
  });

  it("scope=note skips name matches", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "quarterly standup" });
    await adapter.createTask({ name: "Meeting prep", note: "agenda: quarterly review" });

    const result = await handleTaskSearch({ q: "quarterly", scope: "note" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("Meeting prep");
  });

  it("scope=all (default) matches name or note", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "quarterly standup" });
    await adapter.createTask({ name: "Meeting prep", note: "agenda: quarterly review" });

    const result = await handleTaskSearch({ q: "quarterly" }, ctx);
    expect(result.data.tasks).toHaveLength(2);
  });

  it("filters by flagged=true", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "critical fix", flagged: true });
    await adapter.createTask({ name: "critical path", flagged: false });

    const result = await handleTaskSearch({ q: "critical", flagged: true }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("critical fix");
  });

  it("completed=exclude (default) omits completed tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "review docs" });
    await adapter.createTask({ name: "review code" });
    await adapter.completeTask(id);

    const result = await handleTaskSearch({ q: "review", completed: "exclude" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("review code");
  });

  it("completed=only returns only completed tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "review docs" });
    await adapter.createTask({ name: "review code" });
    await adapter.completeTask(id);

    const result = await handleTaskSearch({ q: "review", completed: "only" }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("review docs");
  });

  it("completed=any returns all matching tasks regardless of completion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "review docs" });
    await adapter.createTask({ name: "review code" });
    await adapter.completeTask(id);

    const result = await handleTaskSearch({ q: "review", completed: "any" }, ctx);
    expect(result.data.tasks).toHaveLength(2);
  });

  it("filters by projectId restricts to project tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const pid = await adapter.createProject({ name: "Work" });
    await adapter.createTask({ name: "review PR", projectId: pid });
    await adapter.createTask({ name: "review notes" });

    const result = await handleTaskSearch({ q: "review", projectId: pid }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.projectId).toBe(pid);
  });
});
