/**
 * Unit tests for `ReadPool`.
 */

import { describe, expect, it } from "vitest";
import { ReadPool } from "./ReadPool.js";

/** A promise plus resolvers — the deferred-promise pattern used to control timing in tests. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ReadPool", () => {
  it("rejects invalid sizes at construction", () => {
    expect(() => new ReadPool({ size: 0 })).toThrow(RangeError);
    expect(() => new ReadPool({ size: -1 })).toThrow(RangeError);
    expect(() => new ReadPool({ size: 1.5 })).toThrow(RangeError);
  });

  it("runs fn and returns its value", async () => {
    const pool = new ReadPool({ size: 2 });
    await expect(pool.run(async () => 42)).resolves.toBe(42);
  });

  it("never exceeds the configured concurrency", async () => {
    const pool = new ReadPool({ size: 2 });
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let concurrent = 0;
    let maxConcurrent = 0;

    const runs = gates.map((g, i) =>
      pool.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await g.promise;
        concurrent--;
        return i;
      }),
    );

    // Let the event loop turn so the first two start.
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.inFlightCount()).toBe(2);
    expect(pool.waitingCount()).toBe(1);

    gates[0]?.resolve();
    await runs[0];
    gates[1]?.resolve();
    gates[2]?.resolve();
    await Promise.all(runs);

    expect(maxConcurrent).toBe(2);
    expect(pool.pendingCount()).toBe(0);
  });

  it("dispatches waiters in FIFO order as slots free", async () => {
    const pool = new ReadPool({ size: 1 });
    const order: number[] = [];
    const gate = deferred<void>();

    const p1 = pool.run(async () => {
      order.push(1);
      await gate.promise;
    });
    const p2 = pool.run(async () => {
      order.push(2);
    });
    const p3 = pool.run(async () => {
      order.push(3);
    });

    await Promise.resolve();
    expect(order).toEqual([1]);
    gate.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("releases the slot when fn throws, so the next waiter proceeds", async () => {
    const pool = new ReadPool({ size: 1 });
    const ran: string[] = [];

    const failing = pool.run(async () => {
      ran.push("fail");
      throw new Error("boom");
    });
    const after = pool.run(async () => {
      ran.push("after");
    });

    await expect(failing).rejects.toThrow("boom");
    await after;
    expect(ran).toEqual(["fail", "after"]);
    expect(pool.pendingCount()).toBe(0);
  });

  it("exposes pendingCount = inFlight + waiting", async () => {
    const pool = new ReadPool({ size: 1 });
    const g1 = deferred<void>();
    const g2 = deferred<void>();

    const r1 = pool.run(() => g1.promise);
    const r2 = pool.run(() => g2.promise);

    await Promise.resolve();
    expect(pool.inFlightCount()).toBe(1);
    expect(pool.waitingCount()).toBe(1);
    expect(pool.pendingCount()).toBe(2);

    g1.resolve();
    await r1;
    g2.resolve();
    await r2;
    expect(pool.pendingCount()).toBe(0);
  });

  it("uses the configured name on the DrainableQueue contract", () => {
    expect(new ReadPool({ size: 2 }).name).toBe("read-pool");
    expect(new ReadPool({ size: 2, name: "jxa-reads" }).name).toBe("jxa-reads");
  });
});
