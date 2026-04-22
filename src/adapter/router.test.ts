/**
 * Unit tests for `TransportRouter`.
 *
 * The router is pure dispatch — its job is to delegate each method to the
 * transport named in `ROUTING_TABLE`. Tests assert two things:
 *
 * 1. **Routing**: every method on `OmniFocusAdapter` reaches the transport
 *    chosen by the table, and only that one. The stub transports record
 *    calls so we can confirm exactly one delegation per invocation.
 * 2. **Table integrity**: the table covers every adapter method (no holes
 *    when new methods land), and the exposed `routingTable` getter is the
 *    same frozen object — so the envelope layer can index it safely.
 *
 * Contract substitutability against `InMemoryAdapter` lives in the harness
 * shipped by #30; this file is the unit-level guarantee that delegation
 * works at all.
 */

import { describe, expect, it, vi } from "vitest";
import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { OmniFocusAdapter } from "./OmniFocusAdapter.js";
import { type AdapterMethod, ROUTING_TABLE, TransportRouter, transportFor } from "./router.js";

// ---------------------------------------------------------------------------
// Stub transports — every method records its receiver and returns a sentinel
// ---------------------------------------------------------------------------

type Receiver = "jxa" | "omnijs";

function makeStub(name: Receiver): OmniFocusAdapter & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (method: string) =>
    async (..._args: unknown[]): Promise<never> => {
      calls.push(`${name}:${method}`);
      // Return a sentinel that's still type-safe across the various return
      // shapes — `unknown` widens to whatever the caller asked for.
      return name as never;
    };
  return {
    calls,
    listTasks: record("listTasks"),
    getTask: record("getTask"),
    getTasksMany: record("getTasksMany"),
    createTask: record("createTask"),
    updateTask: record("updateTask"),
    completeTask: record("completeTask"),
    uncompleteTask: record("uncompleteTask"),
    dropTask: record("dropTask"),
    undropTask: record("undropTask"),
    deleteTask: record("deleteTask"),
    moveTask: record("moveTask"),
    listProjects: record("listProjects"),
    getProject: record("getProject"),
    createProject: record("createProject"),
    updateProject: record("updateProject"),
    completeProject: record("completeProject"),
    dropProject: record("dropProject"),
    moveProject: record("moveProject"),
    deleteProject: record("deleteProject"),
    markProjectReviewed: record("markProjectReviewed"),
    listTags: record("listTags"),
    getTag: record("getTag"),
    createTag: record("createTag"),
    updateTag: record("updateTag"),
    deleteTag: record("deleteTag"),
    listFolders: record("listFolders"),
    getFolder: record("getFolder"),
    createFolder: record("createFolder"),
    updateFolder: record("updateFolder"),
    deleteFolder: record("deleteFolder"),
    searchTasks: record("searchTasks"),
    syncTrigger: record("syncTrigger"),
    getLastSync: record("getLastSync"),
    runJxaScript: record("runJxaScript"),
    runOmniJsScript: record("runOmniJsScript"),
  };
}

// ---------------------------------------------------------------------------
// One sample call per method, with arguments that satisfy each signature
// ---------------------------------------------------------------------------

const T_ID = "task_000001" as TaskId;
const P_ID = "proj_000001" as ProjectId;
const TAG_ID = "tag_000001" as TagId;
const F_ID = "folder_000001" as FolderId;

