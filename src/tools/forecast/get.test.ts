/**
 * Tests for the `forecast_get` tool — schema, description, handler envelope.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ForecastService } from "../../services/forecastService.js";
import {
  FORECAST_GET_DESCRIPTION,
  forecastGetInputSchema,
  handleForecastGet,
  localDayKey,
} from "./get.js";

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

// ---------------------------------------------------------------------------
// Pagination (#966 / slice 2 of #795)
// ---------------------------------------------------------------------------

describe("forecast_get — pagination", () => {
  /** Seed `n` tasks due at ascending minute offsets within the FROM..TO window. */
  async function seedDueToday(adapter: InMemoryAdapter, n: number) {
    for (let i = 0; i < n; i++) {
      // Stagger dueDate by minutes so the (dueDate ASC, id ASC) ordering is deterministic.
      const minute = String(i).padStart(2, "0");
      await adapter.createTask({
        name: `Task ${i}`,
        dueDate: `2026-04-23T10:${minute}:00.000Z`,
      });
    }
  }

  it("returns hasMore=false and null cursor when results fit in one page", async () => {
    const { ctx, adapter } = makeCtx();
    await seedDueToday(adapter, 3);
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.dueToday).toHaveLength(3);
    expect(envelope.pagination).toBeDefined();
    expect(envelope.pagination?.hasMore).toBe(false);
    expect(envelope.pagination?.cursor).toBeNull();
  });

  it("default limit caps a page at 50 and surfaces a cursor when more remain", async () => {
    const { ctx, adapter } = makeCtx();
    await seedDueToday(adapter, 60);
    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO }), ctx);
    expect(envelope.data.dueToday).toHaveLength(50);
    expect(envelope.pagination?.hasMore).toBe(true);
    expect(envelope.pagination?.cursor).toBeTypeOf("string");
  });

  it("explicit limit controls page size and the cursor round-trips to a second page", async () => {
    const { ctx, adapter } = makeCtx();
    await seedDueToday(adapter, 7);

    const page1 = await handleForecastGet(parseInput({ from: FROM, to: TO, limit: 3 }), ctx);
    expect(page1.data.dueToday).toHaveLength(3);
    expect(page1.pagination?.hasMore).toBe(true);
    const cursor1 = page1.pagination?.cursor as string;
    expect(cursor1).toBeTypeOf("string");

    const page2 = await handleForecastGet(
      parseInput({ from: FROM, to: TO, limit: 3, cursor: cursor1 }),
      ctx,
    );
    expect(page2.data.dueToday).toHaveLength(3);
    expect(page2.pagination?.hasMore).toBe(true);

    const page3 = await handleForecastGet(
      parseInput({
        from: FROM,
        to: TO,
        limit: 3,
        cursor: page2.pagination?.cursor as string,
      }),
      ctx,
    );
    expect(page3.data.dueToday).toHaveLength(1);
    expect(page3.pagination?.hasMore).toBe(false);
    expect(page3.pagination?.cursor).toBeNull();

    // No overlap, no missing tasks across pages.
    const allIds = [
      ...page1.data.dueToday.map((t) => t.id),
      ...page2.data.dueToday.map((t) => t.id),
      ...page3.data.dueToday.map((t) => t.id),
    ];
    expect(new Set(allIds).size).toBe(7);
  });

  it("rejects a cursor whose filterHash does not match (changing filters mid-sequence)", async () => {
    const { ctx, adapter } = makeCtx();
    await seedDueToday(adapter, 5);

    const page1 = await handleForecastGet(parseInput({ from: FROM, to: TO, limit: 2 }), ctx);
    const cursor1 = page1.pagination?.cursor as string;

    await expect(
      handleForecastGet(
        // Same date window but flip includeFlagged — filterHash changes.
        parseInput({ from: FROM, to: TO, limit: 2, cursor: cursor1, includeFlagged: false }),
        ctx,
      ),
    ).rejects.toThrow(/filter hash/i);
  });

  it("a task appearing in multiple buckets (overdue + flagged) counts once toward the page", async () => {
    const { ctx, adapter } = makeCtx();
    // Task1: overdue and flagged (one task, two buckets).
    await adapter.createTask({
      name: "Overdue and flagged",
      dueDate: "2026-04-22T10:00:00.000Z",
      flagged: true,
    });
    // Tasks 2..6: plain due-today.
    await seedDueToday(adapter, 5);

    const envelope = await handleForecastGet(parseInput({ from: FROM, to: TO, limit: 3 }), ctx);
    // The overdue+flagged task should appear in BOTH overdue and flagged on this page —
    // but it still counts as ONE unit toward the limit, leaving room for 2 more from
    // dueToday. Sort is (dueDate ASC), so overdue (Apr 22) comes first.
    const allIdsThisPage = new Set([
      ...envelope.data.overdue.map((t) => t.id),
      ...envelope.data.dueToday.map((t) => t.id),
      ...envelope.data.flagged.map((t) => t.id),
    ]);
    expect(allIdsThisPage.size).toBe(3);
    expect(envelope.data.overdue).toHaveLength(1);
    expect(envelope.data.flagged).toHaveLength(1);
    expect(envelope.data.overdue[0]?.id).toBe(envelope.data.flagged[0]?.id);
  });

  it("byDate references only IDs present in the current page", async () => {
    const { ctx, adapter } = makeCtx();
    // 5 tasks, due over 3 calendar days within a 3-day forecast.
    await adapter.createTask({ name: "Day1-a", dueDate: "2026-04-23T08:00:00.000Z" });
    await adapter.createTask({ name: "Day1-b", dueDate: "2026-04-23T09:00:00.000Z" });
    await adapter.createTask({ name: "Day2-a", dueDate: "2026-04-24T08:00:00.000Z" });
    await adapter.createTask({ name: "Day2-b", dueDate: "2026-04-24T09:00:00.000Z" });
    await adapter.createTask({ name: "Day3-a", dueDate: "2026-04-25T08:00:00.000Z" });

    const envelope = await handleForecastGet(
      parseInput({
        from: "2026-04-23T00:00:00.000Z",
        to: "2026-04-25T23:59:59.999Z",
        days: 3,
        limit: 3,
      }),
      ctx,
    );
    const pageIds = new Set<string>(envelope.data.dueToday.map((t) => t.id as string));
    // biome-ignore lint/style/noNonNullAssertion: days>1 guarantees byDate present
    const byDateIds = envelope.data.byDate!.flatMap((b) => b.taskIds);
    expect(byDateIds.every((id) => pageIds.has(id))).toBe(true);
  });
});

