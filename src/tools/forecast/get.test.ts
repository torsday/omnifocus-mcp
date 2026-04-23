/**
 * Tests for the `forecast_get` tool — schema, description, handler envelope.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ForecastService } from "../../services/forecastService.js";
import { FORECAST_GET_DESCRIPTION, forecastGetInputSchema, handleForecastGet } from "./get.js";

const FROM = "2026-04-23T00:00:00.000Z";
const TO = "2026-04-23T23:59:59.999Z";

function makeCtx() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const forecastService = new ForecastService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { forecastService, makeMeta }, adapter };
}

describe("forecast_get — input schema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const result = forecastGetInputSchema.parse({});
    expect(result.includeOverdue).toBe(true);
    expect(result.includeDeferred).toBe(true);
    expect(result.includeFlagged).toBe(true);
  });

  it("accepts full input", () => {
    const result = forecastGetInputSchema.parse({
      from: FROM,
      to: TO,
      includeOverdue: false,
      includeDeferred: false,
      includeFlagged: false,
    });
    expect(result.from).toBe(FROM);
    expect(result.to).toBe(TO);
    expect(result.includeOverdue).toBe(false);
  });
});

describe("forecast_get — description", () => {
  it("mentions forecast", () => {
    expect(FORECAST_GET_DESCRIPTION).toMatch(/forecast/i);
  });

  it("is read-only (no side effects)", () => {
    expect(FORECAST_GET_DESCRIPTION).toMatch(/no side effects/i);
  });
});

/** Parse input through the schema so defaults are applied (required by TypeScript). */
function parseInput(raw: Parameters<typeof forecastGetInputSchema.parse>[0]) {
  return forecastGetInputSchema.parse(raw);
}

describe("forecast_get — handler", () => {
  it("returns an ok envelope with all four buckets", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(Array.isArray(envelope.data.overdue)).toBe(true);
    expect(Array.isArray(envelope.data.dueToday)).toBe(true);
    expect(Array.isArray(envelope.data.deferredToday)).toBe(true);
    expect(Array.isArray(envelope.data.flagged)).toBe(true);
  });

  it("places a task due today in dueToday", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Due today", dueDate: "2026-04-23T10:00:00.000Z" });
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.dueToday.some((t) => t.name === "Due today")).toBe(true);
  });

  it("places an overdue task in overdue", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Overdue", dueDate: "2026-04-22T10:00:00.000Z" });
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.overdue.some((t) => t.name === "Overdue")).toBe(true);
  });

  it("excludes overdue when includeOverdue=false", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Overdue", dueDate: "2026-04-22T10:00:00.000Z" });
    const envelope = await handleForecastGet(
      parseInput({ from: FROM, to: TO, includeOverdue: false }),
      ctx,
    );
    expect(envelope.data.overdue).toHaveLength(0);
  });

  it("sets cacheHit false in meta", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.meta.cacheHit).toBe(false);
  });
});
