/**
 * Tests for the changes_since sync tool (#819).
 *
 * Covers: schema, bootstrap (reset + all-as-added), delta (field-level
 * modified, unchanged omitted), new-entity-as-added, expired/unknown-token
 * resync, and the byte-savings property (delta ≪ bootstrap).
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound, Timeout } from "../../errors/index.js";
import { SyncSnapshotStore } from "../../state/syncSnapshotStore.js";
import {
  type ChangesSinceData,
  changesSinceInputSchema,
  handleChangesSince,
} from "./changesSince.js";

// One monotonic clock shared by the adapter (modifiedAt) and the tool
// (snapshot issuedAt) so getChangesSince comparisons are deterministic.
function makeCtx() {
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++));
  const adapter = new InMemoryAdapter({ now: clock });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  const store = new SyncSnapshotStore();
  return { adapter, makeMeta, store, now: clock };
}

function data(envelope: Awaited<ReturnType<typeof handleChangesSince>>): ChangesSinceData {
  if (!("data" in envelope)) throw new Error("expected ok envelope");
  return envelope.data as ChangesSinceData;
}

describe("changes_since — input schema", () => {
  it("accepts empty and a syncToken", () => {
    expect(changesSinceInputSchema.parse({})).toEqual({});
    expect(changesSinceInputSchema.parse({ syncToken: "abc" })).toEqual({ syncToken: "abc" });
  });
});

describe("changes_since — bootstrap", () => {
  it("returns reset=true with every entity in added and a token", async () => {
    const ctx = makeCtx();
    await ctx.adapter.createTask({ name: "Task A" });
    await ctx.adapter.createTask({ name: "Task B" });

    const d = data(await handleChangesSince({}, ctx));
    expect(d.reset).toBe(true);
    expect(d.syncToken).toMatch(/^[0-9a-f]{32}$/);
    expect(d.tasks.added).toHaveLength(2);
    expect(d.tasks.modified).toEqual([]);
  });
});

describe("changes_since — delta", () => {
  it("returns only the changed fields of a modified task; unchanged omitted", async () => {
    const ctx = makeCtx();
    const idA = await ctx.adapter.createTask({ name: "Task A" });
    await ctx.adapter.createTask({ name: "Task B" });

    const boot = data(await handleChangesSince({}, ctx));
    await ctx.adapter.updateTask(idA, { flagged: true });

    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.reset).toBe(false);
    expect(d.tasks.added).toEqual([]);
    expect(d.tasks.modified).toHaveLength(1);
    expect(d.tasks.modified[0]?.id).toBe(idA as string);
    expect(d.tasks.modified[0]?.changes).toMatchObject({ flagged: true });
    // The delta carries the changed field, not the whole record.
    expect(d.tasks.modified[0]?.changes.name).toBeUndefined();
  });

  it("reports a task created after the token as added", async () => {
    const ctx = makeCtx();
    await ctx.adapter.createTask({ name: "Task A" });
    const boot = data(await handleChangesSince({}, ctx));

    const idNew = await ctx.adapter.createTask({ name: "Task C" });
    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.tasks.modified).toEqual([]);
    expect(d.tasks.added.map((t) => t.id as string)).toEqual([idNew as string]);
  });

  it("returns an empty delta when nothing changed", async () => {
    const ctx = makeCtx();
    await ctx.adapter.createTask({ name: "Task A" });
    const boot = data(await handleChangesSince({}, ctx));

    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.reset).toBe(false);
    expect(d.tasks.added).toEqual([]);
    expect(d.tasks.modified).toEqual([]);
  });
});

describe("changes_since — includeRemoved (#1095)", () => {
  it("omits `removed` by default", async () => {
    const ctx = makeCtx();
    await ctx.adapter.createTask({ name: "Task A" });
    const boot = data(await handleChangesSince({}, ctx));
    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.removed).toBeUndefined();
  });

  it("reports a deleted task in `removed` when includeRemoved=true", async () => {
    const ctx = makeCtx();
    const idA = await ctx.adapter.createTask({ name: "Task A" });
    await ctx.adapter.createTask({ name: "Task B" });
    const boot = data(await handleChangesSince({}, ctx));

    await ctx.adapter.deleteTask(idA);
    const d = data(
      await handleChangesSince({ syncToken: boot.syncToken, includeRemoved: true }, ctx),
    );
    expect(d.removed?.tasks).toEqual([idA as string]);
    expect(d.removed?.projects).toEqual([]);
    expect(d.tasks.added).toEqual([]);
  });

  it("still reports added and field-level modified alongside removed", async () => {
    const ctx = makeCtx();
    const idA = await ctx.adapter.createTask({ name: "Task A" });
    const idB = await ctx.adapter.createTask({ name: "Task B" });
    const boot = data(await handleChangesSince({}, ctx));

    await ctx.adapter.deleteTask(idA);
    await ctx.adapter.updateTask(idB, { flagged: true });
    const idC = await ctx.adapter.createTask({ name: "Task C" });

    const d = data(
      await handleChangesSince({ syncToken: boot.syncToken, includeRemoved: true }, ctx),
    );
    expect(d.removed?.tasks).toEqual([idA as string]);
    expect(d.tasks.added.map((t) => t.id as string)).toEqual([idC as string]);
    expect(d.tasks.modified).toHaveLength(1);
    expect(d.tasks.modified[0]?.id).toBe(idB as string);
    expect(d.tasks.modified[0]?.changes).toMatchObject({ flagged: true });
  });
});

describe("changes_since — per-entity fetch failures (C24)", () => {
  it("rethrows a transient getTask failure without consuming the token", async () => {
    const ctx = makeCtx();
    const idA = await ctx.adapter.createTask({ name: "Task A" });
    const boot = data(await handleChangesSince({}, ctx));

    await ctx.adapter.updateTask(idA, { flagged: true });

    // First delta attempt: the per-entity fetch times out (slow DB contending
    // with sync). The call must fail — NOT silently advance the watermark.
    const realGetTask = ctx.adapter.getTask.bind(ctx.adapter);
    ctx.adapter.getTask = () => Promise.reject(new Timeout("JXA script exceeded 30000ms timeout"));
    await expect(handleChangesSince({ syncToken: boot.syncToken }, ctx)).rejects.toBeInstanceOf(
      Timeout,
    );

    // The token survived the failed call, so a retry re-reports the change.
    ctx.adapter.getTask = realGetTask;
    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.reset).toBe(false);
    expect(d.tasks.modified).toHaveLength(1);
    expect(d.tasks.modified[0]?.id).toBe(idA as string);
    expect(d.tasks.modified[0]?.changes).toMatchObject({ flagged: true });
  });

  it("rethrows a transient getProject failure without consuming the token", async () => {
    const ctx = makeCtx();
    const idP = await ctx.adapter.createProject({ name: "Project P" });
    const boot = data(await handleChangesSince({}, ctx));

    await ctx.adapter.updateProject(idP, { name: "Project P2" });

    const realGetProject = ctx.adapter.getProject.bind(ctx.adapter);
    ctx.adapter.getProject = () => Promise.reject(new Timeout("timeout"));
    await expect(handleChangesSince({ syncToken: boot.syncToken }, ctx)).rejects.toBeInstanceOf(
      Timeout,
    );

    ctx.adapter.getProject = realGetProject;
    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.projects.modified).toHaveLength(1);
    expect(d.projects.modified[0]?.id).toBe(idP as string);
  });

  it("still skips a changed-then-vanished entity (NotFound) silently", async () => {
    const ctx = makeCtx();
    const idA = await ctx.adapter.createTask({ name: "Task A" });
    const boot = data(await handleChangesSince({}, ctx));

    await ctx.adapter.updateTask(idA, { flagged: true });

    // The entity vanished between the cheap id query and the full fetch.
    ctx.adapter.getTask = () => Promise.reject(new NotFound(`Task not found: ${idA as string}`));
    const d = data(await handleChangesSince({ syncToken: boot.syncToken }, ctx));
    expect(d.reset).toBe(false);
    expect(d.tasks.added).toEqual([]);
    expect(d.tasks.modified).toEqual([]);
  });
});

describe("changes_since — token expiry / unknown", () => {
  it("falls back to a full resync (reset=true) for an unknown token", async () => {
    const ctx = makeCtx();
    await ctx.adapter.createTask({ name: "Task A" });
    const d = data(await handleChangesSince({ syncToken: "deadbeef" }, ctx));
    expect(d.reset).toBe(true);
    expect(d.tasks.added).toHaveLength(1);
  });
});

describe("changes_since — byte savings", () => {
  it("a single-field delta is far smaller than the bootstrap snapshot", async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 25; i += 1) {
      await ctx.adapter.createTask({ name: `Task ${i}`, note: "a".repeat(400) });
    }
    const boot = await handleChangesSince({}, ctx);
    const bootBytes = Buffer.byteLength(JSON.stringify(boot));

    const someId = data(boot).tasks.added[0]?.id as string;
    await ctx.adapter.updateTask(TaskId.of(someId), { flagged: true });
    const delta = await handleChangesSince({ syncToken: data(boot).syncToken }, ctx);
    const deltaBytes = Buffer.byteLength(JSON.stringify(delta));

    expect(deltaBytes).toBeLessThan(bootBytes / 5);
  });
});