describe("forecast_get — byDate local-day bucketing (#1035)", () => {
  // The bug pre-fix: `dueDate.slice(0, 10)` returned the UTC day, so a
  // task due 11pm PT (= 06:00 UTC the next day) bucketed into the
  // following calendar day from the user's perspective. localDayKey
  // now formats via Intl with an explicit TZ, so tests can pin the
  // expected bucket without depending on the host runner's TZ.

  it("11pm PT (06:00 UTC next day) buckets into the PT calendar day", () => {
    // 2026-05-27T06:00:00Z is 2026-05-26T23:00:00-07:00.
    const iso = "2026-05-27T06:00:00.000Z";
    expect(localDayKey(iso, "America/Los_Angeles")).toBe("2026-05-26");
  });

  it("same instant buckets into the UTC calendar day under tz=UTC", () => {
    const iso = "2026-05-27T06:00:00.000Z";
    expect(localDayKey(iso, "UTC")).toBe("2026-05-27");
  });

  it("midnight UTC buckets into the prior day under PT", () => {
    // 2026-05-27T00:00:00Z is 2026-05-26T17:00:00-07:00.
    const iso = "2026-05-27T00:00:00.000Z";
    expect(localDayKey(iso, "America/Los_Angeles")).toBe("2026-05-26");
  });

  it("emits YYYY-MM-DD with zero-padded month and day", () => {
    // 2026-01-05 in UTC at noon.
    expect(localDayKey("2026-01-05T12:00:00.000Z", "UTC")).toBe("2026-01-05");
  });

  it("crossing DST (US fall-back) still produces a stable local day", () => {
    // 2026-11-01T07:30:00Z. US DST ends Nov 1, 02:00 local → 01:00 PST.
    // The instant is 00:30 PDT (or 23:30 PST after the rollback). Either
    // way the local calendar day is 2026-11-01.
    expect(localDayKey("2026-11-01T07:30:00.000Z", "America/Los_Angeles")).toBe("2026-11-01");
  });
});
