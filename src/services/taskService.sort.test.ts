/**
 * Tests for TaskService sortBy + sortDirection (issue #133).
 *
 * Covers: default sort (createdAt ASC), all four sortBy fields, desc direction,
 * nulls-last semantics for dueDate, cursor pagination stability across pages
 * when sortBy is set.
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
// Default sort (createdAt ASC)
// ---------------------------------------------------------------------------

describe("TaskService.list — default sort (createdAt ASC)", () => {
  it("returns tasks in createdAt ASC order by default", async () => {
    const { service, adapter } = makeService();
    const id1 = await adapter.createTask({ name: "First" });
    const id2 = await adapter.createTask({ name: "Second" });
    const id3 = await adapter.createTask({ name: "Third" });

    const { tasks } = await service.list({ limit: 10 });
    expect(tasks.map((t) => t.id)).toEqual([id1, id2, id3]);
  });
});

// ---------------------------------------------------------------------------
// sortBy: name
// ---------------------------------------------------------------------------

describe("TaskService.list — sortBy name", () => {
  it("returns tasks in name ASC order", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "Zebra" });
    await adapter.createTask({ name: "Apple" });
    await adapter.createTask({ name: "Mango" });

    const { tasks } = await service.list({ limit: 10, sortBy: "name" });
    expect(tasks.map((t) => t.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("returns tasks in name DESC order", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "Zebra" });
    await adapter.createTask({ name: "Apple" });
    await adapter.createTask({ name: "Mango" });

    const { tasks } = await service.list({ limit: 10, sortBy: "name", sortDirection: "desc" });
    expect(tasks.map((t) => t.name)).toEqual(["Zebra", "Mango", "Apple"]);
  });
});

// ---------------------------------------------------------------------------
// sortBy: dueDate (nulls last)
// ---------------------------------------------------------------------------

describe("TaskService.list — sortBy dueDate (nulls last)", () => {
  it("places tasks with no dueDate after those with one (ASC)", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "NoDue" }); // no dueDate
    await adapter.createTask({ name: "Later", dueDate: "2026-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Earlier", dueDate: "2026-04-01T00:00:00Z" });

    const { tasks } = await service.list({ limit: 10, sortBy: "dueDate" });
    expect(tasks.map((t) => t.name)).toEqual(["Earlier", "Later", "NoDue"]);
  });

  it("places tasks with no dueDate after those with one (DESC)", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "NoDue" });
    await adapter.createTask({ name: "Later", dueDate: "2026-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Earlier", dueDate: "2026-04-01T00:00:00Z" });

    const { tasks } = await service.list({
      limit: 10,
      sortBy: "dueDate",
      sortDirection: "desc",
    });
    expect(tasks.map((t) => t.name)).toEqual(["Later", "Earlier", "NoDue"]);
  });
});

// ---------------------------------------------------------------------------
// sortBy: createdAt DESC
// ---------------------------------------------------------------------------

describe("TaskService.list — sortBy createdAt DESC", () => {
  it("returns newest tasks first", async () => {
    const { service, adapter } = makeService();
    const id1 = await adapter.createTask({ name: "First" });
    const id2 = await adapter.createTask({ name: "Second" });
    const id3 = await adapter.createTask({ name: "Third" });

    const { tasks } = await service.list({ limit: 10, sortBy: "createdAt", sortDirection: "desc" });
    expect(tasks.map((t) => t.id)).toEqual([id3, id2, id1]);
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination with sortBy
// ---------------------------------------------------------------------------

describe("TaskService.list — cursor pagination with sortBy", () => {
  it("paginates correctly with sortBy: name ASC", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "Cherry" });
    await adapter.createTask({ name: "Apple" });
    await adapter.createTask({ name: "Date" });
    await adapter.createTask({ name: "Banana" });

    const page1 = await service.list({ limit: 2, sortBy: "name" });
    expect(page1.tasks.map((t) => t.name)).toEqual(["Apple", "Banana"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.list({
      limit: 2,
      sortBy: "name",
      // biome-ignore lint/style/noNonNullAssertion: hasMore is asserted true above
      cursor: page1.nextCursor!,
    });
    expect(page2.tasks.map((t) => t.name)).toEqual(["Cherry", "Date"]);
    expect(page2.hasMore).toBe(false);
  });

  it("paginates correctly with sortBy: dueDate ASC (nulls last)", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "NoDue1" });
    await adapter.createTask({ name: "NoDue2" });
    await adapter.createTask({ name: "Due2", dueDate: "2026-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Due1", dueDate: "2026-05-01T00:00:00Z" });

    const page1 = await service.list({ limit: 2, sortBy: "dueDate" });
    expect(page1.tasks.map((t) => t.name)).toEqual(["Due1", "Due2"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.list({
      limit: 2,
      sortBy: "dueDate",
      // biome-ignore lint/style/noNonNullAssertion: hasMore is asserted true above
      cursor: page1.nextCursor!,
    });
    // Both NoDue tasks land on page 2 (nulls last)
    expect(page2.tasks.map((t) => t.name)).toEqual(expect.arrayContaining(["NoDue1", "NoDue2"]));
    expect(page2.hasMore).toBe(false);
  });

  it("paginates correctly with sortBy: dueDate DESC (nulls last, boundary before null tail)", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "NoDue1" });
    await adapter.createTask({ name: "NoDue2" });
    await adapter.createTask({ name: "Due2", dueDate: "2026-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Due1", dueDate: "2026-05-01T00:00:00Z" });

    const page1 = await service.list({ limit: 2, sortBy: "dueDate", sortDirection: "desc" });
    expect(page1.tasks.map((t) => t.name)).toEqual(["Due2", "Due1"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.list({
      limit: 2,
      sortBy: "dueDate",
      sortDirection: "desc",
      // biome-ignore lint/style/noNonNullAssertion: hasMore is asserted true above
      cursor: page1.nextCursor!,
    });
    // The null-dueDate tail must still be emitted on page 2 (nulls last in DESC too)
    expect(page2.tasks.map((t) => t.name)).toEqual(["NoDue1", "NoDue2"]);
    expect(page2.hasMore).toBe(false);
  });

  it("paginates correctly with sortBy: dueDate DESC (boundary inside null tail, no duplicates)", async () => {
    const { service, adapter } = makeService();
    await adapter.createTask({ name: "NoDue1" });
    await adapter.createTask({ name: "NoDue2" });
    await adapter.createTask({ name: "Due2", dueDate: "2026-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Due1", dueDate: "2026-05-01T00:00:00Z" });

    const page1 = await service.list({ limit: 3, sortBy: "dueDate", sortDirection: "desc" });
    expect(page1.tasks.map((t) => t.name)).toEqual(["Due2", "Due1", "NoDue1"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.list({
      limit: 3,
      sortBy: "dueDate",
      sortDirection: "desc",
      // biome-ignore lint/style/noNonNullAssertion: hasMore is asserted true above
      cursor: page1.nextCursor!,
    });
    // No already-returned task may be re-emitted after a null-anchored cursor
    expect(page2.tasks.map((t) => t.name)).toEqual(["NoDue2"]);
    expect(page2.hasMore).toBe(false);
  });

  it("rejects cursor when sortBy changes mid-sequence", async () => {
    const { service, adapter } = makeService();
    for (let i = 0; i < 3; i++) await adapter.createTask({ name: `Task ${i}` });

    const page1 = await service.list({ limit: 2, sortBy: "name" });
    expect(page1.nextCursor).not.toBeNull();
    const cursor = page1.nextCursor as string;
    await expect(service.list({ limit: 2, sortBy: "createdAt", cursor })).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });
});
