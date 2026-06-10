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
import { type AdapterMethod, ROUTING_TABLE } from "./router.js";

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
    updateTask: async (id: string) => {
      await enterAndWait(`updateTask:${id}`);
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
    // updateTask still routes to JXA. createTask was moved to OmniJS in
    // ADR-0019 / #680.
    expect(pickGate("updateTask", deps)).toBe(deps.jxaWriteQueue);
    // Batch mutators are JXA-routed writes too — they must never land in
    // the read pool (regression: they were missing from MUTATING_METHODS).
    expect(pickGate("batchDeleteTasks", deps)).toBe(deps.jxaWriteQueue);
    expect(pickGate("batchDropProjects", deps)).toBe(deps.jxaWriteQueue);
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

    // updateTask is the JXA-write example (createTask moved to OmniJS in #680).
    const p1 = wrapped.updateTask("a" as never, {} as never);
    const p2 = wrapped.updateTask("b" as never, {} as never);
    await new Promise((r) => setImmediate(r));

    // Only the first write should be in flight.
    expect(spy.events).toEqual(["enter:updateTask:a"]);

    spy.release("updateTask:a");
    await new Promise((r) => setImmediate(r));
    expect(spy.events).toEqual(["enter:updateTask:a", "exit:updateTask:a", "enter:updateTask:b"]);

    spy.release("updateTask:b");
    await Promise.all([p1, p2]);
  });

  it("OmniJS calls share their own queue independent of JXA writes", async () => {
    const deps = makeDeps();
    const spy = makeSpyAdapter();
    const wrapped = wrapWithConcurrency(spy.adapter, deps);

    // A JXA write and an OmniJS call kicked off back-to-back must NOT block
    // each other — they live in different queues. updateTask is the JXA-write
    // example (createTask moved to OmniJS in #680).
    const pWrite = wrapped.updateTask("x" as never, {} as never);
    const pOmni = wrapped.moveTask("id-1" as never, {} as never);
    await new Promise((r) => setImmediate(r));

    expect(spy.events.sort()).toEqual(["enter:moveTask:id-1", "enter:updateTask:x"]);

    spy.release("updateTask:x");
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

  /**
   * Exhaustive read/write classification of every adapter method. Typed as
   * `Record<AdapterMethod, boolean>` so a new method on the interface is a
   * compile error here until it is classified — a new write can no longer
   * silently route through the read pool (the failure mode the module
   * header warns about, and exactly what happened to the batch task /
   * project mutators and `setProjectNextReviewDate`).
   *
   * "Mutates" means side-effects OmniFocus state (database, app, or window
   * state). Methods that only write outside OF (e.g. `saveAttachmentToPath`
   * writing a local file) are reads from OF's perspective.
   */
  const MUTATES: Record<AdapterMethod, boolean> = {
    // -- Tasks
    listTasks: false,
    getTask: false,
    getNoteHtml: false,
    getTasksMany: false,
    createTask: true,
    updateTask: true,
    completeTask: true,
    uncompleteTask: true,
    dropTask: true,
    undropTask: true,
    deleteTask: true,
    moveTask: true,
    convertTaskToProject: true,
    batchMoveTasks: true,
    reorderTask: true,
    duplicateTask: true,
    batchCreateTasks: true,
    batchUpdateTasks: true,
    batchCompleteTasks: true,
    batchUncompleteTasks: true,
    batchDeleteTasks: true,
    batchDropTasks: true,
    batchUndropTasks: true,
    // -- Projects
    listProjects: false,
    getProject: false,
    getProjectsMany: false,
    createProject: true,
    updateProject: true,
    completeProject: true,
    batchCompleteProjects: true,
    dropProject: true,
    batchDropProjects: true,
    moveProject: true,
    deleteProject: true,
    markProjectReviewed: true,
    listProjectsDueForReview: false,
    setProjectReviewInterval: true,
    setProjectNextReviewDate: true,
    // -- Tags
    listTags: false,
    getTag: false,
    getTagsMany: false,
    createTag: true,
    updateTag: true,
    deleteTag: true,
    // -- Folders
    listFolders: false,
    getFolder: false,
    createFolder: true,
    updateFolder: true,
    deleteFolder: true,
    // -- Search / forecast
    searchTasks: false,
    getForecast: false,
    getForecastTagWithName: false,
    setForecastTagWithName: true,
    // -- Perspectives
    listPerspectives: false,
    evaluatePerspective: false,
    evaluateCustomPerspective: false,
    evaluatePerspectiveRules: false,
    getCustomPerspective: false,
    deleteCustomPerspective: true,
    createCustomPerspective: true,
    updateCustomPerspective: true,
    // -- Sync
    syncTrigger: true,
    getLastSync: false,
    // -- Database undo/redo
    undoLastMutation: true,
    redoLastMutation: true,
    // -- Task alarms
    setTaskAlarms: true,
    clearTaskAlarms: true,
    // -- Attachments
    listAttachments: false,
    addAttachment: true,
    removeAttachment: true,
    saveAttachmentToPath: false, // writes a local file, not OF state
    // -- App lifecycle / window
    appLaunch: true,
    getWindowState: false,
    setWindowPerspective: true,
    setWindowFocus: true,
    appWindowNew: true,
    appWindowNewTab: true,
    // -- Plug-in invocation
    pluginInvoke: true,
    // -- Change detection
    getChangesSince: false,
    // -- Raw escape hatches — conservative: callers can do anything inside
    runJxaScript: true,
    runOmniJsScript: true,
  };

  it("classifies every JXA-routed method consistently with MUTATING_METHODS", () => {
    const jxaMethods = (Object.keys(ROUTING_TABLE) as AdapterMethod[]).filter(
      (m) => ROUTING_TABLE[m] === "jxa",
    );
    // A JXA-routed mutator missing from the set would run on the read pool —
    // concurrent writes against live OmniFocus (the ADR-0009 violation).
    const writesOnReadPool = jxaMethods.filter((m) => MUTATES[m] && !MUTATING_METHODS.has(m));
    expect(writesOnReadPool).toEqual([]);
    // The reverse — a read in the set — would serialize reads needlessly.
    const readsOnWriteQueue = jxaMethods.filter((m) => !MUTATES[m] && MUTATING_METHODS.has(m));
    expect(readsOnWriteQueue).toEqual([]);
  });
});
