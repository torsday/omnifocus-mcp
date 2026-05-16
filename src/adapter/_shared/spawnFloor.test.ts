/**
 * Unit tests for the osascript spawn-floor calibration module (#939).
 *
 * The module owns one piece of process-scoped state (`cached`) plus an
 * in-flight promise dedupe. Tests use `__resetSpawnFloorForTesting()` to
 * isolate each case.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSpawnFloorForTesting,
  ensureSpawnFloorCalibration,
  getSpawnFloorMs,
} from "./spawnFloor.js";

type FakeSpawner = (scriptBody: string, jsonArg: string, timeoutMs: number) => Promise<unknown>;

afterEach(() => {
  __resetSpawnFloorForTesting();
});

describe("spawnFloor — initial state", () => {
  it("returns undefined before any calibration call", () => {
    expect(getSpawnFloorMs()).toBeUndefined();
  });
});

describe("ensureSpawnFloorCalibration", () => {
  it("invokes the spawner once and caches the result", async () => {
    const spawner = vi.fn<FakeSpawner>(async () => ({}));
    const ms = await ensureSpawnFloorCalibration(spawner);
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(spawner).toHaveBeenCalledTimes(1);
    expect(getSpawnFloorMs()).toBe(ms);
  });

  it("dedupes concurrent calls onto a single inflight calibration", async () => {
    // Hold the spawner pending until we explicitly resolve so the two
    // ensureSpawnFloorCalibration calls overlap.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spawner = vi.fn<FakeSpawner>(async () => {
      await gate;
      return {};
    });
    const a = ensureSpawnFloorCalibration(spawner);
    const b = ensureSpawnFloorCalibration(spawner);
    release();
    const [r1, r2] = await Promise.all([a, b]);
    expect(spawner).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("returns the cached value on subsequent calls without re-spawning", async () => {
    const spawner = vi.fn<FakeSpawner>(async () => ({}));
    const first = await ensureSpawnFloorCalibration(spawner);
    const second = await ensureSpawnFloorCalibration(spawner);
    expect(second).toBe(first);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it("still caches a value when the spawner rejects (so a failing host doesn't retry every call)", async () => {
    const spawner = vi.fn<FakeSpawner>(async () => {
      throw new Error("osascript missing");
    });
    const ms = await ensureSpawnFloorCalibration(spawner);
    expect(typeof ms).toBe("number");
    expect(getSpawnFloorMs()).toBe(ms);
    // A second call must not re-attempt the failing spawn.
    await ensureSpawnFloorCalibration(spawner);
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it("passes the calibration script and a timeout to the spawner", async () => {
    const spawner = vi.fn<FakeSpawner>(async () => ({}));
    await ensureSpawnFloorCalibration(spawner);
    const [scriptBody, jsonArg, timeoutMs] = spawner.mock.calls[0] as [string, string, number];
    expect(scriptBody).toContain("function run");
    expect(jsonArg).toBe("{}");
    expect(timeoutMs).toBeGreaterThan(0);
  });
});
