/**
 * Unit tests for LoopDetector and withLoopDetection middleware.
 *
 * Acceptance criteria from #76:
 *   - Identical args → warning fires after threshold (default 5)
 *   - Different args for the same tool → never fires
 *   - Calls outside the window are not counted
 *   - withLoopDetection appends warning to meta.warnings
 *   - withLoopDetection is transparent when no loop is detected
 */

import { describe, expect, it, vi } from "vitest";
import type { ResponseMeta } from "../envelope/index.js";
import { ok } from "../envelope/index.js";
import { buildCallKey, LoopDetector } from "./LoopDetector.js";
import { withLoopDetection } from "./withLoopDetection.js";

vi.mock("../logging/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const fakeMeta: ResponseMeta = {
  correlationId: "test-corr",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "test",
};

function makeHandler<T>(data: T) {
  return () => Promise.resolve(ok(data, fakeMeta));
}

// ---------------------------------------------------------------------------
// LoopDetector
// ---------------------------------------------------------------------------

describe("LoopDetector", () => {
  it("returns undefined for the first N-1 identical calls (below threshold)", () => {
    const detector = new LoopDetector({ threshold: 5, windowSeconds: 60 });
    for (let i = 0; i < 4; i++) {
      expect(detector.record("task_list", { flagged: true })).toBeUndefined();
    }
  });

  it("returns level:warn with WARN_LOOP_DETECTED on the 5th identical call", () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = { projectId: "abc" };
    for (let i = 0; i < 4; i++) detector.record("task_list", args);
    const result = detector.record("task_list", args);
    expect(result).toBeDefined();
    expect(result?.level).toBe("warn");
    expect(result?.warning.code).toBe("WARN_LOOP_DETECTED");
    expect(result?.warning.details).toMatchObject({ tool: "task_list", count: 5 });
  });

  it("continues to return level:warn on calls between threshold and errorThreshold", () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = { projectId: "abc" };
    for (let i = 0; i < 5; i++) detector.record("task_list", args);
    expect(detector.record("task_list", args)?.level).toBe("warn");
    expect(detector.record("task_list", args)?.warning.details?.count).toBe(7);
  });

  it("returns level:error once errorThreshold is reached", () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = { projectId: "abc" };
    for (let i = 0; i < 9; i++) detector.record("task_list", args);
    const result = detector.record("task_list", args);
    expect(result?.level).toBe("error");
    expect(result?.warning.details?.count).toBe(10);
  });

  it("different args for the same tool never trigger the warning", () => {
    const detector = new LoopDetector({ threshold: 5, windowSeconds: 60 });
    for (let i = 0; i < 10; i++) {
      expect(detector.record("task_list", { projectId: `proj-${i}` })).toBeUndefined();
    }
  });

  it("different tools with the same args are tracked independently", () => {
    const detector = new LoopDetector({ threshold: 5, windowSeconds: 60 });
    const args = { id: "x" };
    for (let i = 0; i < 4; i++) detector.record("task_get", args);
    // 4 calls to task_get, 0 to project_get → neither fires
    expect(detector.record("project_get", args)).toBeUndefined();
  });

  it("calls outside the window are pruned and not counted", () => {
    const detector = new LoopDetector({ threshold: 5, windowSeconds: 60 });
    const args = { id: "y" };

    // Simulate 4 old calls by mocking Date.now
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now - 61_000); // 61s in the past
    for (let i = 0; i < 4; i++) detector.record("task_get", args);

    // Restore to "now" — old calls should be pruned
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(detector.record("task_get", args)).toBeUndefined(); // count=1 after prune

    vi.restoreAllMocks();
  });

  it("reset() clears all tracking state", () => {
    const detector = new LoopDetector({ threshold: 5, windowSeconds: 60 });
    const args = { id: "z" };
    for (let i = 0; i < 5; i++) detector.record("task_get", args);
    detector.reset();
    // After reset, first call should not warn
    expect(detector.record("task_get", args)).toBeUndefined();
  });

  it("respects a custom threshold", () => {
    const detector = new LoopDetector({ threshold: 3, errorThreshold: 10, windowSeconds: 60 });
    const args = {};
    detector.record("sync_status", args);
    detector.record("sync_status", args);
    expect(detector.record("sync_status", args)?.warning.code).toBe("WARN_LOOP_DETECTED");
  });
});

// ---------------------------------------------------------------------------
// buildCallKey
// ---------------------------------------------------------------------------

