import { describe, expect, test } from "vitest";
import { aggregateWorkflow } from "./aggregate.js";
import type { ScriptCallEvent } from "./types.js";

function ev(
  scriptName: string | undefined,
  durationMs: number,
  sequence: number,
  spawnFloorMs?: number,
): ScriptCallEvent {
  return {
    transport: "jxa",
    scriptName,
    durationMs,
    outcome: "ok",
    sequence,
    ...(spawnFloorMs !== undefined ? { spawnFloorMs } : {}),
  };
}

describe("aggregateWorkflow", () => {
  test("empty events produce an empty workflow rollup", () => {
    const r = aggregateWorkflow("wf", []);
    expect(r.callCount).toBe(0);
    expect(r.byScript).toEqual({});
    expect(r.totalDurationMs).toBe(0);
    expect(r.spawnPctOfTotal).toBe(0);
  });

  test("first call to each script is cold; rest are warm", () => {
    const r = aggregateWorkflow("wf", [
      ev("task_list", 500, 0), // cold
      ev("task_list", 50, 1), // warm
      ev("task_list", 60, 2), // warm
      ev("project_get", 700, 3), // cold (first of its kind)
    ]);
    expect(r.byScript.task_list).toBeDefined();
    expect(r.byScript.task_list?.count).toBe(3);
    expect(r.byScript.task_list?.coldP95Ms).toBe(500);
    expect(r.byScript.task_list?.warmP95Ms).toBe(60);
    expect(r.byScript.project_get).toBeDefined();
    expect(r.byScript.project_get?.count).toBe(1);
    expect(r.byScript.project_get?.coldP95Ms).toBe(700);
    expect(r.byScript.project_get?.warmP95Ms).toBeNull();
  });

  test("warmP95 is null when a script is called exactly once", () => {
    const r = aggregateWorkflow("wf", [ev("ping", 12, 0)]);
    expect(r.byScript.ping?.warmP95Ms).toBeNull();
    expect(r.byScript.ping?.coldP95Ms).toBe(12);
  });

  test("p50/p95/max are computed across all calls of a script", () => {
    const r = aggregateWorkflow("wf", [
      ev("foo", 10, 0),
      ev("foo", 20, 1),
      ev("foo", 30, 2),
      ev("foo", 40, 3),
      ev("foo", 50, 4),
    ]);
    const s = r.byScript.foo;
    expect(s?.count).toBe(5);
    expect(s?.maxMs).toBe(50);
    // nearest-rank: p50 → ceil(0.5*5) = 3rd → 30; p95 → ceil(0.95*5) = 5th → 50
    expect(s?.p50Ms).toBe(30);
    expect(s?.p95Ms).toBe(50);
  });

  test("unannotated calls land in __unknown__ (still aggregated, never dropped)", () => {
    const r = aggregateWorkflow("wf", [ev(undefined, 1, 0), ev(undefined, 2, 1)]);
    expect(r.byScript.__unknown__?.count).toBe(2);
  });

  test("sequence numbers — not array order — decide cold", () => {
    // Events arrive out-of-order; aggregator should still pick sequence 0 as cold.
    const r = aggregateWorkflow("wf", [
      ev("task_list", 50, 1), // warm
      ev("task_list", 500, 0), // cold (lower sequence)
      ev("task_list", 60, 2), // warm
    ]);
    expect(r.byScript.task_list?.coldP95Ms).toBe(500);
  });

  test("spawnPctOfTotal reports 0 when no spawnFloor samples are available", () => {
    const r = aggregateWorkflow("wf", [ev("task_list", 100, 0), ev("task_list", 50, 1)]);
    expect(r.spawnPctOfTotal).toBe(0);
  });

  test("spawnPctOfTotal reflects calibrated spawn floor when present", () => {
    const r = aggregateWorkflow("wf", [
      ev("task_list", 200, 0, 80), // spawn floor 80ms, total 200ms
      ev("task_list", 100, 1, 80),
    ]);
    // 2 samples × 80ms spawn floor = 160ms; total 300ms; share = 53.3%.
    expect(r.spawnPctOfTotal).toBeCloseTo(53.3, 0);
  });
});
