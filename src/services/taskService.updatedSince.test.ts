/**
 * Tests for TaskService updatedSince filter (issue #150).
 *
 * Covers: returns only tasks modified after the threshold; empty result when
 * nothing changed; combines with other filters; ValidationError on bad format;
 * relative shortcuts resolve correctly; updatedSince counts as a "filter" for
 * the unbounded-query guard.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import { TaskService } from "./taskService.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeService() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
  const service = new TaskService({ adapter, cache });
  return { service, adapter };
}

// ---------------------------------------------------------------------------
// Basic filtering
// ---------------------------------------------------------------------------

describe("TaskService.list — updatedSince", () => {
  it("returns only tasks modified after the threshold", async () => {
    const { service, adapter } = makeService();
    // Tasks created at tick 0, 1, 2 — modifiedAt = createdAt by default
    await adapter.createTask({ name: "Old" }); // tick 0 → 2026-01-01T00:00:00Z
    await adapter.createTask({ name: "Middle" }); // tick 1 → 2026-01-01T00:00:01Z
    await adapter.createTask({ name: "New" }); // tick 2 → 2026-01-01T00:00:02Z

    // Threshold between tick 1 and tick 2
    const { tasks } = await service.list({
      updatedSince: "2026-01-01T00:00:01.500Z",
    });
    expect(tasks.map((t) => t.name)).toEqual(["New"]);
  });

  it("returns empty array when nothing was modified after the threshold", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "A" });
    await adapter.createTask({ name: "B" });

    const { tasks } = await service.list({
      updatedSince: "2027-01-01T00:00:00Z",
    });
    expect(tasks).toHaveLength(0);
  });

  it("returns all tasks when threshold is before all modifiedAt values", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "A" });
    await adapter.createTask({ name: "B" });

    const { tasks } = await service.list({
      updatedSince: "2020-01-01T00:00:00Z",
    });
    expect(tasks).toHaveLength(2);
  });

  it("compares instants, not strings: west-of-UTC threshold excludes earlier UTC modifications", async () => {
    const { service, adapter } = makeService();
    // Tasks modified at 00:00:00Z / 00:00:01Z / 00:00:02Z on 2026-01-01.
    await adapter.createTask({ name: "A" });
    await adapter.createTask({ name: "B" });
    await adapter.createTask({ name: "C" });

    // Threshold = 2025-12-31T17:30:00-07:00 = 2026-01-01T00:30:00Z — strictly
    // AFTER every modifiedAt as an instant, so nothing matches. A lexicographic
    // compare ("2026-…Z" > "2025-…-07:00") would wrongly return all three.
    const { tasks } = await service.list({
      updatedSince: "2025-12-31T17:30:00-07:00",
    });
    expect(tasks).toHaveLength(0);
  });

  it("compares instants, not strings: east-of-UTC threshold includes later UTC modifications", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "A" });
    await adapter.createTask({ name: "B" });
    await adapter.createTask({ name: "C" });

    // Threshold = 2026-01-01T02:00:00+03:00 = 2025-12-31T23:00:00Z — strictly
    // BEFORE every modifiedAt as an instant, so all three match. A lexicographic
    // compare ("2026-01-01T0…Z" > "2026-01-01T2…+03:00") would wrongly exclude all.
    const { tasks } = await service.list({
      updatedSince: "2026-01-01T02:00:00+03:00",
    });
    expect(tasks).toHaveLength(3);
  });

  it("compares instants, not strings: no-fraction Z threshold vs fractional modifiedAt", async () => {
    // Task modified at 2026-01-01T00:00:00.500Z — strictly after a threshold
    // of 2026-01-01T00:00:00Z as an instant. A lexicographic compare sees
    // "…T00:00:00.500Z" < "…T00:00:00Z" ('.' < 'Z') and would wrongly exclude it.
    const adapter = new InMemoryAdapter({
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 500)),
    });
    const service = new TaskService({ adapter, cache: new OmniFocusLruCache({ ttlMs: 30_000 }) });
    await adapter.createTask({ name: "Fractional" });

    const { tasks } = await service.list({
      updatedSince: "2026-01-01T00:00:00Z",
    });
    expect(tasks.map((t) => t.name)).toEqual(["Fractional"]);
  });

  it("uses strict greater-than (not >=)", async () => {
    const { service, adapter } = makeService();
    // Task created at tick 0 → modifiedAt = "2026-01-01T00:00:00.000Z"
    const id = await adapter.createTask({ name: "Exact" });
    const fetched = await adapter.getTask(id);
    expect(fetched).not.toBeNull();
    const modifiedAt = (fetched as NonNullable<typeof fetched>).modifiedAt;

    const { tasks } = await service.list({
      // Pass the exact modifiedAt as threshold — strict > means it should NOT be returned
      updatedSince: modifiedAt,
    });
    expect(tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Combination with other filters
// ---------------------------------------------------------------------------

describe("TaskService.list — updatedSince + other filters", () => {
  it("combines updatedSince with flagged filter", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "OldFlagged", flagged: true }); // tick 0
    await adapter.createTask({ name: "OldUnflagged" }); // tick 1
    await adapter.createTask({ name: "NewFlagged", flagged: true }); // tick 2
    await adapter.createTask({ name: "NewUnflagged" }); // tick 3

    const { tasks } = await service.list({
      flagged: true,
      updatedSince: "2026-01-01T00:00:01.500Z",
    });
    expect(tasks.map((t) => t.name)).toEqual(["NewFlagged"]);
  });
});

// ---------------------------------------------------------------------------
// Unbounded-query guard
// ---------------------------------------------------------------------------

describe("TaskService.list — updatedSince as filter bound", () => {
  it("does not throw unbounded-query error when only updatedSince is set", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "A" });
    // updatedSince alone counts as a filter; this should not throw
    await expect(service.list({ updatedSince: "2020-01-01T00:00:00Z" })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("TaskService.list — updatedSince validation", () => {
  it("throws ValidationError for an unrecognised format", async () => {
    const { service } = makeService();
    await expect(service.list({ updatedSince: "not-a-date" })).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });

  it("throws ValidationError for a bare local time (no offset)", async () => {
    const { service } = makeService();
    await expect(service.list({ updatedSince: "2026-04-21T10:00:00" })).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });

  it("accepts a valid ISO-8601 string with offset", async () => {
    const { service } = makeService();
    await expect(
      service.list({ updatedSince: "2026-04-21T10:00:00-07:00" }),
    ).resolves.toBeDefined();
  });

  it("accepts a relative shortcut (today)", async () => {
    const { service } = makeService();
    // Should not throw; returns empty (all tasks are from 2026-01-01)
    await expect(service.list({ updatedSince: "today" })).resolves.toBeDefined();
  });
});
