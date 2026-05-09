/**
 * Tests for {@link ResponseStatsRegistry} — per-tool response-byte aggregator
 * (#778). Covers: sample-rate gating (0 disables, 1 records all, fractional
 * uses the injected RNG), aggregate correctness (count/total/max/p50/p95),
 * reservoir cap (max stays lifetime-correct after eviction), threshold
 * transitions (one event per crossing), and snapshot shape.
 */

import { describe, expect, it, vi } from "vitest";
import { __testing, ResponseStatsRegistry } from "./responseStats.js";

function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
  };
}

describe("percentile", () => {
  it("returns 0 for an empty array (defined fallback)", () => {
    expect(__testing.percentile([], 0.5)).toBe(0);
  });

  it("interpolates between samples (type-7)", () => {
    // 5 samples: rank for p50 = 0.5 * 4 = 2 → exact element 200
    expect(__testing.percentile([100, 200, 300, 400, 500], 0.5)).toBe(300);
    // p95 of 5 samples: rank = 0.95 * 4 = 3.8 → 400 + 0.8*(500-400) = 480
    expect(__testing.percentile([100, 200, 300, 400, 500], 0.95)).toBe(480);
  });

  it("does not mutate the input", () => {
    const samples = [3, 1, 2];
    __testing.percentile(samples, 0.5);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe("ResponseStatsRegistry — sample-rate gating", () => {
  it("records nothing when sampleRate is 0", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 0,
      thresholdBytes: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 100; i++) reg.record("task_list", 1024);
    expect(reg.snapshot().tools).toEqual({});
  });

  it("records every call when sampleRate is 1", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 10; i++) reg.record("task_list", 100);
    expect(reg.snapshot().tools.task_list?.count).toBe(10);
  });

  it("respects an injected random source for fractional rates", () => {
    // random() returns 0.4 every call; with sampleRate 0.5, 0.4 < 0.5 → record
    let calls = 0;
    const reg = new ResponseStatsRegistry({
      sampleRate: 0.5,
      thresholdBytes: Infinity,
      logger: makeLogger(),
      random: () => {
        calls += 1;
        return 0.4;
      },
    });
    for (let i = 0; i < 5; i++) reg.record("t", 100);
    expect(calls).toBe(5);
    expect(reg.snapshot().tools.t?.count).toBe(5);

    // random() returns 0.9; with sampleRate 0.5, 0.9 >= 0.5 → skip
    const reg2 = new ResponseStatsRegistry({
      sampleRate: 0.5,
      thresholdBytes: Infinity,
      logger: makeLogger(),
      random: () => 0.9,
    });
    for (let i = 0; i < 5; i++) reg2.record("t", 100);
    expect(reg2.snapshot().tools).toEqual({});
  });

  it("ignores non-finite or negative byte values without crashing", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: makeLogger(),
    });
    reg.record("t", Number.NaN);
    reg.record("t", -1);
    reg.record("t", Infinity);
    reg.record("t", 100);
    expect(reg.snapshot().tools.t?.count).toBe(1);
  });
});

describe("ResponseStatsRegistry — aggregates", () => {
  it("computes count, total, max, p50, p95 correctly across many tools", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: makeLogger(),
    });

    // task_list: 5 samples
    for (const b of [100, 200, 300, 400, 500]) reg.record("task_list", b);
    // project_list: 3 samples
    for (const b of [50, 60, 70]) reg.record("project_list", b);

    const snap = reg.snapshot();
    expect(snap.tools.task_list).toEqual({
      count: 5,
      total: 1500,
      max: 500,
      p50: 300,
      p95: 480,
    });
    expect(snap.tools.project_list).toEqual({
      count: 3,
      total: 180,
      max: 70,
      p50: 60,
      p95: 69,
    });
  });

  it("snapshot includes since (ISO timestamp), sampleRate, thresholdBytes", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 0.25,
      thresholdBytes: 50000,
      logger: makeLogger(),
      now: () => new Date("2026-05-09T00:00:00.000Z"),
      random: () => 0.1,
    });
    reg.record("t", 100);
    const snap = reg.snapshot();
    expect(snap.since).toBe("2026-05-09T00:00:00.000Z");
    expect(snap.sampleRate).toBe(0.25);
    expect(snap.thresholdBytes).toBe(50000);
  });
});

describe("ResponseStatsRegistry — reservoir cap", () => {
  it("caps memory at reservoirSize but keeps lifetime count/total/max", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: makeLogger(),
      reservoirSize: 4,
    });

    // First record a big sample so max is set, then flood with smaller ones
    reg.record("t", 9999);
    for (let i = 0; i < 100; i++) reg.record("t", 100);

    const stats = reg.snapshot().tools.t;
    expect(stats?.count).toBe(101);
    expect(stats?.total).toBe(9999 + 100 * 100);
    expect(stats?.max).toBe(9999); // lifetime, not bounded by ring
    // p50 across the last 4 samples (all 100s) is 100
    expect(stats?.p50).toBe(100);
  });
});

describe("ResponseStatsRegistry — threshold transitions", () => {
  it("emits exactly one warn when p95 crosses above threshold", () => {
    const logger = makeLogger();
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: 1000,
      logger,
    });

    // 16 small samples: under threshold, no event (and below the 16-sample
    // floor that suppresses noisy early evaluation).
    for (let i = 0; i < 16; i++) reg.record("t", 100);
    expect(logger.warn).not.toHaveBeenCalled();

    // Push p95 above threshold by adding many large samples.
    for (let i = 0; i < 20; i++) reg.record("t", 5000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [arg] = logger.warn.mock.calls[0] ?? [];
    expect(arg).toMatchObject({
      event: "response.size.exceeded",
      tool: "t",
      thresholdBytes: 1000,
    });
    expect(typeof (arg as { p95Bytes: number }).p95Bytes).toBe("number");
  });

  it("emits info on recovery and re-warns on the next crossing", () => {
    const logger = makeLogger();
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: 1000,
      logger,
      reservoirSize: 32,
    });

    // Cross above
    for (let i = 0; i < 32; i++) reg.record("t", 5000);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Flood with small samples to flush reservoir below threshold
    for (let i = 0; i < 64; i++) reg.record("t", 10);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "response.size.recovered", tool: "t" }),
      expect.any(String),
    );

    // Cross above again
    for (let i = 0; i < 64; i++) reg.record("t", 5000);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("does not emit when threshold is Infinity (disabled)", () => {
    const logger = makeLogger();
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger,
    });
    for (let i = 0; i < 100; i++) reg.record("t", 1_000_000);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("ResponseStatsRegistry — reset", () => {
  it("clears all recorded state", () => {
    const reg = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: makeLogger(),
    });
    reg.record("t", 100);
    expect(reg.snapshot().tools.t).toBeDefined();
    reg.reset();
    expect(reg.snapshot().tools).toEqual({});
  });
});
