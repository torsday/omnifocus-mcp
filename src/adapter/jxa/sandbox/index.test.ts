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
import folderGetScript from "../../../scripts/jxa/folder_get.js";
import folderListScript from "../../../scripts/jxa/folder_list.js";
import projectGetScript from "../../../scripts/jxa/project_get.js";
import projectListScript from "../../../scripts/jxa/project_list.js";
import tagGetScript from "../../../scripts/jxa/tag_get.js";
import tagListScript from "../../../scripts/jxa/tag_list.js";
import taskGetScript from "../../../scripts/jxa/task_get.js";
import taskListScript from "../../../scripts/jxa/task_list.js";
import { fakeFolder, fakeProject, fakeTag, fakeTask, throwing } from "./fixtures.js";
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
// folder_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — folder_list", () => {
  it("returns folders from the fake document", () => {
    const f = fakeFolder({ name: () => "Areas" });
    const result = runJxaScriptInSandbox<{ folders: { name: string }[] }>(
      folderListScript,
      {},
      { folders: [f] },
    );
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]?.name).toBe("Areas");
  });

  it("returns empty array when the document has no folders", () => {
    const result = runJxaScriptInSandbox<{ folders: unknown[] }>(folderListScript, {}, {});
    expect(result.folders).toHaveLength(0);
  });

  it("resolves sub-folder parentage via the precomputed parentMap — regression #515", () => {
    // folder.parent() is broken on OF 4.8.8; folder_list builds a reverse
    // map from each folder's .folders() children. The script must report
    // child.parentId === parent.id() without ever calling child.parent().
    const child = fakeFolder({
      id: () => "folder_child",
      // child.parent() is intentionally never called by folder_list — make
      // it throw to prove the script doesn't fall back to it.
      parent: throwing(),
    });
    const parent = fakeFolder({
      id: () => "folder_parent",
      folders: () => [child],
    });
    const result = runJxaScriptInSandbox<{
      folders: { id: string; parentId: string | null }[];
    }>(folderListScript, {}, { folders: [parent, child] });
    const childOut = result.folders.find((f) => f.id === "folder_child");
    expect(childOut?.parentId).toBe("folder_parent");
  });

  it("filters by parentId when provided", () => {
    const child = fakeFolder({ id: () => "folder_child", parent: throwing() });
    const parent = fakeFolder({ id: () => "folder_parent", folders: () => [child] });
    const sibling = fakeFolder({ id: () => "folder_sibling", parent: throwing() });
    const result = runJxaScriptInSandbox<{ folders: { id: string }[] }>(
      folderListScript,
      { parentId: "folder_parent" },
      { folders: [parent, child, sibling] },
    );
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]?.id).toBe("folder_child");
  });

  it("treats null parentId filter as no filter — regression #515", () => {
    const f1 = fakeFolder();
    const f2 = fakeFolder();
    const result = runJxaScriptInSandbox<{ folders: unknown[] }>(
      folderListScript,
      { parentId: null },
      { folders: [f1, f2] },
    );
    expect(result.folders).toHaveLength(2);
  });

  it("falls back to now when creationDate() throws — regression #498", () => {
    const before = Date.now();
    const f = fakeFolder({ creationDate: throwing("Can't get object.") });
    const result = runJxaScriptInSandbox<{ folders: { createdAt: string }[] }>(
      folderListScript,
      {},
      { folders: [f] },
    );
    const createdAt = new Date(result.folders[0]?.createdAt ?? "").getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
  });

  it("defaults projectCount to 0 when projects() throws", () => {
    const f = fakeFolder({ projects: throwing() });
    const result = runJxaScriptInSandbox<{ folders: { projectCount: number }[] }>(
      folderListScript,
      {},
      { folders: [f] },
    );
    expect(result.folders[0]?.projectCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// folder_get.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — folder_get", () => {
  it("returns the folder when the id matches", () => {
    const target = fakeFolder({ id: () => "folder_target", name: () => "Target" });
    const other = fakeFolder({ id: () => "folder_other" });
    const result = runJxaScriptInSandbox<{ folder: { id: string; name: string } }>(
      folderGetScript,
      { id: "folder_target" },
      { folders: [other, target] },
    );
    expect(result.folder.id).toBe("folder_target");
    expect(result.folder.name).toBe("Target");
  });

  it("throws `Folder not found: <id>` when no match", () => {
    expect(() =>
      runJxaScriptInSandbox(folderGetScript, { id: "missing" }, { folders: [fakeFolder()] }),
    ).toThrow("Folder not found: missing");
  });

  it("resolves sub-folder parentage via the precomputed parentMap — regression #515", () => {
    const child = fakeFolder({ id: () => "folder_child", parent: throwing() });
    const parent = fakeFolder({ id: () => "folder_parent", folders: () => [child] });
    const result = runJxaScriptInSandbox<{ folder: { parentId: string | null } }>(
      folderGetScript,
      { id: "folder_child" },
      { folders: [parent, child] },
    );
    expect(result.folder.parentId).toBe("folder_parent");
  });
});

// ---------------------------------------------------------------------------
// tag_get.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_get", () => {
  it("returns the tag when the id matches", () => {
    const target = fakeTag({ id: () => "tag_target", name: () => "Work" });
    const other = fakeTag({ id: () => "tag_other" });
    const result = runJxaScriptInSandbox<{ tag: { id: string; name: string } }>(
      tagGetScript,
      { id: "tag_target" },
      { tags: [other, target] },
    );
    expect(result.tag.id).toBe("tag_target");
    expect(result.tag.name).toBe("Work");
  });

  it("throws `Tag not found: <id>` when no match", () => {
    expect(() =>
      runJxaScriptInSandbox(tagGetScript, { id: "missing" }, { tags: [fakeTag()] }),
    ).toThrow("Tag not found: missing");
  });

  it("falls back to now when creationDate() throws — regression #498", () => {
    const before = Date.now();
    const t = fakeTag({
      id: () => "tag_only",
      creationDate: throwing("Can't get object."),
    });
    const result = runJxaScriptInSandbox<{ tag: { createdAt: string } }>(
      tagGetScript,
      { id: "tag_only" },
      { tags: [t] },
    );
    expect(new Date(result.tag.createdAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("treats parent.class() throw as 'real tag' so parentId is the parent.id — regression #673", () => {
    // OF 4.x: p.class() throws "Can't convert types" on real Tag specifiers,
    // and only the document responds. The script must keep parentId set to
    // the parent's id() rather than skipping to null.
    const parentTag = {
      class: throwing("Can't convert types."),
      id: () => "tag_parent",
    };
    const t = fakeTag({ id: () => "tag_child", parent: () => parentTag });
    const result = runJxaScriptInSandbox<{ tag: { parentId: string | null } }>(
      tagGetScript,
      { id: "tag_child" },
      { tags: [t] },
    );
    expect(result.tag.parentId).toBe("tag_parent");
  });
});

// ---------------------------------------------------------------------------
// project_get.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_get", () => {
  it("returns the project when the id matches", () => {
    const target = fakeProject({ id: () => "project_target", name: () => "Errands" });
    const other = fakeProject({ id: () => "project_other" });
    const result = runJxaScriptInSandbox<{ project: { id: string; name: string } }>(
      projectGetScript,
      { id: "project_target" },
      { projects: [other, target] },
    );
    expect(result.project.id).toBe("project_target");
    expect(result.project.name).toBe("Errands");
  });

  it("throws `Project not found: <id>` when no match", () => {
    expect(() =>
      runJxaScriptInSandbox(projectGetScript, { id: "missing" }, { projects: [fakeProject()] }),
    ).toThrow("Project not found: missing");
  });

  it("normalizes 'on hold' status to 'on-hold'", () => {
    const p = fakeProject({ id: () => "project_only", status: () => "on hold" });
    const result = runJxaScriptInSandbox<{ project: { status: string } }>(
      projectGetScript,
      { id: "project_only" },
      { projects: [p] },
    );
    expect(result.project.status).toBe("on-hold");
  });
});

// ---------------------------------------------------------------------------
// task_get.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — task_get", () => {
  it("returns the task when the id matches", () => {
    const target = fakeTask({ id: () => "task_target", name: () => "Buy milk" });
    const other = fakeTask({ id: () => "task_other" });
    const result = runJxaScriptInSandbox<{ task: { id: string; name: string } }>(
      taskGetScript,
      { id: "task_target" },
      { tasks: [other, target] },
    );
    expect(result.task.id).toBe("task_target");
    expect(result.task.name).toBe("Buy milk");
  });

  it("throws `Task not found: <id>` when no match", () => {
    expect(() =>
      runJxaScriptInSandbox(taskGetScript, { id: "missing" }, { tasks: [fakeTask()] }),
    ).toThrow("Task not found: missing");
  });

  it("returns projectId: null when containingProject() throws — regression #673", () => {
    const t = fakeTask({ id: () => "task_only", containingProject: throwing() });
    const result = runJxaScriptInSandbox<{ task: { projectId: string | null } }>(
      taskGetScript,
      { id: "task_only" },
      { tasks: [t] },
    );
    expect(result.task.projectId).toBeNull();
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
