/**
 * M1 integration suite — `TransportRouter` against a live OmniFocus.
 *
 * Mounts the same `runAdapterContract` harness used by the unit tier's
 * `InMemoryAdapter` driver, but wired to a real `TransportRouter`
 * (`JxaTransport` + `OmniJsTransport`). Exercises the full adapter contract
 * end-to-end through osascript and OmniJS.
 *
 * Gated on `OMNIFOCUS_INTEGRATION=1`. When the env var is absent the suite
 * is skipped with a clear message — it will never hang.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * Requirements:
 *   - OmniFocus must be running (the adapter raises `OmniFocusNotRunning` otherwise)
 *   - macOS Automation permission must be granted for `osascript`
 *
 * @see tests/contract/adapter.contract.ts — the harness under mount
 * @see DESIGN.md §19 — testing strategy tiers
 */

import { describe, test } from "vitest";
import type { OmniFocusAdapter } from "../../src/adapter/OmniFocusAdapter.js";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../../src/adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../../src/adapter/router.js";
import type { FolderId, ProjectId, TagId, TaskId } from "../../src/domain/ids.js";
import { runAdapterContract } from "../contract/adapter.contract.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

// ---------------------------------------------------------------------------
// Informative skip when OF is not available
// ---------------------------------------------------------------------------

if (!INTEGRATION) {
  describe("TransportRouter integration contract", () => {
    test.skip("skipped — set OMNIFOCUS_INTEGRATION=1 and ensure OmniFocus is running to execute", () => {});
  });
} else {
  // -------------------------------------------------------------------------
  // Tracking adapter
  //
  // The contract harness calls `createAdapter()` before each test and
  // `cleanup(adapter)` after each test. For a live OF we cannot reset the
  // database between tests; instead a Proxy intercepts every `create*` call
  // and records the returned IDs. Cleanup deletes all recorded IDs — safely
  // swallowing `NotFound` for entities already deleted inside the test body.
  // -------------------------------------------------------------------------

  type TrackedState = {
    taskIds: TaskId[];
    projectIds: ProjectId[];
    tagIds: TagId[];
    folderIds: FolderId[];
  };

  /** WeakMap associating each proxy adapter with its per-test tracking state. */
  const tracked = new WeakMap<OmniFocusAdapter, TrackedState>();

  /**
   * Shared transport (stateless — one instance across all tests is fine).
   * We re-use the same `TransportRouter` because the underlying JXA and
   * OmniJS transports are also stateless; only the OF database has state.
   */
  const router = TransportRouter.fromTransports(new JxaTransport(), new OmniJsTransport());

  /**
   * Return a fresh proxy adapter for each test. The proxy delegates every
   * method to the shared `router` except the four `create*` methods, which
   * are intercepted to record returned IDs for cleanup.
   */
  function makeTrackingAdapter(): OmniFocusAdapter {
    const state: TrackedState = {
      taskIds: [],
      projectIds: [],
      tagIds: [],
      folderIds: [],
    };

    const proxy = new Proxy(router, {
      get(target, prop: string | symbol) {
        // Intercept create methods to track returned IDs.
        if (prop === "createTask") {
          return async (...args: Parameters<OmniFocusAdapter["createTask"]>): Promise<TaskId> => {
            const id = await target.createTask(...args);
            state.taskIds.push(id);
            return id;
          };
        }
        if (prop === "createProject") {
          return async (
            ...args: Parameters<OmniFocusAdapter["createProject"]>
          ): Promise<ProjectId> => {
            const id = await target.createProject(...args);
            state.projectIds.push(id);
            return id;
          };
        }
        if (prop === "createTag") {
          return async (...args: Parameters<OmniFocusAdapter["createTag"]>): Promise<TagId> => {
            const id = await target.createTag(...args);
            state.tagIds.push(id);
            return id;
          };
        }
        if (prop === "createFolder") {
          return async (
            ...args: Parameters<OmniFocusAdapter["createFolder"]>
          ): Promise<FolderId> => {
            const id = await target.createFolder(...args);
            state.folderIds.push(id);
            return id;
          };
        }

        // Delegate everything else.
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(target) : val;
      },
    }) as OmniFocusAdapter;

    tracked.set(proxy, state);
    return proxy;
  }

  /**
   * Delete all entities created during this test. Errors are swallowed —
   * the test may have already deleted the entity (e.g. "deleteTask removes
   * the task"), and we must not fail the cleanup pass.
   *
   * Deletion order: tasks → projects → tags → folders (child before parent).
   * IDs are processed in reverse-creation order so subtasks are removed
   * before their parent containers.
   */
  async function cleanupAdapter(adapter: OmniFocusAdapter): Promise<void> {
    const state = tracked.get(adapter);
    if (!state) return;

    for (const id of [...state.taskIds].reverse()) {
      await router.deleteTask(id).catch(() => {});
    }
    for (const id of [...state.projectIds].reverse()) {
      await router.deleteProject(id).catch(() => {});
    }
    for (const id of [...state.tagIds].reverse()) {
      await router.deleteTag(id).catch(() => {});
    }
    for (const id of [...state.folderIds].reverse()) {
      await router.deleteFolder(id).catch(() => {});
    }

    tracked.delete(adapter);
  }

  // Mount the shared contract suite against the live TransportRouter.
  runAdapterContract("TransportRouter (live OmniFocus)", {
    createAdapter: makeTrackingAdapter,
    cleanup: cleanupAdapter,
  });
}
