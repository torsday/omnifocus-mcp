/**
 * Tests for {@link LatencyStatsRegistry} — per-transport / per-script
 * latency aggregator (#940). Mirrors the response-stats test suite:
 * sample-rate gating, aggregate correctness, reservoir cap, threshold
 * transitions, snapshot shape, plus a few latency-specific cases
 * (scriptMs vs durationMs fallback, per-transport spawnFloorMs probe).
 */

import { describe, expect, it, vi } from "vitest";
import { __testing, LatencyStatsRegistry } from "./latencyStats.js";

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

describe("LatencyStatsRegistry — sample-rate gating", () => {
  it("records nothing when sampleRate is 0", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 0,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 100; i++) {
      reg.record({ transport: "jxa", scriptName: "task_get", durationMs: 50 });
    }
    expect(reg.snapshot().transports.jxa.scripts).toEqual({});
    expect(reg.snapshot().transports.omnijs.scripts).toEqual({});
  });

  it("records every call when sampleRate is 1", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (let i = 0; i < 10; i++) {
      reg.record({ transport: "jxa", scriptName: "task_get", durationMs: 100 });
    }
    expect(reg.snapshot().transports.jxa.scripts.task_get?.count).toBe(10);
  });

  it("respects an injected random source for fractional rates", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 0.5,
      thresholdMs: Infinity,
      logger: makeLogger(),
      random: () => 0.4,
    });
    for (let i = 0; i < 5; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 50 });
    }
    expect(reg.snapshot().transports.jxa.scripts.s?.count).toBe(5);

    const reg2 = new LatencyStatsRegistry({
      sampleRate: 0.5,
      thresholdMs: Infinity,
      logger: makeLogger(),
      random: () => 0.9,
    });
    for (let i = 0; i < 5; i++) {
      reg2.record({ transport: "jxa", scriptName: "s", durationMs: 50 });
    }
    expect(reg2.snapshot().transports.jxa.scripts).toEqual({});
  });

  it("ignores non-finite or negative ms values", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: Number.NaN });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: -1 });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: Infinity });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 100 });
    expect(reg.snapshot().transports.jxa.scripts.s?.count).toBe(1);
  });
});

describe("LatencyStatsRegistry — scriptMs preference", () => {
  it("records scriptMs when present, durationMs otherwise", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    // With scriptMs: 50ms recorded (durationMs 200 ignored — represents spawn floor)
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 200, scriptMs: 50 });
    // Without scriptMs: durationMs fallback (calibration still in flight)
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 300 });
    const stats = reg.snapshot().transports.jxa.scripts.s;
    expect(stats?.count).toBe(2);
    expect(stats?.max).toBe(300);
    expect(stats?.p50).toBe(175); // mean-interpolated midpoint of [50, 300]
  });
});

describe("LatencyStatsRegistry — aggregates", () => {
  it("computes count, max, p50, p95 per (transport, script)", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    for (const ms of [10, 20, 30, 40, 50]) {
      reg.record({ transport: "jxa", scriptName: "task_get", scriptMs: ms, durationMs: ms });
    }
    for (const ms of [5, 6, 7]) {
      reg.record({
        transport: "omnijs",
        scriptName: "project_create",
        scriptMs: ms,
        durationMs: ms,
      });
    }
    const snap = reg.snapshot();
    expect(snap.transports.jxa.scripts.task_get).toEqual({
      count: 5,
      max: 50,
      p50: 30,
      p95: 48,
    });
    expect(snap.transports.omnijs.scripts.project_create).toEqual({
      count: 3,
      max: 7,
      p50: 6,
      p95: 6.9,
    });
  });

  it("records anonymous calls under (unnamed)", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    reg.record({ transport: "jxa", scriptName: undefined, durationMs: 42 });
    expect(reg.snapshot().transports.jxa.scripts["(unnamed)"]?.count).toBe(1);
  });

  it("snapshot includes since / sampleRate / thresholdMs", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 0.25,
      thresholdMs: 1500,
      logger: makeLogger(),
      now: () => new Date("2026-05-17T00:00:00.000Z"),
      random: () => 0.1,
    });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 100 });
    const snap = reg.snapshot();
    expect(snap.since).toBe("2026-05-17T00:00:00.000Z");
    expect(snap.sampleRate).toBe(0.25);
    expect(snap.thresholdMs).toBe(1500);
  });

  it("includes spawnFloorMs per transport via the lazy probe", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
      getSpawnFloorMs: (t) => (t === "jxa" ? 180 : 0),
    });
    const snap = reg.snapshot();
    expect(snap.transports.jxa.spawnFloorMs).toBe(180);
    expect(snap.transports.omnijs.spawnFloorMs).toBe(0);
  });

  it("emits null spawnFloorMs when no probe is wired", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    const snap = reg.snapshot();
    expect(snap.transports.jxa.spawnFloorMs).toBeNull();
    expect(snap.transports.omnijs.spawnFloorMs).toBeNull();
  });
});

describe("LatencyStatsRegistry — reservoir cap", () => {
  it("caps memory at reservoirSize but keeps lifetime count/max", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
      reservoirSize: 4,
    });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 9999 });
    for (let i = 0; i < 100; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 100 });
    }
    const stats = reg.snapshot().transports.jxa.scripts.s;
    expect(stats?.count).toBe(101);
    expect(stats?.max).toBe(9999);
    expect(stats?.p50).toBe(100);
  });
});

describe("LatencyStatsRegistry — threshold transitions", () => {
  it("emits exactly one warn on cross-above", () => {
    const logger = makeLogger();
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: 500,
      logger,
    });
    for (let i = 0; i < 16; i++) {
      reg.record({ transport: "jxa", scriptName: "task_get", durationMs: 100 });
    }
    expect(logger.warn).not.toHaveBeenCalled();

    for (let i = 0; i < 20; i++) {
      reg.record({ transport: "jxa", scriptName: "task_get", durationMs: 3000 });
    }
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      event: "latency.exceeded",
      transport: "jxa",
      scriptName: "task_get",
      thresholdMs: 500,
    });
  });

  it("emits info on recovery and re-warns on next cross-above", () => {
    const logger = makeLogger();
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: 500,
      logger,
      reservoirSize: 32,
    });
    for (let i = 0; i < 32; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 3000 });
    }
    expect(logger.warn).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 64; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 10 });
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "latency.recovered", transport: "jxa", scriptName: "s" }),
      expect.any(String),
    );

    for (let i = 0; i < 64; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 3000 });
    }
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("does not emit when threshold is Infinity", () => {
    const logger = makeLogger();
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger,
    });
    for (let i = 0; i < 100; i++) {
      reg.record({ transport: "jxa", scriptName: "s", durationMs: 999999 });
    }
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("LatencyStatsRegistry — reset", () => {
  it("clears all recorded state", () => {
    const reg = new LatencyStatsRegistry({
      sampleRate: 1,
      thresholdMs: Infinity,
      logger: makeLogger(),
    });
    reg.record({ transport: "jxa", scriptName: "s", durationMs: 100 });
    expect(reg.snapshot().transports.jxa.scripts.s).toBeDefined();
    reg.reset();
    expect(reg.snapshot().transports.jxa.scripts).toEqual({});
  });
});
