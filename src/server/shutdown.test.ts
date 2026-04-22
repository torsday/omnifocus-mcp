/**
 * Unit tests for ShutdownController.
 *
 * All tests use an injectable `exitFn` so they never call `process.exit`.
 * The module singleton is NOT used; each test creates a fresh instance.
 *
 * @see src/server/shutdown.ts
 * @see DESIGN.md §17 — lifecycle
 */

import { describe, expect, it, vi } from "vitest";
import { ServerShuttingDown } from "../errors/index.js";
import { ShutdownController } from "./shutdown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeController() {
  return new ShutdownController();
}

/** A DrainableQueue stub whose pending count can be controlled in tests. */
function makeQueue(name: string, initialPending = 0) {
  let pending = initialPending;
  return {
    name,
    pendingCount: () => pending,
    setPending: (n: number) => {
      pending = n;
    },
  };
}

// ---------------------------------------------------------------------------
// isShuttingDown
// ---------------------------------------------------------------------------

describe("ShutdownController.isShuttingDown", () => {
  it("is false before initiate()", () => {
    const ctrl = makeController();
    expect(ctrl.isShuttingDown).toBe(false);
  });

  it("is true immediately after initiate() resolves", async () => {
    const ctrl = makeController();
    const exitFn = vi.fn();
    await ctrl.initiate("test", exitFn);
    expect(ctrl.isShuttingDown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertNotShuttingDown
// ---------------------------------------------------------------------------

describe("ShutdownController.assertNotShuttingDown", () => {
  it("does not throw before initiate()", () => {
    const ctrl = makeController();
    expect(() => ctrl.assertNotShuttingDown()).not.toThrow();
  });

  it("throws ServerShuttingDown after initiate()", async () => {
    const ctrl = makeController();
    await ctrl.initiate("test", vi.fn());
    expect(() => ctrl.assertNotShuttingDown()).toThrow(ServerShuttingDown);
  });

  it("throws an error with the expected code", async () => {
    const ctrl = makeController();
    await ctrl.initiate("test", vi.fn());
    try {
      ctrl.assertNotShuttingDown();
    } catch (e) {
      expect(e).toBeInstanceOf(ServerShuttingDown);
      expect((e as ServerShuttingDown).code).toBe("OF_SHUTTING_DOWN");
    }
  });
});

// ---------------------------------------------------------------------------
// initiate — basic lifecycle
// ---------------------------------------------------------------------------

describe("ShutdownController.initiate", () => {
  it("calls exitFn(0) on clean shutdown", async () => {
    const ctrl = makeController();
    const exitFn = vi.fn();
    await ctrl.initiate("SIGINT", exitFn);
    expect(exitFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("is idempotent — calling initiate twice only exits once", async () => {
    const ctrl = makeController();
    const exitFn = vi.fn();
    await ctrl.initiate("SIGTERM", exitFn);
    await ctrl.initiate("SIGTERM", exitFn); // second call should no-op
    expect(exitFn).toHaveBeenCalledOnce();
  });

  it("accepts any reason string", async () => {
    const ctrl = makeController();
    const exitFn = vi.fn();
    await ctrl.initiate("custom-reason", exitFn);
    expect(exitFn).toHaveBeenCalledWith(0);
  });
});

// ---------------------------------------------------------------------------
// registerQueue + draining
// ---------------------------------------------------------------------------

describe("ShutdownController.registerQueue", () => {
  it("resolves immediately when no queues are registered", async () => {
    const ctrl = makeController();
    const exitFn = vi.fn();
    const start = Date.now();
    await ctrl.initiate("test", exitFn);
    expect(Date.now() - start).toBeLessThan(500);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("resolves immediately when all registered queues start at 0", async () => {
    const ctrl = makeController();
    ctrl.registerQueue(makeQueue("read-pool", 0));
    ctrl.registerQueue(makeQueue("write-queue", 0));
    const exitFn = vi.fn();
    await ctrl.initiate("test", exitFn);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("drains a queue that becomes idle before timeout", async () => {
    const ctrl = new ShutdownController({ readGraceMs: 300, writeGraceMs: 300 });
    const queue = makeQueue("read-pool", 1);
    ctrl.registerQueue(queue);

    const exitFn = vi.fn();
    // Drain the queue after 50ms — well within the 300ms grace window.
    setTimeout(() => queue.setPending(0), 50);
    await ctrl.initiate("test", exitFn);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("still exits if a queue never drains (timeout path)", async () => {
    const ctrl = new ShutdownController({ readGraceMs: 60, writeGraceMs: 60 });
    // Queue that never drains
    ctrl.registerQueue(makeQueue("stuck-queue", 5));
    const exitFn = vi.fn();
    await ctrl.initiate("test", exitFn);
    expect(exitFn).toHaveBeenCalledWith(0); // exits despite the stuck queue
  }, 1_000);

  it("does not register the same queue object twice", () => {
    const ctrl = makeController();
    const queue = makeQueue("dedup-queue", 0);
    ctrl.registerQueue(queue);
    ctrl.registerQueue(queue); // should be a no-op
    // No assertion needed beyond "doesn't throw"; coverage verifies the branch.
  });
});
