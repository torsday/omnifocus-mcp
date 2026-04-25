/**
 * Tests for {@link wrapWithConcurrency} (#376).
 *
 * Goldilocks coverage — one case per dispatch arm proves the routing
 * decision; one ordering case per arm proves the concurrency contract.
 * Heavy state-machine branches (FIFO fairness, queue cap rejection) live
 * in `ReadPool.test.ts` / `WriteQueue.test.ts`; we don't restate them.
 */

import { describe, expect, it } from "vitest";
import { ReadPool } from "../concurrency/ReadPool.js";
import { WriteQueue } from "../concurrency/WriteQueue.js";
import { MUTATING_METHODS, pickGate, wrapWithConcurrency } from "./concurrent.js";
import type { OmniFocusAdapter } from "./OmniFocusAdapter.js";

function makeDeps() {
  return {
    readPool: new ReadPool({ size: 2, name: "read" }),
    jxaWriteQueue: new WriteQueue({ cap: 50, name: "jxa-write" }),
    omniJsQueue: new WriteQueue({ cap: 50, name: "omnijs" }),
  };
}

/**
 * A spy adapter that records the order in which methods entered and exited,
 * and lets each call's resolution be controlled. Only the methods the tests
 * touch are implemented; the rest delegate to a thrown sentinel so a
 * routing miss is loud.
 */
function makeSpyAdapter() {
  const events: string[] = [];
  const gates = new Map<string, () => void>();

  const enterAndWait = (label: string): Promise<void> => {
    events.push(`enter:${label}`);
    return new Promise<void>((resolve) => {
      gates.set(label, () => {
        events.push(`exit:${label}`);
        resolve();
      });
    });
  };

  const adapter = {
    listTasks: async (filter: { tag?: string }) => {
      await enterAndWait(`listTasks:${filter.tag ?? "*"}`);
      return [] as unknown[];
    },
    createTask: async (input: { name: string }) => {
      await enterAndWait(`createTask:${input.name}`);
      return "id-1" as unknown;
    },
    moveTask: async (id: string) => {
      await enterAndWait(`moveTask:${id}`);
    },
  } as unknown as OmniFocusAdapter;

  return {
    adapter,
    events,
    /** Release a previously-entered call by label so it can finish. */
    release(label: string) {
      const g = gates.get(label);
      if (g === undefined) throw new Error(`no in-flight call labelled ${label}`);
      g();
      gates.delete(label);
    },
  };
}

describe("pickGate", () => {
  it("routes JXA reads to the read pool", () => {
    const deps = makeDeps();
    expect(pickGate("listTasks", deps)).toBe(deps.readPool);
  });

  it("routes JXA mutations to the write queue", () => {
    const deps = makeDeps();
    expect(pickGate("createTask", deps)).toBe(deps.jxaWriteQueue);
  });

  it("routes every OmniJS-bound method to the omnijs queue regardless of mutation flag", () => {
    const deps = makeDeps();
    // moveTask is OmniJS-routed *and* a mutation — must take the OmniJS path.
    expect(pickGate("moveTask", deps)).toBe(deps.omniJsQueue);
    // evaluateCustomPerspective is OmniJS-routed and a *read* — same gate.
    expect(pickGate("evaluateCustomPerspective", deps)).toBe(deps.omniJsQueue);
  });
});

describe("wrapWithConcurrency", () => {
  it("lets multiple concurrent reads run inside the pool's slot budget", async () => {
    const deps = makeDeps();
    const spy = makeSpyAdapter();
    const wrapped = wrapWithConcurrency(spy.adapter, deps);

    // Two concurrent reads — pool has 2 slots, so both should enter immediately.
    const p1 = wrapped.listTasks({ tag: "a" } as never);
    const p2 = wrapped.listTasks({ tag: "b" } as never);
    await new Promise((r) => setImmediate(r));

    expect(spy.events).toEqual(["enter:listTasks:a", "enter:listTasks:b"]);
    expect(deps.readPool.inFlightCount()).toBe(2);

    spy.release("listTasks:a");
    spy.release("listTasks:b");
    await Promise.all([p1, p2]);
  });

  it("serializes JXA writes — second write does not enter until first exits", async () => {
    const deps = makeDeps();
    const spy = makeSpyAdapter();
    const wrapped = wrapWithConcurrency(spy.adapter, deps);

    const p1 = wrapped.createTask({ name: "a" } as never);
    const p2 = wrapped.createTask({ name: "b" } as never);
    await new Promise((r) => setImmediate(r));

    // Only the first write should be in flight.
    expect(spy.events).toEqual(["enter:createTask:a"]);

    spy.release("createTask:a");
    await new Promise((r) => setImmediate(r));
    expect(spy.events).toEqual(["enter:createTask:a", "exit:createTask:a", "enter:createTask:b"]);

    spy.release("createTask:b");
    await Promise.all([p1, p2]);
  });

  it("OmniJS calls share their own queue independent of JXA writes", async () => {
    const deps = makeDeps();
    const spy = makeSpyAdapter();
    const wrapped = wrapWithConcurrency(spy.adapter, deps);

    // A JXA write and an OmniJS call kicked off back-to-back must NOT block
    // each other — they live in different queues.
    const pWrite = wrapped.createTask({ name: "x" } as never);
    const pOmni = wrapped.moveTask("id-1" as never, {} as never);
    await new Promise((r) => setImmediate(r));

    expect(spy.events.sort()).toEqual(["enter:createTask:x", "enter:moveTask:id-1"]);

    spy.release("createTask:x");
    spy.release("moveTask:id-1");
    await Promise.all([pWrite, pOmni]);
  });
});

describe("MUTATING_METHODS coverage", () => {
  // Sanity: ensure the obvious write families are flagged. If a new write
  // method lands without joining this set, it would silently route through
  // the read pool and cause undefined ordering.
  it("flags the canonical task / project / tag / folder mutators", () => {
    for (const m of [
      "createTask",
      "updateTask",
      "deleteTask",
      "createProject",
      "updateProject",
      "deleteProject",
      "createTag",
      "updateTag",
      "deleteTag",
      "createFolder",
      "updateFolder",
      "deleteFolder",
    ] as const) {
      // Failure message is "expected false to be true" — the loop variable
      // makes which method failed obvious in the stack frame.
      expect(MUTATING_METHODS.has(m)).toBe(true);
    }
  });
});