function callsByMethod(r: TransportRouter): Record<AdapterMethod, () => Promise<unknown>> {
  return {
    listTasks: () => r.listTasks({}),
    getTask: () => r.getTask(T_ID),
    getTasksMany: () => r.getTasksMany([T_ID]),
    createTask: () => r.createTask({ name: "x" }),
    updateTask: () => r.updateTask(T_ID, { name: "y" }),
    completeTask: () => r.completeTask(T_ID),
    uncompleteTask: () => r.uncompleteTask(T_ID),
    dropTask: () => r.dropTask(T_ID),
    undropTask: () => r.undropTask(T_ID),
    deleteTask: () => r.deleteTask(T_ID),
    moveTask: () => r.moveTask(T_ID, { projectId: P_ID }),
    listProjects: () => r.listProjects(),
    getProject: () => r.getProject(P_ID),
    createProject: () => r.createProject({ name: "p" }),
    updateProject: () => r.updateProject(P_ID, { name: "q" }),
    completeProject: () => r.completeProject(P_ID),
    dropProject: () => r.dropProject(P_ID),
    moveProject: () => r.moveProject(P_ID, { folderId: null }),
    deleteProject: () => r.deleteProject(P_ID),
    markProjectReviewed: () => r.markProjectReviewed(P_ID),
    listTags: () => r.listTags(),
    getTag: () => r.getTag(TAG_ID),
    createTag: () => r.createTag({ name: "t" }),
    updateTag: () => r.updateTag(TAG_ID, { name: "u" }),
    deleteTag: () => r.deleteTag(TAG_ID),
    listFolders: () => r.listFolders(),
    getFolder: () => r.getFolder(F_ID),
    createFolder: () => r.createFolder({ name: "f" }),
    updateFolder: () => r.updateFolder(F_ID, { name: "g" }),
    deleteFolder: () => r.deleteFolder(F_ID),
    searchTasks: () => r.searchTasks({ q: "x" }),
    syncTrigger: () => r.syncTrigger(),
    getLastSync: () => r.getLastSync(),
    runJxaScript: () => r.runJxaScript("noop"),
    runOmniJsScript: () => r.runOmniJsScript("noop"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransportRouter — routing", () => {
  it("dispatches each method to the transport named in the table", async () => {
    const jxa = makeStub("jxa");
    const omnijs = makeStub("omnijs");
    const router = new TransportRouter({ jxa, omnijs });
    const calls = callsByMethod(router);

    for (const [method, invoke] of Object.entries(calls) as Array<
      [AdapterMethod, () => Promise<unknown>]
    >) {
      await invoke();
      const expected = ROUTING_TABLE[method];
      const sink = expected === "jxa" ? jxa : omnijs;
      expect(sink.calls.at(-1)).toBe(`${expected}:${method}`);
    }
  });

  it("never delegates to the other transport", async () => {
    const jxa = makeStub("jxa");
    const omnijs = makeStub("omnijs");
    const router = new TransportRouter({ jxa, omnijs });
    const calls = callsByMethod(router);

    for (const [method, invoke] of Object.entries(calls) as Array<
      [AdapterMethod, () => Promise<unknown>]
    >) {
      const expected = ROUTING_TABLE[method];
      const wrongSink = expected === "jxa" ? omnijs : jxa;
      const before = wrongSink.calls.length;
      await invoke();
      expect(wrongSink.calls.length).toBe(before);
    }
  });

  it("forwards arguments unchanged to the chosen transport", async () => {
    const jxa = {
      ...makeStub("jxa"),
      moveTask: vi.fn(async (_id: TaskId, _dest: unknown): Promise<void> => undefined),
    };
    const omnijs = makeStub("omnijs");
    const router = new TransportRouter({ jxa, omnijs });
    const dest = { projectId: P_ID };
    await router.moveTask(T_ID, dest);
    expect(jxa.moveTask).toHaveBeenCalledWith(T_ID, dest);
  });
});

describe("TransportRouter — table integrity", () => {
  it("ROUTING_TABLE only assigns 'jxa' or 'omnijs'", () => {
    for (const transport of Object.values(ROUTING_TABLE)) {
      expect(transport === "jxa" || transport === "omnijs").toBe(true);
    }
  });

  it("ROUTING_TABLE is frozen so callers cannot mutate the policy at runtime", () => {
    expect(Object.isFrozen(ROUTING_TABLE)).toBe(true);
  });

  it("transportFor() returns the table entry for a method", () => {
    expect(transportFor("listTasks")).toBe("jxa");
    expect(transportFor("runOmniJsScript")).toBe("omnijs");
  });

  it("router.routingTable getter returns the exported table (same identity)", () => {
    const router = new TransportRouter({ jxa: makeStub("jxa"), omnijs: makeStub("omnijs") });
    expect(router.routingTable).toBe(ROUTING_TABLE);
  });

  it("current policy: only runOmniJsScript routes to omnijs", () => {
    const omniJsRoutes = (Object.entries(ROUTING_TABLE) as Array<[AdapterMethod, string]>)
      .filter(([, t]) => t === "omnijs")
      .map(([m]) => m);
    expect(omniJsRoutes).toEqual(["runOmniJsScript"]);
  });
});

describe("TransportRouter — raw-script edge cases", () => {
  it("rejects with TypeError if the dispatched transport is missing the raw method", async () => {
    // Build the stub without the optional `runJxaScript` property so the type
    // system reflects what a transport that opts out of the escape hatch
    // looks like in production.
    const { runJxaScript: _omit, ...jxaMissingRaw } = makeStub("jxa");
    const router = new TransportRouter({ jxa: jxaMissingRaw, omnijs: makeStub("omnijs") });
    await expect(router.runJxaScript("noop")).rejects.toBeInstanceOf(TypeError);
  });

  it("propagates the underlying transport's rejection", async () => {
    const omnijs: OmniFocusAdapter = {
      ...makeStub("omnijs"),
      runOmniJsScript: async () => {
        throw new Error("kaboom");
      },
    };
    const router = new TransportRouter({ jxa: makeStub("jxa"), omnijs });
    await expect(router.runOmniJsScript("noop")).rejects.toThrow("kaboom");
  });
});
