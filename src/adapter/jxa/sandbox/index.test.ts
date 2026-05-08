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
import attachmentListScript from "../../../scripts/jxa/attachment_list.js";
import changesSinceScript from "../../../scripts/jxa/changes_since.js";
import folderCreateScript from "../../../scripts/jxa/folder_create.js";
import folderDeleteScript from "../../../scripts/jxa/folder_delete.js";
import folderGetScript from "../../../scripts/jxa/folder_get.js";
import folderListScript from "../../../scripts/jxa/folder_list.js";
import folderUpdateScript from "../../../scripts/jxa/folder_update.js";
import forecastGetScript from "../../../scripts/jxa/forecast_get.js";
import perspectiveListScript from "../../../scripts/jxa/perspective_list.js";
import projectBatchCompleteScript from "../../../scripts/jxa/project_batch_complete.js";
import projectBatchDropScript from "../../../scripts/jxa/project_batch_drop.js";
import projectCompleteScript from "../../../scripts/jxa/project_complete.js";
import projectCreateScript from "../../../scripts/jxa/project_create.js";
import projectDeleteScript from "../../../scripts/jxa/project_delete.js";
import projectDropScript from "../../../scripts/jxa/project_drop.js";
import projectGetScript from "../../../scripts/jxa/project_get.js";
import projectGetManyScript from "../../../scripts/jxa/project_get_many.js";
import projectListScript from "../../../scripts/jxa/project_list.js";
import projectMarkReviewedScript from "../../../scripts/jxa/project_mark_reviewed.js";
import projectMoveScript from "../../../scripts/jxa/project_move.js";
import projectSetNextReviewDateScript from "../../../scripts/jxa/project_set_next_review_date.js";
import projectSetReviewIntervalScript from "../../../scripts/jxa/project_set_review_interval.js";
import projectUpdateScript from "../../../scripts/jxa/project_update.js";
import reviewListDueScript from "../../../scripts/jxa/review_list_due.js";
import tagCreateScript from "../../../scripts/jxa/tag_create.js";
import tagDeleteScript from "../../../scripts/jxa/tag_delete.js";
import tagGetScript from "../../../scripts/jxa/tag_get.js";
import tagGetManyScript from "../../../scripts/jxa/tag_get_many.js";
import tagListScript from "../../../scripts/jxa/tag_list.js";
import tagUpdateScript from "../../../scripts/jxa/tag_update.js";
import taskGetScript from "../../../scripts/jxa/task_get.js";
import taskGetManyScript from "../../../scripts/jxa/task_get_many.js";
import taskListScript from "../../../scripts/jxa/task_list.js";
import taskSearchScript from "../../../scripts/jxa/task_search.js";
import windowGetStateScript from "../../../scripts/jxa/window_get_state.js";
import {
  fakeAttachment,
  fakeFolder,
  fakePerspective,
  fakeProject,
  fakeTag,
  fakeTask,
  fakeWindow,
  throwing,
} from "./fixtures.js";
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
// tag_get_many.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_get_many", () => {
  it("returns tags in the order requested with nulls for missing ids", () => {
    const a = fakeTag({ id: () => "tag_a", name: () => "A" });
    const c = fakeTag({ id: () => "tag_c", name: () => "C" });
    const result = runJxaScriptInSandbox<{ tags: ({ id: string } | null)[] }>(
      tagGetManyScript,
      { ids: ["tag_a", "tag_missing", "tag_c"] },
      { tags: [c, a] }, // document order is intentionally not request order
    );
    expect(result.tags).toHaveLength(3);
    expect(result.tags[0]?.id).toBe("tag_a");
    expect(result.tags[1]).toBeNull();
    expect(result.tags[2]?.id).toBe("tag_c");
  });

  it("returns an empty list when ids is empty", () => {
    const result = runJxaScriptInSandbox<{ tags: unknown[] }>(
      tagGetManyScript,
      { ids: [] },
      { tags: [fakeTag()] },
    );
    expect(result.tags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// project_get_many.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_get_many", () => {
  it("returns projects in the order requested with nulls for missing ids", () => {
    const a = fakeProject({ id: () => "project_a", name: () => "A" });
    const b = fakeProject({ id: () => "project_b", name: () => "B" });
    const result = runJxaScriptInSandbox<{ projects: ({ id: string } | null)[] }>(
      projectGetManyScript,
      { ids: ["project_b", "project_missing", "project_a"] },
      { projects: [a, b] },
    );
    expect(result.projects).toHaveLength(3);
    expect(result.projects[0]?.id).toBe("project_b");
    expect(result.projects[1]).toBeNull();
    expect(result.projects[2]?.id).toBe("project_a");
  });

  it("returns an empty list when ids is empty", () => {
    const result = runJxaScriptInSandbox<{ projects: unknown[] }>(
      projectGetManyScript,
      { ids: [] },
      { projects: [fakeProject()] },
    );
    expect(result.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// task_get_many.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — task_get_many", () => {
  it("returns tasks in the order requested with nulls for missing ids", () => {
    const a = fakeTask({ id: () => "task_a", name: () => "A" });
    const b = fakeTask({ id: () => "task_b", name: () => "B" });
    const result = runJxaScriptInSandbox<{ tasks: ({ id: string } | null)[] }>(
      taskGetManyScript,
      { ids: ["task_a", "task_missing", "task_b"] },
      { tasks: [b, a] },
    );
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0]?.id).toBe("task_a");
    expect(result.tasks[1]).toBeNull();
    expect(result.tasks[2]?.id).toBe("task_b");
  });

  it("returns an empty list when ids is empty", () => {
    const result = runJxaScriptInSandbox<{ tasks: unknown[] }>(
      taskGetManyScript,
      { ids: [] },
      { tasks: [fakeTask()] },
    );
    expect(result.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// changes_since.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — changes_since", () => {
  it("returns only items modified at or after sinceIso", () => {
    const since = new Date("2026-04-01T00:00:00Z");
    const before = fakeTask({
      id: () => "task_before",
      modificationDate: () => new Date("2026-03-01T00:00:00Z"),
    });
    const after = fakeTask({
      id: () => "task_after",
      modificationDate: () => new Date("2026-04-15T00:00:00Z"),
    });
    const projAfter = fakeProject({
      id: () => "project_after",
      modificationDate: () => new Date("2026-04-10T00:00:00Z"),
    });
    const projBefore = fakeProject({
      id: () => "project_before",
      modificationDate: () => new Date("2026-01-01T00:00:00Z"),
    });
    const result = runJxaScriptInSandbox<{
      tasks: { id: string }[];
      projects: { id: string }[];
    }>(
      changesSinceScript,
      { sinceIso: since.toISOString() },
      { tasks: [before, after], projects: [projAfter, projBefore] },
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["task_after"]);
    expect(result.projects.map((p) => p.id)).toEqual(["project_after"]);
  });

  it("skips items whose modificationDate() throws — inbox pseudo-tasks", () => {
    const since = new Date("2020-01-01T00:00:00Z");
    const broken = fakeTask({ id: () => "task_broken", modificationDate: throwing() });
    const ok = fakeTask({
      id: () => "task_ok",
      modificationDate: () => new Date("2026-04-01T00:00:00Z"),
    });
    const result = runJxaScriptInSandbox<{ tasks: { id: string }[] }>(
      changesSinceScript,
      { sinceIso: since.toISOString() },
      { tasks: [broken, ok] },
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["task_ok"]);
  });

  it("returns ISO-8601 modificationDate strings", () => {
    const mod = new Date("2026-05-08T12:34:56Z");
    const t = fakeTask({ id: () => "task_iso", modificationDate: () => mod });
    const result = runJxaScriptInSandbox<{ tasks: { modificationDate: string }[] }>(
      changesSinceScript,
      { sinceIso: "2020-01-01T00:00:00Z" },
      { tasks: [t] },
    );
    expect(result.tasks[0]?.modificationDate).toBe(mod.toISOString());
  });

  it("returns empty arrays when nothing has changed since", () => {
    const result = runJxaScriptInSandbox<{ tasks: unknown[]; projects: unknown[] }>(
      changesSinceScript,
      { sinceIso: "2099-01-01T00:00:00Z" },
      {
        tasks: [fakeTask({ modificationDate: () => new Date("2026-01-01T00:00:00Z") })],
      },
    );
    expect(result.tasks).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// review_list_due.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — review_list_due", () => {
  it("returns projects whose nextReviewDate is null or in the past", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const due = fakeProject({ id: () => "project_due", nextReviewDate: () => yesterday });
    const overdue = fakeProject({ id: () => "project_null", nextReviewDate: () => null });
    const future = fakeProject({
      id: () => "project_future",
      nextReviewDate: () => tomorrow,
    });
    const result = runJxaScriptInSandbox<{ projects: { id: string }[] }>(
      reviewListDueScript,
      {},
      { projects: [future, due, overdue] },
    );
    const ids = result.projects.map((p) => p.id);
    expect(ids).toContain("project_due");
    expect(ids).toContain("project_null");
    expect(ids).not.toContain("project_future");
  });

  it("sorts nulls first then ascending by nextReviewDate", () => {
    const earlier = new Date("2025-01-01T00:00:00Z");
    const later = new Date("2025-06-01T00:00:00Z");
    const result = runJxaScriptInSandbox<{ projects: { id: string }[] }>(
      reviewListDueScript,
      {},
      {
        projects: [
          fakeProject({ id: () => "later", nextReviewDate: () => later }),
          fakeProject({ id: () => "earlier", nextReviewDate: () => earlier }),
          fakeProject({ id: () => "null", nextReviewDate: () => null }),
        ],
      },
    );
    expect(result.projects.map((p) => p.id)).toEqual(["null", "earlier", "later"]);
  });

  it("treats nextReviewDate() throws as null (i.e. due)", () => {
    const broken = fakeProject({ id: () => "project_broken", nextReviewDate: throwing() });
    const result = runJxaScriptInSandbox<{ projects: { id: string }[] }>(
      reviewListDueScript,
      {},
      { projects: [broken] },
    );
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.id).toBe("project_broken");
  });

  it("returns reviewIntervalDays and lastReviewDate when available", () => {
    const last = new Date("2026-04-01T00:00:00Z");
    const p = fakeProject({
      id: () => "project_full",
      nextReviewDate: () => null,
      reviewIntervalDays: () => 14,
      lastReviewDate: () => last,
    });
    const result = runJxaScriptInSandbox<{
      projects: { reviewIntervalDays: number | null; lastReviewDate: string | null }[];
    }>(reviewListDueScript, {}, { projects: [p] });
    expect(result.projects[0]?.reviewIntervalDays).toBe(14);
    expect(result.projects[0]?.lastReviewDate).toBe(last.toISOString());
  });

  it("falls back to null when reviewIntervalDays() throws", () => {
    const p = fakeProject({
      id: () => "project_throw_interval",
      nextReviewDate: () => null,
      reviewIntervalDays: throwing(),
    });
    const result = runJxaScriptInSandbox<{
      projects: { reviewIntervalDays: number | null }[];
    }>(reviewListDueScript, {}, { projects: [p] });
    expect(result.projects[0]?.reviewIntervalDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// forecast_get.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — forecast_get", () => {
  // forecast_get queries via flattenedTasks.whose(predicate)() — the harness
  // implements only the operators the script actually uses (equality plus
  // _lessThan / _greaterThanEquals / _lessThanEquals on Date properties).
  const FROM = new Date("2026-05-08T00:00:00Z");
  const TO = new Date("2026-05-08T23:59:59Z");

  it("buckets overdue, dueToday, deferredToday, and flagged correctly", () => {
    const overdue = fakeTask({
      id: () => "task_overdue",
      dueDate: () => new Date("2026-05-01T00:00:00Z"),
    });
    const dueToday = fakeTask({
      id: () => "task_today",
      dueDate: () => new Date("2026-05-08T12:00:00Z"),
    });
    const deferredToday = fakeTask({
      id: () => "task_deferred",
      deferDate: () => new Date("2026-05-08T09:00:00Z"),
    });
    const flag = fakeTask({ id: () => "task_flagged", flagged: () => true });
    const result = runJxaScriptInSandbox<{
      overdue: { id: string }[];
      dueToday: { id: string }[];
      deferredToday: { id: string }[];
      flagged: { id: string }[];
    }>(
      forecastGetScript,
      { from: FROM.toISOString(), to: TO.toISOString() },
      { tasks: [overdue, dueToday, deferredToday, flag] },
    );
    expect(result.overdue.map((t) => t.id)).toEqual(["task_overdue"]);
    expect(result.dueToday.map((t) => t.id)).toEqual(["task_today"]);
    expect(result.deferredToday.map((t) => t.id)).toEqual(["task_deferred"]);
    expect(result.flagged.map((t) => t.id)).toEqual(["task_flagged"]);
  });

  it("excludes completed and dropped tasks from every bucket", () => {
    const completed = fakeTask({
      id: () => "task_completed",
      completed: () => true,
      dueDate: () => new Date("2026-05-08T09:00:00Z"),
    });
    const dropped = fakeTask({
      id: () => "task_dropped",
      dropped: () => true,
      flagged: () => true,
    });
    const result = runJxaScriptInSandbox<{
      overdue: unknown[];
      dueToday: unknown[];
      flagged: unknown[];
    }>(
      forecastGetScript,
      { from: FROM.toISOString(), to: TO.toISOString() },
      { tasks: [completed, dropped] },
    );
    expect(result.dueToday).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it("respects include* flags by skipping their queries", () => {
    const flag = fakeTask({ flagged: () => true });
    const result = runJxaScriptInSandbox<{ flagged: unknown[] }>(
      forecastGetScript,
      {
        from: FROM.toISOString(),
        to: TO.toISOString(),
        includeFlagged: false,
      },
      { tasks: [flag] },
    );
    expect(result.flagged).toHaveLength(0);
  });

  it("dedups a task that matches multiple buckets via the builtById cache", () => {
    // A task that is both overdue and flagged should appear in both buckets,
    // but be built only once (the builtById cache keys on the task id).
    const t = fakeTask({
      id: () => "task_dual",
      dueDate: () => new Date("2026-05-01T00:00:00Z"),
      flagged: () => true,
    });
    const result = runJxaScriptInSandbox<{
      overdue: { id: string }[];
      flagged: { id: string }[];
    }>(forecastGetScript, { from: FROM.toISOString(), to: TO.toISOString() }, { tasks: [t] });
    expect(result.overdue.map((x) => x.id)).toEqual(["task_dual"]);
    expect(result.flagged.map((x) => x.id)).toEqual(["task_dual"]);
  });
});

// ---------------------------------------------------------------------------
// window_get_state.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — window_get_state", () => {
  it("returns perspectiveName + empty focus by default — regression #466", () => {
    const w = fakeWindow({ perspectiveName: () => "Forecast" });
    const result = runJxaScriptInSandbox<{
      perspectiveName: string;
      focusContainerIds: string[];
    }>(windowGetStateScript, {}, { windows: [w] });
    expect(result.perspectiveName).toBe("Forecast");
    expect(result.focusContainerIds).toEqual([]);
  });

  it("returns NO_FRONT_WINDOW error when there are no windows", () => {
    const result = runJxaScriptInSandbox<{ error: { code: string } }>(
      windowGetStateScript,
      {},
      { windows: [] },
    );
    expect(result.error.code).toBe("NO_FRONT_WINDOW");
  });

  it("collects focus container ids in input order", () => {
    const w = fakeWindow({
      focus: () => [{ id: () => "container_a" }, { id: () => "container_b" }],
    });
    const result = runJxaScriptInSandbox<{ focusContainerIds: string[] }>(
      windowGetStateScript,
      {},
      { windows: [w] },
    );
    expect(result.focusContainerIds).toEqual(["container_a", "container_b"]);
  });

  it("returns null perspectiveName when the getter throws", () => {
    const w = fakeWindow({ perspectiveName: throwing() });
    const result = runJxaScriptInSandbox<{ perspectiveName: string | null }>(
      windowGetStateScript,
      {},
      { windows: [w] },
    );
    expect(result.perspectiveName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// perspective_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — perspective_list", () => {
  it("always returns the seven built-in perspectives", () => {
    const result = runJxaScriptInSandbox<{
      perspectives: { id: string; kind: string; requiresPro: boolean }[];
    }>(perspectiveListScript, {}, {});
    const builtinIds = result.perspectives.filter((p) => p.kind === "builtin").map((p) => p.id);
    expect(builtinIds).toEqual([
      "inbox",
      "projects",
      "tags",
      "forecast",
      "flagged",
      "nearby",
      "review",
    ]);
    expect(result.perspectives.every((p) => !p.requiresPro || p.kind === "custom")).toBe(true);
  });

  it("appends custom perspectives with requiresPro: true", () => {
    const custom = fakePerspective({ id: () => "perspective_x", name: () => "Weekly Review" });
    const result = runJxaScriptInSandbox<{
      perspectives: { id: string; name: string; kind: string; requiresPro: boolean }[];
    }>(perspectiveListScript, {}, { perspectives: [custom] });
    const customs = result.perspectives.filter((p) => p.kind === "custom");
    expect(customs).toHaveLength(1);
    expect(customs[0]).toMatchObject({
      id: "perspective_x",
      name: "Weekly Review",
      kind: "custom",
      requiresPro: true,
    });
  });

  it("dedups built-in names that the OS reports as custom perspectives", () => {
    // OF reports built-ins under different ids in some versions; the script
    // skips any custom whose name matches a built-in.
    const dup = fakePerspective({ id: () => "weird-id", name: () => "Forecast" });
    const result = runJxaScriptInSandbox<{ perspectives: { name: string; kind: string }[] }>(
      perspectiveListScript,
      {},
      { perspectives: [dup] },
    );
    const customs = result.perspectives.filter((p) => p.kind === "custom");
    expect(customs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// attachment_list.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — attachment_list", () => {
  it("returns attachments for the requested taskId", () => {
    const att = fakeAttachment({
      id: () => "att_1",
      name: () => "design.pdf",
      fileType: () => "application/pdf",
      fileSize: () => 12345,
    });
    const owner = fakeTask({ id: () => "task_owner", fileAttachments: () => [att] });
    const result = runJxaScriptInSandbox<{
      attachments: {
        id: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
        kind: string;
      }[];
    }>(attachmentListScript, { taskId: "task_owner" }, { tasks: [owner] });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      id: "att_1",
      name: "design.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      kind: "embedded",
    });
  });

  it("returns 'alias' kind when the attachment is linked", () => {
    const att = fakeAttachment({ linked: () => true });
    const owner = fakeProject({ id: () => "project_owner", fileAttachments: () => [att] });
    const result = runJxaScriptInSandbox<{ attachments: { kind: string }[] }>(
      attachmentListScript,
      { projectId: "project_owner" },
      { projects: [owner] },
    );
    expect(result.attachments[0]?.kind).toBe("alias");
  });

  it("throws when the requested taskId does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(attachmentListScript, { taskId: "missing" }, { tasks: [fakeTask()] }),
    ).toThrow("Task not found: missing");
  });

  it("throws when neither taskId nor projectId is supplied", () => {
    expect(() => runJxaScriptInSandbox(attachmentListScript, {}, {})).toThrow(
      "One of taskId or projectId is required",
    );
  });
});

// ---------------------------------------------------------------------------
// task_search.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — task_search", () => {
  it("filters by keyword in name (default scope: all)", () => {
    const a = fakeTask({ name: () => "Buy milk" });
    const b = fakeTask({ name: () => "Pay rent" });
    const result = runJxaScriptInSandbox<{ tasks: { name: string }[] }>(
      taskSearchScript,
      { q: "milk" },
      { tasks: [a, b] },
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.name).toBe("Buy milk");
  });

  it("scope: 'note' searches only notes", () => {
    const a = fakeTask({ name: () => "milk", note: () => "" });
    const b = fakeTask({ name: () => "task", note: () => "remember the milk" });
    const result = runJxaScriptInSandbox<{ tasks: { name: string }[] }>(
      taskSearchScript,
      { q: "milk", scope: "note" },
      { tasks: [a, b] },
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.name).toBe("task");
  });

  it("excludes completed by default but 'only' returns just completed", () => {
    const open = fakeTask({ id: () => "task_open" });
    const done = fakeTask({ id: () => "task_done", completed: () => true });
    const exclude = runJxaScriptInSandbox<{ tasks: { id: string }[] }>(
      taskSearchScript,
      {},
      { tasks: [open, done] },
    );
    expect(exclude.tasks.map((t) => t.id)).toEqual(["task_open"]);
    const only = runJxaScriptInSandbox<{ tasks: { id: string }[] }>(
      taskSearchScript,
      { completed: "only" },
      { tasks: [open, done] },
    );
    expect(only.tasks.map((t) => t.id)).toEqual(["task_done"]);
  });

  it("requires ALL listed tagIds when filtering by tagIds", () => {
    const tagA = fakeTag({ id: () => "tag_a" });
    const tagB = fakeTag({ id: () => "tag_b" });
    const both = fakeTask({ id: () => "task_both", tags: () => [tagA, tagB] });
    const onlyA = fakeTask({ id: () => "task_a_only", tags: () => [tagA] });
    const result = runJxaScriptInSandbox<{ tasks: { id: string }[] }>(
      taskSearchScript,
      { tagIds: ["tag_a", "tag_b"] },
      { tasks: [both, onlyA] },
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["task_both"]);
  });

  it("scopes to a project's flattenedTasks via byId — happy path", () => {
    const projectTasks = [fakeTask({ id: () => "task_inside" })];
    const project = fakeProject({
      id: () => "project_target",
      flattenedTasks: () => projectTasks,
    });
    // outsider should not appear because the script reads tasks from the
    // project, not from the document's flattenedTasks.
    const outsider = fakeTask({ id: () => "task_outside" });
    const result = runJxaScriptInSandbox<{ tasks: { id: string }[] }>(
      taskSearchScript,
      { projectId: "project_target" },
      { projects: [project], tasks: [outsider] },
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["task_inside"]);
  });

  it("throws via lookupOrThrow when projectId does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        taskSearchScript,
        { projectId: "missing" },
        { projects: [fakeProject()] },
      ),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// folder_create.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — folder_create", () => {
  it("creates a top-level folder with the supplied name", () => {
    const result = runJxaScriptInSandbox<{ folder: { name: string; parentId: null } }>(
      folderCreateScript,
      { name: "Areas" },
      {},
    );
    expect(result.folder.name).toBe("Areas");
    expect(result.folder.parentId).toBeNull();
  });

  it("creates a sub-folder under an existing parent", () => {
    const parent = fakeFolder({ id: () => "folder_parent", name: () => "Parent" });
    const result = runJxaScriptInSandbox<{ folder: { name: string; parentId: string | null } }>(
      folderCreateScript,
      { name: "Child", parentId: "folder_parent" },
      { folders: [parent] },
    );
    expect(result.folder.name).toBe("Child");
    // folder_create supplies a single-entry parentMap so build_folder reports
    // parentage correctly even with the OF 4.8.8 folder.parent() bug (#515).
    expect(result.folder.parentId).toBe("folder_parent");
  });

  it("throws ValidationError when name is empty", () => {
    expect(() => runJxaScriptInSandbox(folderCreateScript, { name: "" }, {})).toThrow(
      "ValidationError: name is required",
    );
  });

  it("throws when the supplied parentId does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(folderCreateScript, { name: "Orphan", parentId: "missing" }, {}),
    ).toThrow("Parent folder not found: missing");
  });
});

// ---------------------------------------------------------------------------
// folder_update.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — folder_update", () => {
  it("renames the folder and returns the updated shape", () => {
    const target = fakeFolder({ id: () => "folder_target", name: () => "Old" });
    const result = runJxaScriptInSandbox<{ folder: { id: string; name: string } }>(
      folderUpdateScript,
      { id: "folder_target", name: "New" },
      { folders: [target] },
    );
    expect(result.folder.id).toBe("folder_target");
    expect(result.folder.name).toBe("New");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        folderUpdateScript,
        { id: "missing", name: "Anything" },
        { folders: [fakeFolder()] },
      ),
    ).toThrow("Folder not found: missing");
  });

  it("preserves the parentId via the precomputed parentMap — regression #515", () => {
    const child = fakeFolder({ id: () => "folder_child", parent: throwing() });
    const parent = fakeFolder({ id: () => "folder_parent", folders: () => [child] });
    const result = runJxaScriptInSandbox<{ folder: { parentId: string | null } }>(
      folderUpdateScript,
      { id: "folder_child", name: "Renamed" },
      { folders: [parent, child] },
    );
    expect(result.folder.parentId).toBe("folder_parent");
  });
});

// ---------------------------------------------------------------------------
// folder_delete.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — folder_delete", () => {
  it("deletes an empty folder and echoes the id", () => {
    const target = fakeFolder({ id: () => "folder_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      folderDeleteScript,
      { id: "folder_target" },
      { folders: [target] },
    );
    expect(result.id).toBe("folder_target");
  });

  it("refuses to delete a folder that contains projects", () => {
    const target = fakeFolder({
      id: () => "folder_with_proj",
      projects: () => [fakeProject()],
    });
    expect(() =>
      runJxaScriptInSandbox(folderDeleteScript, { id: "folder_with_proj" }, { folders: [target] }),
    ).toThrow(/Folder is not empty.*projects: 1/);
  });

  it("refuses to delete a folder that contains sub-folders", () => {
    const target = fakeFolder({
      id: () => "folder_with_subs",
      folders: () => [fakeFolder()],
    });
    expect(() =>
      runJxaScriptInSandbox(folderDeleteScript, { id: "folder_with_subs" }, { folders: [target] }),
    ).toThrow(/Folder is not empty.*subfolders: 1/);
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(folderDeleteScript, { id: "missing" }, { folders: [fakeFolder()] }),
    ).toThrow("Folder not found: missing");
  });
});

