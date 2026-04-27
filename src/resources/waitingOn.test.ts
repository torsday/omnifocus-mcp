/**
 * Tests for the omnifocus://waiting-on resource builder.
 *
 * Covers: empty result, parse-from-fence selection, daysOverdue derivation,
 * sort order (most-overdue first; null sinks to end), and ignoring tasks
 * without a fence.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { writeWaitingOn } from "../domain/waitingOn.js";
import { buildWaitingOnPayload } from "./waitingOn.js";

const NOW = new Date("2026-04-27T15:00:00Z");

describe("buildWaitingOnPayload", () => {
  it("returns an empty list when no tasks have a waiting-on fence", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createTask({ name: "no fence" });
    await adapter.createTask({ name: "also no fence", note: "user prose" });

    const payload = await buildWaitingOnPayload(adapter, NOW);
    expect(payload.items).toEqual([]);
  });

  it("includes one item per task with a fence", async () => {
    const adapter = new InMemoryAdapter();
    const a = await adapter.createTask({
      name: "Alpha",
      note: writeWaitingOn(null, {
        whom: "Alice",
        since: "2026-04-20T00:00:00Z",
      }),
    });
    const b = await adapter.createTask({
      name: "Beta",
      note: writeWaitingOn("user note", {
        whom: "Bob",
        what: "review",
        since: "2026-04-22T00:00:00Z",
        followUpAfter: "2026-04-25T00:00:00Z",
      }),
    });

    const payload = await buildWaitingOnPayload(adapter, NOW);
    const ids = payload.items.map((i) => i.taskId).sort();
    expect(ids).toEqual([String(a), String(b)].sort());
  });

  it("derives daysOverdue: 0 for today, integer for past, null for future or unset", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createTask({
      name: "no follow-up",
      note: writeWaitingOn(null, { whom: "A", since: "2026-04-20T00:00:00Z" }),
    });
    await adapter.createTask({
      name: "future",
      note: writeWaitingOn(null, {
        whom: "B",
        since: "2026-04-20T00:00:00Z",
        followUpAfter: "2026-05-10T00:00:00Z",
      }),
    });
    await adapter.createTask({
      name: "today",
      note: writeWaitingOn(null, {
        whom: "C",
        since: "2026-04-20T00:00:00Z",
        followUpAfter: "2026-04-27T00:00:00Z",
      }),
    });
    await adapter.createTask({
      name: "5 days late",
      note: writeWaitingOn(null, {
        whom: "D",
        since: "2026-04-01T00:00:00Z",
        followUpAfter: "2026-04-22T15:00:00Z",
      }),
    });

    const payload = await buildWaitingOnPayload(adapter, NOW);
    const byName = Object.fromEntries(payload.items.map((i) => [i.name, i.daysOverdue]));
    expect(byName["no follow-up"]).toBeNull();
    expect(byName["future"]).toBeNull();
    expect(byName["today"]).toBe(0);
    expect(byName["5 days late"]).toBe(5);
  });

  it("sorts most-overdue first; null daysOverdue sinks to the end", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createTask({
      name: "no follow-up old",
      note: writeWaitingOn(null, { whom: "X", since: "2026-04-01T00:00:00Z" }),
    });
    await adapter.createTask({
      name: "0 days",
      note: writeWaitingOn(null, {
        whom: "Y",
        since: "2026-04-20T00:00:00Z",
        followUpAfter: "2026-04-27T00:00:00Z",
      }),
    });
    await adapter.createTask({
      name: "5 days",
      note: writeWaitingOn(null, {
        whom: "Z",
        since: "2026-04-01T00:00:00Z",
        followUpAfter: "2026-04-22T15:00:00Z",
      }),
    });

    const payload = await buildWaitingOnPayload(adapter, NOW);
    expect(payload.items.map((i) => i.name)).toEqual(["5 days", "0 days", "no follow-up old"]);
  });

  it("excludes completed tasks", async () => {
    const adapter = new InMemoryAdapter();
    const id = await adapter.createTask({
      name: "Done",
      note: writeWaitingOn(null, { whom: "A", since: "2026-04-20T00:00:00Z" }),
    });
    await adapter.completeTask(id);

    const payload = await buildWaitingOnPayload(adapter, NOW);
    expect(payload.items).toEqual([]);
  });
});