describe("buildCallKey", () => {
  it("is stable regardless of key order in args object", () => {
    const key1 = buildCallKey("task_list", { b: 2, a: 1 });
    const key2 = buildCallKey("task_list", { a: 1, b: 2 });
    expect(key1).toBe(key2);
  });

  it("differs for different tool names with same args", () => {
    expect(buildCallKey("task_list", { id: "x" })).not.toBe(buildCallKey("task_get", { id: "x" }));
  });

  it("distinguishes args that differ only at a nested level", () => {
    // Regression: previously `JSON.stringify(args, Object.keys(args).sort())`
    // dropped nested keys, so two semantically-different `task_update` calls
    // with the same top-level shape collided into the same dedup key and
    // tripped a false-positive WARN_LOOP_DETECTED → OF_LOOP_DETECTED.
    const a = { id: "X", changes: { name: "P1" } };
    const b = { id: "X", changes: { name: "P2" } };
    expect(buildCallKey("task_update", a)).not.toBe(buildCallKey("task_update", b));
  });

  it("is stable regardless of key order at any nesting level", () => {
    const a = { id: "X", changes: { name: "n", note: "x" } };
    const b = { changes: { note: "x", name: "n" }, id: "X" };
    expect(buildCallKey("task_update", a)).toBe(buildCallKey("task_update", b));
  });

  it("does not crash on null/undefined args", () => {
    // Regression: `Object.keys(null)` / `Object.keys(undefined)` throw,
    // so the previous implementation crashed in the middleware before
    // the tool handler ran.
    expect(() => buildCallKey("task_list", null)).not.toThrow();
    expect(() => buildCallKey("task_list", undefined)).not.toThrow();
    expect(buildCallKey("task_list", null)).not.toBe(buildCallKey("task_list", undefined));
  });

  it("distinguishes arrays with different elements", () => {
    expect(buildCallKey("t", { ids: ["a", "b"] })).not.toBe(buildCallKey("t", { ids: ["a", "c"] }));
  });
});

// ---------------------------------------------------------------------------
// withLoopDetection
// ---------------------------------------------------------------------------

describe("withLoopDetection", () => {
  it("is transparent when no loop is detected (returns handler result unchanged)", async () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const result = await withLoopDetection("task_list", {}, detector, makeHandler({ tasks: [] }));
    expect(result.data).toEqual({ tasks: [] });
    expect(result.meta.warnings).toBeUndefined();
  });

  it("appends WARN_LOOP_DETECTED to meta.warnings after threshold", async () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = { flagged: true };
    for (let i = 0; i < 4; i++) {
      await withLoopDetection("task_list", args, detector, makeHandler({ tasks: [] }));
    }
    const result = await withLoopDetection("task_list", args, detector, makeHandler({ tasks: [] }));
    expect(result.meta.warnings).toHaveLength(1);
    expect(result.meta.warnings?.[0]?.code).toBe("WARN_LOOP_DETECTED");
  });

  it("throws LoopDetected (OF_LOOP_DETECTED) once errorThreshold is reached", async () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = { id: "stuck" };
    for (let i = 0; i < 9; i++) {
      detector.record("task_get", args); // record without running handler
    }
    await expect(
      withLoopDetection("task_get", args, detector, makeHandler({ id: "x" })),
    ).rejects.toMatchObject({ code: "OF_LOOP_DETECTED" });
  });

  it("preserves existing warnings when appending loop warning", async () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = {};
    const existingWarning = {
      code: "WARN_SYNC_PENDING" as const,
      message: "pending",
    };
    const handlerWithWarning = () =>
      Promise.resolve(ok({ id: "x" }, { ...fakeMeta, warnings: [existingWarning] }));

    for (let i = 0; i < 4; i++) detector.record("task_update", args);
    const result = await withLoopDetection("task_update", args, detector, handlerWithWarning);

    expect(result.meta.warnings).toHaveLength(2);
    expect(result.meta.warnings?.[0]?.code).toBe("WARN_SYNC_PENDING");
    expect(result.meta.warnings?.[1]?.code).toBe("WARN_LOOP_DETECTED");
  });

  it("does not mutate the original meta.warnings array", async () => {
    const detector = new LoopDetector({ threshold: 5, errorThreshold: 10, windowSeconds: 60 });
    const args = {};
    const original = [{ code: "WARN_SYNC_PENDING" as const, message: "x" }];
    const handlerWithWarning = () =>
      Promise.resolve(ok({ id: "x" }, { ...fakeMeta, warnings: original }));

    for (let i = 0; i < 4; i++) detector.record("task_update", args);
    await withLoopDetection("task_update", args, detector, handlerWithWarning);

    expect(original).toHaveLength(1); // original untouched
  });
});
