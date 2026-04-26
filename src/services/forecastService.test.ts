/**
 * Tests for `ForecastService` — grouped forecast results via InMemoryAdapter.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { ForecastService } from "./forecastService.js";

const FROM = "2026-04-23T00:00:00.000Z";
const TO = "2026-04-23T23:59:59.999Z";

function makeService() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const service = new ForecastService({ adapter });
  return { adapter, service };
}

describe("ForecastService.get", () => {
  it("returns empty buckets when no tasks exist", async () => {
    const { service } = makeService();
    const result = await service.get({ from: FROM, to: TO });
    expect(result.overdue).toHaveLength(0);
    expect(result.dueToday).toHaveLength(0);
    expect(result.deferredToday).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it("places a task due today in dueToday", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Due today", dueDate: "2026-04-23T09:00:00.000Z" });
    const result = await service.get({ from: FROM, to: TO });
    expect(result.dueToday.some((t) => t.name === "Due today")).toBe(true);
    expect(result.overdue).toHaveLength(0);
  });

  it("places a task due yesterday in overdue", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Overdue", dueDate: "2026-04-22T09:00:00.000Z" });
    const result = await service.get({ from: FROM, to: TO });
    expect(result.overdue.some((t) => t.name === "Overdue")).toBe(true);
    expect(result.dueToday).toHaveLength(0);
  });

  it("places a task with deferDate today in deferredToday", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Deferred today", deferDate: "2026-04-23T08:00:00.000Z" });
    const result = await service.get({ from: FROM, to: TO });
    expect(result.deferredToday.some((t) => t.name === "Deferred today")).toBe(true);
  });

  it("places a flagged task in flagged", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Flagged", flagged: true });
    const result = await service.get({ from: FROM, to: TO });
    expect(result.flagged.some((t) => t.name === "Flagged")).toBe(true);
  });

  it("excludes completed tasks from all buckets", async () => {
    const { adapter, service } = makeService();
    const id = await adapter.createTask({
      name: "Completed due today",
      dueDate: "2026-04-23T09:00:00.000Z",
      flagged: true,
    });
    await adapter.completeTask(id);
    const result = await service.get({ from: FROM, to: TO });
    expect(result.dueToday).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it("excludes dropped tasks from all buckets", async () => {
    const { adapter, service } = makeService();
    const id = await adapter.createTask({
      name: "Dropped overdue",
      dueDate: "2026-04-22T09:00:00.000Z",
    });
    await adapter.dropTask(id);
    const result = await service.get({ from: FROM, to: TO });
    expect(result.overdue).toHaveLength(0);
  });

  it("omits overdue bucket when includeOverdue=false", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Overdue", dueDate: "2026-04-22T09:00:00.000Z" });
    const result = await service.get({ from: FROM, to: TO, includeOverdue: false });
    expect(result.overdue).toHaveLength(0);
  });

  it("omits deferredToday when includeDeferred=false", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Deferred", deferDate: "2026-04-23T08:00:00.000Z" });
    const result = await service.get({ from: FROM, to: TO, includeDeferred: false });
    expect(result.deferredToday).toHaveLength(0);
  });

  it("omits flagged when includeFlagged=false", async () => {
    const { adapter, service } = makeService();
    await adapter.createTask({ name: "Flagged", flagged: true });
    const result = await service.get({ from: FROM, to: TO, includeFlagged: false });
    expect(result.flagged).toHaveLength(0);
  });

  it("reports cacheHit false", async () => {
    const { service } = makeService();
    const result = await service.get({ from: FROM, to: TO });
    expect(result.cacheHit).toBe(false);
  });
});
