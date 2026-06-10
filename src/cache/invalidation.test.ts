/**
 * Tests for the centralized cache-invalidation helpers.
 *
 * Each helper should emit an exact, stable set of scopes per the matrix in
 * docs/cache-invalidation.md. These tests freeze that contract so a future
 * refactor can't silently widen or narrow the blast radius.
 */

import { describe, expect, it } from "vitest";
import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import {
  type ClearableCache,
  type InvalidatingCache,
  invalidateFolderMutation,
  invalidateOnSync,
  invalidateProjectMutation,
  invalidateTagMutation,
  invalidateTaskMutation,
} from "./invalidation.js";
import type { InvalidationScope } from "./lruCache.js";

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

function makeRecorder(): ClearableCache & { scopes: InvalidationScope[]; cleared: number } {
  const scopes: InvalidationScope[] = [];
  let cleared = 0;
  return {
    scopes,
    get cleared() {
      return cleared;
    },
    invalidate(scope) {
      scopes.push(scope);
    },
    clear() {
      cleared++;
    },
  };
}

// ---------------------------------------------------------------------------
// task mutations
// ---------------------------------------------------------------------------

describe("invalidateTaskMutation", () => {
  it("emits task, project, forecast:*, perspective:*, search:*, tag:list when both IDs known", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache, {
      taskId: "task_1" as TaskId,
      projectId: "project_1" as ProjectId,
    });
    expect(cache.scopes).toEqual([
      "task:task_1",
      "project:project_1",
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
    ]);
  });

  it("skips project scope when projectId is null (inbox task)", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache, {
      taskId: "task_2" as TaskId,
      projectId: null,
    });
    expect(cache.scopes).toEqual([
      "task:task_2",
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
    ]);
  });

  it("skips task scope when taskId is omitted", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache, {
      projectId: "project_2" as ProjectId,
    });
    expect(cache.scopes).toEqual([
      "project:project_2",
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
    ]);
  });

  it("emits the wildcards and tag:list when neither ID is known", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache);
    expect(cache.scopes).toEqual(["forecast:*", "perspective:*", "search:*", "tag:list"]);
  });

  it("emits task:${parentId} after the task scope when the task is a subtask", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache, {
      taskId: "task_child" as TaskId,
      parentId: "task_parent" as TaskId,
      projectId: null,
    });
    expect(cache.scopes).toEqual([
      "task:task_child",
      "task:task_parent",
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
    ]);
  });

  it("skips the parent scope when parentId is null (top-level task)", () => {
    const cache = makeRecorder();
    invalidateTaskMutation(cache as unknown as InvalidatingCache, {
      taskId: "task_3" as TaskId,
      projectId: "project_3" as ProjectId,
      parentId: null,
    });
    expect(cache.scopes).toEqual([
      "task:task_3",
      "project:project_3",
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
    ]);
  });
});

// ---------------------------------------------------------------------------
// project mutations
// ---------------------------------------------------------------------------

describe("invalidateProjectMutation", () => {
  it("emits project, forecast:*, perspective:*, search:*, folder:list", () => {
    const cache = makeRecorder();
    invalidateProjectMutation(cache as unknown as InvalidatingCache, {
      projectId: "project_42" as ProjectId,
    });
    expect(cache.scopes).toEqual([
      "project:project_42",
      "forecast:*",
      "perspective:*",
      "search:*",
      "folder:list",
    ]);
  });
});

// ---------------------------------------------------------------------------
// tag mutations
// ---------------------------------------------------------------------------

describe("invalidateTagMutation", () => {
  it("emits tag, tag:list, forecast:*, perspective:*, search:*", () => {
    const cache = makeRecorder();
    invalidateTagMutation(cache as unknown as InvalidatingCache, { tagId: "tag_7" as TagId });
    expect(cache.scopes).toEqual([
      "tag:tag_7",
      "tag:list",
      "forecast:*",
      "perspective:*",
      "search:*",
    ]);
  });
});

// ---------------------------------------------------------------------------
// folder mutations
// ---------------------------------------------------------------------------

describe("invalidateFolderMutation", () => {
  it("emits folder, folder:list, perspective:*, search:* (forecast intentionally skipped)", () => {
    const cache = makeRecorder();
    invalidateFolderMutation(cache as unknown as InvalidatingCache, {
      folderId: "folder_3" as FolderId,
    });
    expect(cache.scopes).toEqual(["folder:folder_3", "folder:list", "perspective:*", "search:*"]);
  });
});

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

describe("invalidateOnSync", () => {
  it("clears the whole cache without emitting scoped invalidations", () => {
    const cache = makeRecorder();
    invalidateOnSync(cache);
    expect(cache.cleared).toBe(1);
    expect(cache.scopes).toEqual([]);
  });
});
