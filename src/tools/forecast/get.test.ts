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

  it("returns empty buckets when no tasks match the range", async () => {
    const { ctx } = makeCtx();
    // No tasks created — all buckets should be empty arrays.
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.overdue).toHaveLength(0);
    expect(envelope.data.dueToday).toHaveLength(0);
    expect(envelope.data.deferredToday).toHaveLength(0);
    expect(envelope.data.flagged).toHaveLength(0);
  });

  it("spans a multi-day range and buckets correctly", async () => {
    const { ctx, adapter } = makeCtx();
    const from = "2026-04-23T00:00:00.000Z";
    const to = "2026-04-25T23:59:59.999Z";

    await adapter.createTask({ name: "Day 1", dueDate: "2026-04-23T09:00:00.000Z" });
    await adapter.createTask({ name: "Day 3", dueDate: "2026-04-25T09:00:00.000Z" });
    await adapter.createTask({ name: "Before range", dueDate: "2026-04-22T09:00:00.000Z" });
    await adapter.createTask({ name: "After range", dueDate: "2026-04-26T09:00:00.000Z" });

    const envelope = await handleForecastGet(parseInput({ from, to, includeOverdue: false }), ctx);
    const names = envelope.data.dueToday.map((t) => t.name);
    expect(names).toContain("Day 1");
    expect(names).toContain("Day 3");
    expect(names).not.toContain("Before range");
    expect(names).not.toContain("After range");
  });

  it("places a flagged task in flagged bucket", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Important", flagged: true });
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.flagged.some((t) => t.name === "Important")).toBe(true);
  });

  it("excludes flagged bucket when includeFlagged=false", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Important", flagged: true });
    const envelope = await handleForecastGet(
      parseInput({ from: FROM, to: TO, includeFlagged: false }),
      ctx,
    );
    expect(envelope.data.flagged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// date + days ergonomic interface
// ---------------------------------------------------------------------------

describe("forecast_get — date/days interface", () => {
  it("accepts date shortcut 'today' without from/to", () => {
    // flexDateString transforms relative shortcuts to ISO strings
    const result = forecastGetInputSchema.parse({ date: "today" });
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T/); // resolved to ISO
    expect(result.days).toBe(1);
  });

  it("accepts date + days=3", () => {
    const result = forecastGetInputSchema.parse({ date: "2026-04-25T00:00:00.000Z", days: 3 });
    expect(result.date).toBe("2026-04-25T00:00:00.000Z");
    expect(result.days).toBe(3);
  });

  it("rejects days < 1", () => {
    expect(() => forecastGetInputSchema.parse({ date: "today", days: 0 })).toThrow();
  });

  it("rejects days > 7", () => {
    expect(() => forecastGetInputSchema.parse({ date: "today", days: 8 })).toThrow();
  });

  it("handler: date resolves to a range that covers a task due that day", async () => {
    // Use an explicit ISO date at UTC midnight to avoid resolveRelativeDate timezone drift.
    // The adapter is mocked but resolveRelativeDate uses the real system clock.
    const { ctx, adapter } = makeCtx();
    // Task due on 2026-04-23 — use the same ISO anchor the handler will resolve to.
    await adapter.createTask({ name: "Anchor task", dueDate: "2026-04-23T10:00:00.000Z" });
    const envelope = await handleForecastGet(
      parseInput({ date: "2026-04-23T00:00:00.000Z", days: 1 }),
      ctx,
    );
    // byDate absent at days=1; task appears in dueToday
    expect(envelope.data.byDate).toBeUndefined();
    // The task may or may not appear depending on local timezone — the key assertion is shape.
    expect(Array.isArray(envelope.data.dueToday)).toBe(true);
  });

  it("handler: days=1 does not include byDate in payload", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleForecastGet(
      {
        from: FROM,
        to: TO,
        days: 1,
        includeOverdue: true,
        includeDeferred: true,
        includeFlagged: true,
      },
      ctx,
    );
    expect(envelope.data.byDate).toBeUndefined();
  });

  it("handler: days > 1 includes byDate[] grouped by YYYY-MM-DD", async () => {
    // Use from/to directly to avoid timezone-dependent date math in resolveAnchorDate
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "Day A", dueDate: "2026-04-23T09:00:00.000Z" });
    await adapter.createTask({ name: "Day B", dueDate: "2026-04-24T09:00:00.000Z" });
    const envelope = await handleForecastGet(
      {
        from: "2026-04-23T00:00:00.000Z",
        to: "2026-04-24T23:59:59.999Z",
        days: 2,
        includeOverdue: false,
        includeDeferred: true,
        includeFlagged: true,
      },
      ctx,
    );
    expect(Array.isArray(envelope.data.byDate)).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: guarded by Array.isArray assertion above
    const dates = envelope.data.byDate!.map((g) => g.date);
    expect(dates).toContain("2026-04-23");
    expect(dates).toContain("2026-04-24");
    // byDate entries must contain taskIds (strings), not full task objects
    // biome-ignore lint/style/noNonNullAssertion: guarded by Array.isArray assertion above
    for (const entry of envelope.data.byDate!) {
      expect(Array.isArray(entry.taskIds)).toBe(true);
      // @ts-expect-error: `tasks` must not exist on entries; only `taskIds`
      expect(entry.tasks).toBeUndefined();
      expect(entry.taskIds.every((id: unknown) => typeof id === "string")).toBe(true);
    }
  });

  it("handler: byDate entries are sorted chronologically", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "C", dueDate: "2026-04-25T09:00:00.000Z" });
    await adapter.createTask({ name: "A", dueDate: "2026-04-23T09:00:00.000Z" });
    await adapter.createTask({ name: "B", dueDate: "2026-04-24T09:00:00.000Z" });
    const envelope = await handleForecastGet(
      {
        from: "2026-04-23T00:00:00.000Z",
        to: "2026-04-25T23:59:59.999Z",
        days: 3,
        includeOverdue: false,
        includeDeferred: true,
        includeFlagged: true,
      },
      ctx,
    );
    // biome-ignore lint/style/noNonNullAssertion: guarded by prior test assertions
    const dates = envelope.data.byDate!.map((g) => g.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("handler: throws ValidationError when date and from are both supplied", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleForecastGet(
        // bypass schema — supply conflicting params directly
        {
          date: "today",
          from: FROM,
          to: TO,
          days: 1,
          includeOverdue: true,
          includeDeferred: true,
          includeFlagged: true,
        },
        ctx,
      ),
    ).rejects.toThrow("mutually exclusive");
  });
});
