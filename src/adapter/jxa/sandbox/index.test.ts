/**
 * Unit tests for the JXA sandbox harness.
 *
 * Each describe block exercises one JXA script body via `runJxaScriptInSandbox`.
 * Tests confirm:
 *   - Happy-path: script returns correct shape from fake entities.
 *   - Fault-injection: when an OF API getter throws, the script's try/catch
 *     fires the documented fallback rather than propagating the error.
 *
 * This is the test pattern motivated by issue #518. The three regressions
 * it would have caught:
 *   - #497 — ID-regex filtering (now covered by task_list filter tests)
 *   - #498 — unguarded date getters (covered by creationDate fault test)
 *   - #515 — null-filter on tag list (covered by tag_list filter tests)
 */

import { describe, expect, it } from "vitest";
import projectListScript from "../../../scripts/jxa/project_list.js";
import tagListScript from "../../../scripts/jxa/tag_list.js";
import taskListScript from "../../../scripts/jxa/task_list.js";
import { fakeProject, fakeTag, fakeTask, throwing } from "./fixtures.js";
import { runJxaScriptInSandbox } from "./index.js";

// ---------------------------------------------------------------------------
// tag_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_list", () => {
  it("returns tags from the fake document", () => {
    const t = fakeTag({ name: () => "Work" });
    const result = runJxaScriptInSandbox<{ tags: { name: string }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]?.name).toBe("Work");
  });

  it("returns empty array when document has no tags", () => {
    const result = runJxaScriptInSandbox<{ tags: unknown[] }>(tagListScript, {}, {});
    expect(result.tags).toHaveLength(0);
  });

  it("falls back to now when creationDate() throws — regression #498", () => {
    const before = Date.now();
    const t = fakeTag({ creationDate: throwing("Can't get object.") });
    const result = runJxaScriptInSandbox<{ tags: { createdAt: string }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    const createdAt = new Date(result.tags[0]?.createdAt ?? "").getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
  });

  it("falls back to now when modificationDate() throws", () => {
    const before = Date.now();
    const t = fakeTag({ modificationDate: throwing("Can't get object.") });
    const result = runJxaScriptInSandbox<{ tags: { modifiedAt: string }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    const modifiedAt = new Date(result.tags[0]?.modifiedAt ?? "").getTime();
    expect(modifiedAt).toBeGreaterThanOrEqual(before);
  });

  it("parentId is null when parent() throws", () => {
    const t = fakeTag({ parent: throwing() });
    const result = runJxaScriptInSandbox<{ tags: { parentId: null }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    expect(result.tags[0]?.parentId).toBeNull();
  });

  it("filters by parentId when provided — regression #515", () => {
    const t1 = fakeTag({ id: () => "tag_a" });
    // t2WithParent has parentId === "tag_a"; only it should survive the filter
    const t2WithParent = fakeTag({
      id: () => "tag_b",
      parent: () => ({ class: () => "tag", id: () => "tag_a" }),
    });
    const result = runJxaScriptInSandbox<{ tags: { id: string }[] }>(
      tagListScript,
      { parentId: "tag_a" },
      { tags: [t1, t2WithParent] },
    );
    // Only tag_b has parentId === "tag_a"
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]?.id).toBe("tag_b");
  });

  it("passes null parentId filter without excluding all tags — regression #515", () => {
    // When parentId is null (no filter), all tags should be returned
    const t1 = fakeTag();
    const t2 = fakeTag();
    const result = runJxaScriptInSandbox<{ tags: unknown[] }>(
      tagListScript,
      { parentId: null },
      { tags: [t1, t2] },
    );
    expect(result.tags).toHaveLength(2);
  });

  it("includes status in the returned tag", () => {
    const t = fakeTag({ status: () => "on hold" });
    const result = runJxaScriptInSandbox<{ tags: { status: string }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    expect(result.tags[0]?.status).toBe("on-hold");
  });

  it("defaults allowsNextAction to false when getter throws", () => {
    const t = fakeTag({ allowsNextAction: throwing() });
    const result = runJxaScriptInSandbox<{ tags: { allowsNextAction: boolean }[] }>(
      tagListScript,
      {},
      { tags: [t] },
    );
    expect(result.tags[0]?.allowsNextAction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — task_list", () => {
  it("returns tasks from the fake document", () => {
    const t = fakeTask({ name: () => "Buy milk" });
    const result = runJxaScriptInSandbox<{ tasks: { name: string }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.name).toBe("Buy milk");
  });

  it("returns empty array when no tasks", () => {
    const result = runJxaScriptInSandbox<{ tasks: unknown[] }>(taskListScript, {}, {});
    expect(result.tasks).toHaveLength(0);
  });

  it("projectId is null when containingProject() throws", () => {
    const t = fakeTask({ containingProject: throwing() });
    const result = runJxaScriptInSandbox<{ tasks: { projectId: null }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.projectId).toBeNull();
  });

  it("dueDate is null when task has no due date", () => {
    const t = fakeTask({ dueDate: () => null });
    const result = runJxaScriptInSandbox<{ tasks: { dueDate: null }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.dueDate).toBeNull();
  });

  it("dueDate is ISO string when task has due date", () => {
    const due = new Date("2026-06-01T09:00:00Z");
    const t = fakeTask({ dueDate: () => due });
    const result = runJxaScriptInSandbox<{ tasks: { dueDate: string }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.dueDate).toBe(due.toISOString());
  });

  it("tagIds array is populated from task tags", () => {
    const tag = fakeTag({ id: () => "tag_work" });
    const t = fakeTask({ tags: () => [tag] });
    const result = runJxaScriptInSandbox<{ tasks: { tagIds: string[] }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.tagIds).toEqual(["tag_work"]);
  });

  it("tagIds is empty when tags() throws", () => {
    const t = fakeTask({ tags: throwing() });
    const result = runJxaScriptInSandbox<{ tasks: { tagIds: string[] }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.tagIds).toEqual([]);
  });

  it("completed is false for incomplete task", () => {
    const t = fakeTask({ completed: () => false });
    const result = runJxaScriptInSandbox<{ tasks: { completed: boolean }[] }>(
      taskListScript,
      {},
      { tasks: [t] },
    );
    expect(result.tasks[0]?.completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// project_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_list", () => {
  it("returns projects from the fake document", () => {
    const p = fakeProject({ name: () => "Errands" });
    const result = runJxaScriptInSandbox<{ projects: { name: string }[] }>(
      projectListScript,
      {},
      { projects: [p] },
    );
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe("Errands");
  });

  it("returns empty array when no projects", () => {
    const result = runJxaScriptInSandbox<{ projects: unknown[] }>(projectListScript, {}, {});
    expect(result.projects).toHaveLength(0);
  });

  it("folderId is null when folder() throws", () => {
    // project_list.js uses proj.folder(), not proj.containingFolder()
    const p = {
      ...fakeProject(),
      folder: throwing(),
      tags: () => [],
    };
    const result = runJxaScriptInSandbox<{ projects: { folderId: null }[] }>(
      projectListScript,
      {},
      { projects: [p] },
    );
    expect(result.projects[0]?.folderId).toBeNull();
  });

  it("status is active by default", () => {
    const p = fakeProject({ status: () => "active" });
    const result = runJxaScriptInSandbox<{ projects: { status: string }[] }>(
      projectListScript,
      {},
      { projects: [p] },
    );
    expect(result.projects[0]?.status).toBe("active");
  });

  it("normalizes 'on hold' status to 'on-hold'", () => {
    const p = fakeProject({ status: () => "on hold" });
    const result = runJxaScriptInSandbox<{ projects: { status: string }[] }>(
      projectListScript,
      {},
      { projects: [p] },
    );
    expect(result.projects[0]?.status).toBe("on-hold");
  });

  it("falls back to now when creationDate() throws — regression #498", () => {
    const before = Date.now();
    const p = {
      ...fakeProject(),
      creationDate: throwing("Can't get object."),
      folder: throwing(),
      tags: () => [],
    };
    const result = runJxaScriptInSandbox<{ projects: { createdAt: string }[] }>(
      projectListScript,
      {},
      { projects: [p] },
    );
    const createdAt = new Date(result.projects[0]?.createdAt ?? "").getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
  });

  it("filters by status when provided", () => {
    const active = fakeProject({ status: () => "active" });
    const onHold = fakeProject({ status: () => "on hold" });
    const result = runJxaScriptInSandbox<{ projects: { status: string }[] }>(
      projectListScript,
      { status: "on-hold" },
      { projects: [active, onHold] },
    );
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.status).toBe("on-hold");
  });

  it("passes null status filter without excluding projects", () => {
    const p1 = fakeProject();
    const p2 = fakeProject();
    const result = runJxaScriptInSandbox<{ projects: unknown[] }>(
      projectListScript,
      { status: null },
      { projects: [p1, p2] },
    );
    expect(result.projects).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sandbox runner mechanics
// ---------------------------------------------------------------------------

describe("runJxaScriptInSandbox — runner mechanics", () => {
  it("propagates uncaught exceptions from the script body", () => {
    const brokenScript = `function run(_argv) { throw new Error("deliberate failure"); }`;
    expect(() => runJxaScriptInSandbox(brokenScript, {})).toThrow("deliberate failure");
  });

  it("throws SyntaxError on malformed script source", () => {
    const malformed = `function run(argv) { return ??? }`;
    expect(() => runJxaScriptInSandbox(malformed, {})).toThrow();
  });

  it("passes args correctly as argv[0]", () => {
    // argv[0] is the JSON-serialized args string; returning it verbatim means
    // the runner's JSON.parse sees the args object directly.
    const echoScript = `function run(argv) { return argv[0]; }`;
    const result = runJxaScriptInSandbox<{ key: string }>(echoScript, { key: "value" });
    expect(result).toEqual({ key: "value" });
  });
});
