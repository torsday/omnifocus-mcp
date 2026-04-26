/**
 * Unit tests for `WriteQueue`.
 */

import { describe, expect, it } from "vitest";
import { QueueFull } from "../errors/index.js";
import { WriteQueue } from "./WriteQueue.js";

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

describe("WriteQueue", () => {
  it("rejects invalid caps at construction", () => {
    expect(() => new WriteQueue({ cap: 0 })).toThrow(RangeError);
    expect(() => new WriteQueue({ cap: -1 })).toThrow(RangeError);
    expect(() => new WriteQueue({ cap: 2.5 })).toThrow(RangeError);
  });

  it("runs a single call and returns its value", async () => {
    const q = new WriteQueue({ cap: 10 });
    await expect(q.run(async () => "ok")).resolves.toBe("ok");
  });

  it("runs calls strictly serially", async () => {
    const q = new WriteQueue({ cap: 10 });
    const order: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];

    const runs = gates.map((g, i) =>
      q.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(`start-${i}`);
        await g.promise;
        order.push(`end-${i}`);
        concurrent--;
      }),
    );

    await Promise.resolve();
    expect(q.inFlightCount()).toBe(1);
    expect(q.waitingCount()).toBe(2);

    gates[0]?.resolve();
    gates[1]?.resolve();
    gates[2]?.resolve();
    await Promise.all(runs);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(["start-0", "end-0", "start-1", "end-1", "start-2", "end-2"]);
  });

  it("throws QueueFull synchronously when pending reaches the cap", () => {
    const q = new WriteQueue({ cap: 2, name: "jxa-writes" });
    const g1 = deferred<void>();
    const g2 = deferred<void>();

    void q.run(() => g1.promise);
    void q.run(() => g2.promise);

    expect(() => q.run(async () => undefined)).toThrow(QueueFull);

    // Confirm details payload carries queue name, cap, pending for the agent.
    try {
      q.run(async () => undefined);
    } catch (err) {
      expect(err).toBeInstanceOf(QueueFull);
      expect((err as QueueFull).code).toBe("OF_QUEUE_FULL");
      expect((err as QueueFull).details).toEqual({ queue: "jxa-writes", cap: 2, pending: 2 });
    }

    g1.resolve();
    g2.resolve();
  });

  it("accepts a new call after an in-flight one completes and frees a slot", async () => {
    const q = new WriteQueue({ cap: 2 });
    const g1 = deferred<void>();
    const g2 = deferred<void>();

    const r1 = q.run(() => g1.promise);
    const r2 = q.run(() => g2.promise);
    expect(() => q.run(async () => undefined)).toThrow(QueueFull);

    g1.resolve();
    await r1;
    // One slot free — this call must not throw.
    const r3 = q.run(async () => "ok");
    g2.resolve();
    await r2;
    await expect(r3).resolves.toBe("ok");
  });

  it("does not stall the queue when a call rejects", async () => {
    const q = new WriteQueue({ cap: 10 });
    const ran: string[] = [];

    const failing = q.run(async () => {
      ran.push("fail");
      throw new Error("boom");
    });
    const after = q.run(async () => {
      ran.push("after");
    });

    await expect(failing).rejects.toThrow("boom");
    await after;
    expect(ran).toEqual(["fail", "after"]);
    expect(q.pendingCount()).toBe(0);
  });

  it("exposes pendingCount = inFlight + waiting", async () => {
    const q = new WriteQueue({ cap: 10 });
    const g1 = deferred<void>();
    const g2 = deferred<void>();

    const r1 = q.run(() => g1.promise);
    const r2 = q.run(() => g2.promise);

    await Promise.resolve();
    expect(q.inFlightCount()).toBe(1);
    expect(q.waitingCount()).toBe(1);
    expect(q.pendingCount()).toBe(2);

    g1.resolve();
    await r1;
    g2.resolve();
    await r2;
    expect(q.pendingCount()).toBe(0);
  });

  it("uses the configured name on the DrainableQueue contract", () => {
    expect(new WriteQueue({ cap: 10 }).name).toBe("write-queue");
    expect(new WriteQueue({ cap: 10, name: "omnijs-writes" }).name).toBe("omnijs-writes");
  });
});
