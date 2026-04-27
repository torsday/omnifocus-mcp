/**
 * Unit tests for the retrospective resource.
 *
 * Covers `resolveWindow` (default, partial, swapped, invalid input) and
 * `buildRetrospectivePayload` (empty state, completed, dropped, rolled,
 * summary counts including projectsActive deduplication).
 *
 * Uses `InMemoryAdapter` for the build path. No live OF required.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import {
  buildRetrospectivePayload,
  RETROSPECTIVE_DEFAULT_DAYS,
  resolveWindow,
} from "./retrospective.js";

// ---------------------------------------------------------------------------
// resolveWindow
// ---------------------------------------------------------------------------

describe("resolveWindow", () => {
  const FIXED_NOW = () => new Date("2026-04-26T12:00:00.000Z");
  const expectedDefaultFrom = "2026-04-19T12:00:00.000Z"; // 7 days earlier

  it("defaults to trailing 7 days when both from and to are omitted", () => {
    const w = resolveWindow(undefined, undefined, FIXED_NOW);
    expect(w.from).toBe(expectedDefaultFrom);
    expect(w.to).toBe("2026-04-26T12:00:00.000Z");
  });

  it("honours an explicit from with default to (now)", () => {
    const w = resolveWindow("2026-04-01T00:00:00.000Z", undefined, FIXED_NOW);
    expect(w.from).toBe("2026-04-01T00:00:00.000Z");
    expect(w.to).toBe("2026-04-26T12:00:00.000Z");
  });

  it("honours an explicit to with default from (7 days back)", () => {
    const w = resolveWindow(undefined, "2026-04-25T00:00:00.000Z", FIXED_NOW);
    expect(w.from).toBe(expectedDefaultFrom);
    expect(w.to).toBe("2026-04-25T00:00:00.000Z");
  });

  it("honours both explicit values", () => {
    const w = resolveWindow("2026-04-01T00:00:00.000Z", "2026-04-10T00:00:00.000Z", FIXED_NOW);
    expect(w.from).toBe("2026-04-01T00:00:00.000Z");
    expect(w.to).toBe("2026-04-10T00:00:00.000Z");
  });

  it("clamps swapped from/to back into order", () => {
    const w = resolveWindow("2026-04-10T00:00:00.000Z", "2026-04-01T00:00:00.000Z", FIXED_NOW);
    expect(w.from).toBe("2026-04-01T00:00:00.000Z");
    expect(w.to).toBe("2026-04-10T00:00:00.000Z");
  });

  it("falls back to defaults on invalid ISO strings (resilient to garbage)", () => {
    const w = resolveWindow("not-a-date", "also-bad", FIXED_NOW);
    expect(w.from).toBe(expectedDefaultFrom);
    expect(w.to).toBe("2026-04-26T12:00:00.000Z");
  });

  it("default window is exactly RETROSPECTIVE_DEFAULT_DAYS days wide", () => {
    const w = resolveWindow(undefined, undefined, FIXED_NOW);
    const widthDays = (new Date(w.to).getTime() - new Date(w.from).getTime()) / 86_400_000;
    expect(widthDays).toBe(RETROSPECTIVE_DEFAULT_DAYS);
  });
});

// ---------------------------------------------------------------------------
// buildRetrospectivePayload — empty state
// ---------------------------------------------------------------------------

describe("buildRetrospectivePayload — empty adapter", () => {
  it("returns empty arrays and zero counts", async () => {
    const adapter = new InMemoryAdapter();
    const window = {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-30T00:00:00.000Z",
    };
    const payload = await buildRetrospectivePayload(adapter, window);

    expect(payload.window).toEqual(window);
    expect(payload.completed).toEqual([]);
    expect(payload.dropped).toEqual([]);
    expect(payload.rolled).toEqual([]);
    expect(payload.summary).toEqual({
      completedCount: 0,
      droppedCount: 0,
      rolledCount: 0,
      projectsActive: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// buildRetrospectivePayload — completed
// ---------------------------------------------------------------------------

describe("buildRetrospectivePayload — completed", () => {
  it("includes tasks completed within the window", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.createTask({ name: "Done in window" });
    await adapter.completeTask(id);

    // Wide window — completion is "now" per InMemoryAdapter
    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.completed).toHaveLength(1);
    expect(payload.completed[0]?.name).toBe("Done in window");
    expect(payload.completed[0]?.age_days_at_completion).toBeGreaterThanOrEqual(0);
    expect(payload.summary.completedCount).toBe(1);
  });

  it("excludes tasks completed before the window starts", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.createTask({ name: "Old completion" });
    await adapter.completeTask(id);

    // Window in the future — current completion (~now) is before window
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const farFuture = new Date(Date.now() + 366 * 86_400_000).toISOString();
    const payload = await buildRetrospectivePayload(adapter, {
      from: future,
      to: farFuture,
    });

    expect(payload.completed).toEqual([]);
  });

  it("sorts completed tasks by completedAt descending (most recent first)", async () => {
    const adapter = new InMemoryAdapter();
    const a = await adapter.createTask({ name: "First" });
    await adapter.completeTask(a);
    const b = await adapter.createTask({ name: "Second" });
    await adapter.completeTask(b);

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // Both completed within window. Sort order is descending by completedAt.
    // InMemoryAdapter may stamp synchronous calls with identical timestamps,
    // so we assert the non-strict relation (>=) rather than strict.
    expect(payload.completed).toHaveLength(2);
    const [first, second] = payload.completed;
    expect((first?.completedAt ?? "") >= (second?.completedAt ?? "")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildRetrospectivePayload — dropped
// ---------------------------------------------------------------------------

describe("buildRetrospectivePayload — dropped", () => {
  it("includes tasks dropped within the window (dropped is not 'completed' in OF)", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.createTask({ name: "Will drop" });
    await adapter.dropTask(id);

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.dropped).toHaveLength(1);
    expect(payload.dropped[0]?.name).toBe("Will drop");
    expect(payload.completed).toEqual([]); // dropped !== completed
    expect(payload.summary.droppedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildRetrospectivePayload — rolled (deferred-forward heuristic)
// ---------------------------------------------------------------------------

describe("buildRetrospectivePayload — rolled", () => {
  it("includes active tasks with deferDate, modifiedAt in window", async () => {
    const adapter = new InMemoryAdapter();
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await adapter.createTask({ name: "Deferred", deferDate: future });

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.rolled).toHaveLength(1);
    expect(payload.rolled[0]?.name).toBe("Deferred");
    expect(payload.summary.rolledCount).toBe(1);
  });

  it("excludes dropped tasks even with a deferDate (dropped goes in dropped[])", async () => {
    const adapter = new InMemoryAdapter();
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const id = await adapter.createTask({ name: "Was deferred", deferDate: future });
    await adapter.dropTask(id);

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.rolled).toEqual([]);
    expect(payload.dropped).toHaveLength(1);
  });

  it("excludes active tasks without a deferDate", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createTask({ name: "Plain task" });

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.rolled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRetrospectivePayload — summary.projectsActive
// ---------------------------------------------------------------------------

describe("buildRetrospectivePayload — projectsActive", () => {
  it("counts distinct project IDs across all three sections", async () => {
    const adapter = new InMemoryAdapter();
    const projA = await adapter.createProject({ name: "Project A" });
    const projB = await adapter.createProject({ name: "Project B" });

    const t1 = await adapter.createTask({ name: "in A", projectId: projA });
    await adapter.completeTask(t1);
    const t2 = await adapter.createTask({ name: "in B", projectId: projB });
    await adapter.dropTask(t2);
    const t3 = await adapter.createTask({ name: "also in A", projectId: projA });
    await adapter.completeTask(t3);

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // Two distinct project IDs (A appears twice but counted once)
    expect(payload.summary.projectsActive).toBe(2);
  });

  it("is zero when all tasks are inbox (projectId null)", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.createTask({ name: "Inbox done" });
    await adapter.completeTask(id);

    const payload = await buildRetrospectivePayload(adapter, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(payload.summary.completedCount).toBe(1);
    expect(payload.summary.projectsActive).toBe(0);
  });
});