// ---------------------------------------------------------------------------
// tag_create.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_create", () => {
  it("creates a top-level tag with the supplied name", () => {
    const result = runJxaScriptInSandbox<{ tag: { name: string; parentId: string | null } }>(
      tagCreateScript,
      { name: "Work" },
      {},
    );
    expect(result.tag.name).toBe("Work");
    expect(result.tag.parentId).toBeNull();
  });

  it("creates a nested tag under an existing parent via byId lookup + push", () => {
    const parent = fakeTag({ id: () => "tag_parent", name: () => "Errands" });
    const result = runJxaScriptInSandbox<{ tag: { name: string } }>(
      tagCreateScript,
      { name: "Buy milk", parentId: "tag_parent" },
      { tags: [parent] },
    );
    expect(result.tag.name).toBe("Buy milk");
  });

  it("throws ValidationError when name is empty or whitespace", () => {
    expect(() => runJxaScriptInSandbox(tagCreateScript, { name: "  " }, {})).toThrow(
      "ValidationError: name is required",
    );
  });

  it("throws via lookupOrThrow when parentId does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(tagCreateScript, { name: "Orphan", parentId: "missing" }, {}),
    ).toThrow("Parent tag not found: missing");
  });
});

// ---------------------------------------------------------------------------
// tag_update.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_update", () => {
  it("renames the tag and returns the updated shape", () => {
    const target = fakeTag({ id: () => "tag_target", name: () => "Old" });
    const result = runJxaScriptInSandbox<{ tag: { id: string; name: string } }>(
      tagUpdateScript,
      { id: "tag_target", name: "New" },
      { tags: [target] },
    );
    expect(result.tag.id).toBe("tag_target");
    expect(result.tag.name).toBe("New");
  });

  it("normalizes the on-hold status from domain to JXA format", () => {
    // Script writes `target.status = args.status === "on-hold" ? "on hold" : args.status`.
    // build_tag.js reads target.status() and normalizes back to "on-hold".
    const target = fakeTag({ id: () => "tag_target", status: () => "active" });
    const result = runJxaScriptInSandbox<{ tag: { status: string } }>(
      tagUpdateScript,
      { id: "tag_target", status: "on-hold" },
      { tags: [target] },
    );
    expect(result.tag.status).toBe("on-hold");
  });

  it("updates allowsNextAction via property assignment", () => {
    const target = fakeTag({ id: () => "tag_target", allowsNextAction: () => false });
    const result = runJxaScriptInSandbox<{ tag: { allowsNextAction: boolean } }>(
      tagUpdateScript,
      { id: "tag_target", allowsNextAction: true },
      { tags: [target] },
    );
    expect(result.tag.allowsNextAction).toBe(true);
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        tagUpdateScript,
        { id: "missing", name: "Anything" },
        { tags: [fakeTag()] },
      ),
    ).toThrow("Tag not found: missing");
  });
});

