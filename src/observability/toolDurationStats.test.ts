/**
 * Tests for {@link ToolDurationStatsRegistry} — per-tool duration aggregator
 * (#798). Mirrors the responseStats / latencyStats suites: sample-rate
 * gating, aggregate correctness, reservoir cap, threshold transitions,
 * snapshot shape.
 */

import { describe, expect, it, vi } from "vitest";
import { __testing, ToolDurationStatsRegistry } from "./toolDurationStats.js";

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(__testing.percentile([], 0.5)).toBe(0);
  });
  it("interpolates type-7 across samples", () => {
    expect(__testing.percentile([100, 200, 300, 400, 500], 0.5)).toBe(300);
    expect(__testing.percentile([100, 200, 300, 400, 500], 0.95)).toBe(480);
  });
});

describe("ToolDurationStatsRegistry — sample-rate gating", () => {
  it("records nothing when sampleRate is 0", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 0,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 100; i++) reg.record("task_list", 25);
    expect(reg.snapshot().tools).toEqual({});
  });

  it("records every call when sampleRate is 1", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 10; i++) reg.record("task_list", 100);
    expect(reg.snapshot().tools.task_list?.count).toBe(10);
  });

  it("respects an injected random source for fractional rates", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 0.5,
      thresholdMs: Infinity,
      logger: makeLogger(),
      random: () => 0.4,
    });
    for (let i = 0; i < 5; i++) reg.record("t", 100);
    expect(reg.snapshot().tools.t?.count).toBe(5);

    const reg2 = new ToolDurationStatsRegistry({
      sampleRate: 0.5,
      thresholdMs: Infinity,
      logger: makeLogger(),
      random: () => 0.9,
    });
    for (let i = 0; i < 5; i++) reg2.record("t", 100);
    expect(reg2.snapshot().tools).toEqual({});
  });

  it("ignores non-finite or negative durations", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    reg.record("t", Number.NaN);
    reg.record("t", -1);
    reg.record("t", Infinity);
    reg.record("t", 100);
    expect(reg.snapshot().tools.t?.count).toBe(1);
  });
});

describe("ToolDurationStatsRegistry — aggregates", () => {
  it("computes count, max, p50, p95 across many tools", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (const ms of [10, 20, 30, 40, 50]) reg.record("task_list", ms);
    for (const ms of [5, 6, 7]) reg.record("project_list", ms);
    const snap = reg.snapshot();
    expect(snap.tools.task_list).toEqual({ count: 5, max: 50, p50: 30, p95: 48 });
    expect(snap.tools.project_list).toEqual({ count: 3, max: 7, p50: 6, p95: 6.9 });
  });

  it("snapshot includes since / sampleRate / thresholdMs", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 0.25,
      thresholdMs: 2500,
      logger: makeLogger(),
      now: () => new Date("2026-05-17T00:00:00.000Z"),
      random: () => 0.1,
    });
    reg.record("t", 100);
    const snap = reg.snapshot();
    expect(snap.since).toBe("2026-05-17T00:00:00.000Z");
    expect(snap.sampleRate).toBe(0.25);
    expect(snap.thresholdMs).toBe(2500);
  });
});

describe("ToolDurationStatsRegistry — reservoir cap", () => {
  it("caps memory at reservoirSize but keeps lifetime count/max", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
      reservoirSize: 4,
    });
    reg.record("t", 9999);
    for (let i = 0; i < 100; i++) reg.record("t", 100);
    const stats = reg.snapshot().tools.t;
    expect(stats?.count).toBe(101);
    expect(stats?.max).toBe(9999);
    expect(stats?.p50).toBe(100);
  });
});

describe("ToolDurationStatsRegistry — threshold transitions", () => {
  it("emits exactly one warn on cross-above", () => {
    const logger = makeLogger();
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: 500,
      logger,
    });
    for (let i = 0; i < 16; i++) reg.record("task_list", 100);
    expect(logger.warn).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) reg.record("task_list", 3000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      event: "tool.duration.exceeded",
      tool: "task_list",
      thresholdMs: 500,
    });
  });

  it("emits info on recovery and re-warns on next cross-above", () => {
    const logger = makeLogger();
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: 500,
      logger,
      reservoirSize: 32,
    });
    for (let i = 0; i < 32; i++) reg.record("t", 3000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 64; i++) reg.record("t", 10);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tool.duration.recovered", tool: "t" }),
      expect.any(String),
    );
    for (let i = 0; i < 64; i++) reg.record("t", 3000);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("does not emit when threshold is Infinity", () => {
    const logger = makeLogger();
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger,
    });
    for (let i = 0; i < 100; i++) reg.record("t", 999999);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("ToolDurationStatsRegistry — reset", () => {
  it("clears all recorded state", () => {
    const reg = new ToolDurationStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    reg.record("t", 100);
    expect(reg.snapshot().tools.t).toBeDefined();
    reg.reset();
    expect(reg.snapshot().tools).toEqual({});
  });
});
