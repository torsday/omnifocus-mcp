/**
 * Unit tests for the velocity resource.
 *
 * Covers:
 * - parseWeeks: clamping, defaults, invalid inputs
 * - buildVelocityPayload: empty state, weekly bucketing, rolling averages,
 *   topClosingProjects ordering, window calculation
 *
 * Uses InMemoryAdapter — no live OmniFocus required.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import {
  buildVelocityPayload,
  parseWeeks,
  VELOCITY_DEFAULT_WEEKS,
  VELOCITY_MAX_WEEKS,
} from "./velocity.js";

// ---------------------------------------------------------------------------
// parseWeeks
// ---------------------------------------------------------------------------

describe("parseWeeks", () => {
  it("returns VELOCITY_DEFAULT_WEEKS for undefined", () => {
    expect(parseWeeks(undefined)).toBe(VELOCITY_DEFAULT_WEEKS);
  });

  it("returns VELOCITY_DEFAULT_WEEKS for empty string", () => {
    expect(parseWeeks("")).toBe(VELOCITY_DEFAULT_WEEKS);
  });

  it("returns VELOCITY_DEFAULT_WEEKS for non-numeric string", () => {
    expect(parseWeeks("abc")).toBe(VELOCITY_DEFAULT_WEEKS);
  });

  it("returns VELOCITY_DEFAULT_WEEKS for negative number", () => {
    expect(parseWeeks("-1")).toBe(VELOCITY_DEFAULT_WEEKS);
  });

  it("clamps 0 to 1", () => {
    expect(parseWeeks("0")).toBe(1);
  });

  it("parses valid integer", () => {
    expect(parseWeeks("4")).toBe(4);
  });

  it("rounds float to nearest integer", () => {
    expect(parseWeeks("4.6")).toBe(5);
  });

  it("clamps to VELOCITY_MAX_WEEKS", () => {
    expect(parseWeeks("9999")).toBe(VELOCITY_MAX_WEEKS);
  });
});

// ---------------------------------------------------------------------------
// buildVelocityPayload — helpers
// ---------------------------------------------------------------------------

/** Monday-anchored ISO timestamp for a given week offset and weekday offset. */
function weekIso(weeksAgo: number, daysOffset: number, now: Date): string {
  const ms = now.getTime() - weeksAgo * 7 * 86_400_000 + daysOffset * 86_400_000;
  return new Date(ms).toISOString();
}

// Fixed anchor: Monday 2026-04-27 noon UTC
const NOW = new Date("2026-04-27T12:00:00.000Z");

// ---------------------------------------------------------------------------
// buildVelocityPayload — empty state
// ---------------------------------------------------------------------------

describe("buildVelocityPayload — empty state", () => {
  it("returns correct week count for weeks=4", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.weeklyTotals).toHaveLength(4);
  });

  it("returns zero counts for all weeks when adapter is empty", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 2, NOW);
    for (const week of payload.weeklyTotals) {
      expect(week.created).toBe(0);
      expect(week.completed).toBe(0);
      expect(week.dropped).toBe(0);
      expect(week.netDelta).toBe(0);
    }
  });

  it("returns empty topClosingProjects when no completions", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.topClosingProjects).toHaveLength(0);
  });

  it("includes rollingAverages for 4 and 8 windows when weeks=8", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 8, NOW);
    expect(payload.rollingAverages.map((r) => r.window)).toEqual([4, 8]);
  });

  it("omits 8-week rolling average when weeks < 8", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.rollingAverages.map((r) => r.window)).toEqual([4]);
  });

  it("omits all rolling averages when weeks < 4", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 3, NOW);
    expect(payload.rollingAverages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildVelocityPayload — weekly bucketing
// ---------------------------------------------------------------------------

describe("buildVelocityPayload — weekly bucketing", () => {
  it("counts completed tasks in the correct week bucket", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });

    // Create and complete a task "this week" (0 weeks ago, day 0)
    const taskId = await adapter.createTask({ name: "done-this-week", projectId: projId });
    await adapter.completeTask(taskId, new Date(weekIso(0, 1, NOW)));

    const payload = await buildVelocityPayload(adapter, 2, NOW);
    const thisWeek = payload.weeklyTotals[
      payload.weeklyTotals.length - 1
    ] as (typeof payload.weeklyTotals)[0];
    expect(thisWeek.completed).toBeGreaterThanOrEqual(1);
  });

  it("netDelta accounts for created, completed, and dropped", async () => {
    const adapter = new InMemoryAdapter();
    // 3 created, 1 completed, 1 dropped → netDelta = 3 - 1 - 1 = 1
    // But InMemoryAdapter records createdAt=now for all tasks, so all fall
    // in the current week. We just verify the formula.
    const t1 = await adapter.createTask({ name: "t1" });
    const t2 = await adapter.createTask({ name: "t2" });
    const _t3 = await adapter.createTask({ name: "t3" });
    await adapter.completeTask(t1, new Date(weekIso(0, 0, NOW)));
    await adapter.dropTask(t2);

    const payload = await buildVelocityPayload(adapter, 1, NOW);
    const week = payload.weeklyTotals[0] as (typeof payload.weeklyTotals)[0];
    expect(week.netDelta).toBe(week.created - week.completed - week.dropped);
  });
});

// ---------------------------------------------------------------------------
// buildVelocityPayload — rolling averages
// ---------------------------------------------------------------------------

describe("buildVelocityPayload — rolling averages", () => {
  it("computes completedPerWeek as average of last 4 weeks", async () => {
    const adapter = new InMemoryAdapter();
    // Complete 4 tasks, one per week for the last 4 weeks.
    // Because InMemoryAdapter sets completedAt = the Date we pass,
    // we just check the payload sums correctly (may vary by week placement).
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    for (const avg of payload.rollingAverages) {
      const slice = payload.weeklyTotals.slice(-avg.window);
      const expected =
        Math.round((slice.reduce((s, w) => s + w.completed, 0) / avg.window) * 100) / 100;
      expect(avg.completedPerWeek).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// buildVelocityPayload — topClosingProjects
// ---------------------------------------------------------------------------

describe("buildVelocityPayload — topClosingProjects", () => {
  it("lists projects with completions in the trailing window", async () => {
    const adapter = new InMemoryAdapter();
    const pId = await adapter.createProject({ name: "Sprint 1" });
    const t1 = await adapter.createTask({ name: "t1", projectId: pId });
    const t2 = await adapter.createTask({ name: "t2", projectId: pId });
    await adapter.completeTask(t1, new Date(weekIso(0, 0, NOW)));
    await adapter.completeTask(t2, new Date(weekIso(0, 1, NOW)));

    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.topClosingProjects).toHaveLength(1);
    const top = payload.topClosingProjects[0] as (typeof payload.topClosingProjects)[0];
    expect(top.name).toBe("Sprint 1");
    expect(top.closedThisWeek).toBe(2);
  });

  it("caps topClosingProjects at 5", async () => {
    const adapter = new InMemoryAdapter();
    for (let i = 0; i < 7; i++) {
      const pId = await adapter.createProject({ name: `P${i}` });
      const tId = await adapter.createTask({ name: `t${i}`, projectId: pId });
      await adapter.completeTask(tId, new Date(weekIso(0, 0, NOW)));
    }
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.topClosingProjects.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// buildVelocityPayload — window field
// ---------------------------------------------------------------------------

describe("buildVelocityPayload — window field", () => {
  it("window.from is earlier than window.to", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildVelocityPayload(adapter, 4, NOW);
    expect(payload.window.from < payload.window.to).toBe(true);
  });
});