// ---------------------------------------------------------------------------
// tag_delete.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — tag_delete", () => {
  it("deletes a tag and echoes the id", () => {
    const target = fakeTag({ id: () => "tag_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      tagDeleteScript,
      { id: "tag_target" },
      { tags: [target] },
    );
    expect(result.id).toBe("tag_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(tagDeleteScript, { id: "missing" }, { tags: [fakeTag()] }),
    ).toThrow("Tag not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_create.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_create", () => {
  it("creates a top-level project", () => {
    const result = runJxaScriptInSandbox<{ project: { name: string } }>(
      projectCreateScript,
      { name: "Errands" },
      {},
    );
    expect(result.project.name).toBe("Errands");
  });

  it("creates a project under an existing folder", () => {
    const folder = fakeFolder({ id: () => "folder_target", name: () => "Areas" });
    const result = runJxaScriptInSandbox<{ project: { name: string } }>(
      projectCreateScript,
      { name: "Yard work", folderId: "folder_target" },
      { folders: [folder] },
    );
    expect(result.project.name).toBe("Yard work");
  });

  it("throws ValidationError when name is empty", () => {
    expect(() => runJxaScriptInSandbox(projectCreateScript, { name: "" }, {})).toThrow(
      "ValidationError: name is required",
    );
  });

  it("throws via lookupOrThrow when folderId does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(projectCreateScript, { name: "X", folderId: "missing" }, {}),
    ).toThrow("Folder not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_update.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_update", () => {
  it("renames the project and returns the updated shape", () => {
    const target = fakeProject({ id: () => "project_target", name: () => "Old" });
    const result = runJxaScriptInSandbox<{ project: { id: string; name: string } }>(
      projectUpdateScript,
      { id: "project_target", name: "New" },
      { projects: [target] },
    );
    expect(result.project.id).toBe("project_target");
    expect(result.project.name).toBe("New");
  });

  it("normalizes on-hold status from domain to JXA verbose form", () => {
    // build_project.js reads status() and normalizes "on hold status"/"on hold"
    // back to "on-hold" on the wire.
    const target = fakeProject({ id: () => "project_target", status: () => "active status" });
    const result = runJxaScriptInSandbox<{ project: { status: string } }>(
      projectUpdateScript,
      { id: "project_target", status: "on-hold" },
      { projects: [target] },
    );
    expect(result.project.status).toBe("on-hold");
  });

  it("toggles flagged via property assignment", () => {
    const target = fakeProject({ id: () => "project_target", flagged: () => false });
    const result = runJxaScriptInSandbox<{ project: { flagged: boolean } }>(
      projectUpdateScript,
      { id: "project_target", flagged: true },
      { projects: [target] },
    );
    expect(result.project.flagged).toBe(true);
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        projectUpdateScript,
        { id: "missing", name: "Anything" },
        { projects: [fakeProject()] },
      ),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_delete.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_delete", () => {
  it("deletes the project and echoes the id", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectDeleteScript,
      { id: "project_target" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(projectDeleteScript, { id: "missing" }, { projects: [fakeProject()] }),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_move.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_move", () => {
  it("moves the project to the supplied folder", () => {
    const target = fakeProject({ id: () => "project_target" });
    const folder = fakeFolder({ id: () => "folder_dest" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectMoveScript,
      { id: "project_target", folderId: "folder_dest" },
      { projects: [target], folders: [folder] },
    );
    expect(result.id).toBe("project_target");
  });

  it("moves the project to root when folderId is null", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectMoveScript,
      { id: "project_target", folderId: null },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the supplied folderId does not exist", () => {
    const target = fakeProject({ id: () => "project_target" });
    expect(() =>
      runJxaScriptInSandbox(
        projectMoveScript,
        { id: "project_target", folderId: "missing" },
        { projects: [target] },
      ),
    ).toThrow("Folder not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_complete.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_complete", () => {
  it("marks the project complete and echoes the id", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectCompleteScript,
      { id: "project_target" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("accepts an optional completionDate without throwing", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectCompleteScript,
      { id: "project_target", completionDate: "2026-05-08T12:00:00Z" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(projectCompleteScript, { id: "missing" }, { projects: [] }),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_drop.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_drop", () => {
  it("sets status to 'dropped' and echoes the id", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectDropScript,
      { id: "project_target" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(projectDropScript, { id: "missing" }, { projects: [] }),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_batch_complete.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_batch_complete", () => {
  it("succeeds for every found id; reports OF_NOT_FOUND for missing ids", () => {
    const a = fakeProject({ id: () => "project_a" });
    const b = fakeProject({ id: () => "project_b" });
    const result = runJxaScriptInSandbox<{
      succeeded: { index: number; value: string }[];
      failed: { index: number; errorCode: string; message: string }[];
    }>(
      projectBatchCompleteScript,
      { items: [{ id: "project_a" }, { id: "project_missing" }, { id: "project_b" }] },
      { projects: [a, b] },
    );
    expect(result.succeeded.map((s) => s.value)).toEqual(["project_a", "project_b"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.errorCode).toBe("OF_NOT_FOUND");
    expect(result.failed[0]?.index).toBe(1);
  });

  it("returns empty arrays when items is empty", () => {
    const result = runJxaScriptInSandbox<{ succeeded: unknown[]; failed: unknown[] }>(
      projectBatchCompleteScript,
      { items: [] },
      {},
    );
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// project_batch_drop.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_batch_drop", () => {
  it("succeeds for every found id; reports OF_NOT_FOUND for missing ids", () => {
    const a = fakeProject({ id: () => "project_a" });
    const result = runJxaScriptInSandbox<{
      succeeded: { value: string }[];
      failed: { errorCode: string }[];
    }>(
      projectBatchDropScript,
      { items: [{ id: "project_a" }, { id: "project_missing" }] },
      { projects: [a] },
    );
    expect(result.succeeded.map((s) => s.value)).toEqual(["project_a"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.errorCode).toBe("OF_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// project_mark_reviewed.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_mark_reviewed", () => {
  it("marks the project reviewed and echoes the id", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectMarkReviewedScript,
      { id: "project_target" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(projectMarkReviewedScript, { id: "missing" }, { projects: [] }),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_set_next_review_date.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_set_next_review_date", () => {
  it("sets the next review date from an ISO string", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectSetNextReviewDateScript,
      { id: "project_target", nextReviewDate: "2026-06-01T00:00:00Z" },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("clears the next review date when the value is null", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectSetNextReviewDateScript,
      { id: "project_target", nextReviewDate: null },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        projectSetNextReviewDateScript,
        { id: "missing", nextReviewDate: null },
        { projects: [] },
      ),
    ).toThrow("Project not found: missing");
  });
});

// ---------------------------------------------------------------------------
// project_set_review_interval.js
// ---------------------------------------------------------------------------

describe("JXA sandbox — project_set_review_interval", () => {
  it("sets the review interval in days", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectSetReviewIntervalScript,
      { id: "project_target", days: 14 },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("clears the review interval when days is null", () => {
    const target = fakeProject({ id: () => "project_target" });
    const result = runJxaScriptInSandbox<{ id: string }>(
      projectSetReviewIntervalScript,
      { id: "project_target", days: null },
      { projects: [target] },
    );
    expect(result.id).toBe("project_target");
  });

  it("throws when the id does not exist", () => {
    expect(() =>
      runJxaScriptInSandbox(
        projectSetReviewIntervalScript,
        { id: "missing", days: 7 },
        { projects: [] },
      ),
    ).toThrow("Project not found: missing");
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
