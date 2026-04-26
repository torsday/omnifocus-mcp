/**
 * Unit tests for buildTaskLinks and buildProjectLinks.
 */

import { describe, expect, it } from "vitest";
import { FolderId, ProjectId, TagId, TaskId } from "./ids.js";
import { buildProjectLinks, buildTaskLinks } from "./links.js";

// ---------------------------------------------------------------------------
// buildTaskLinks
// ---------------------------------------------------------------------------

describe("buildTaskLinks", () => {
  const id = TaskId.of("taskAAA");

  it("inbox task (no projectId, no parentId, no tags) has null project/parent and empty tags", () => {
    const links = buildTaskLinks({ id, projectId: null, parentId: null, tagIds: [] });
    expect(links).toEqual({
      self: "omnifocus://task/taskAAA",
      project: null,
      parent: null,
      tags: [],
    });
  });

  it("produces correct self URI", () => {
    const links = buildTaskLinks({ id, projectId: null, parentId: null, tagIds: [] });
    expect(links.self).toBe("omnifocus://task/taskAAA");
  });

  it("produces correct project URI when projectId is set", () => {
    const projectId = ProjectId.of("projBBB");
    const links = buildTaskLinks({ id, projectId, parentId: null, tagIds: [] });
    expect(links.project).toBe("omnifocus://project/projBBB");
  });

  it("produces correct parent URI when parentId is set", () => {
    const parentId = TaskId.of("parentCCC");
    const links = buildTaskLinks({ id, projectId: null, parentId, tagIds: [] });
    expect(links.parent).toBe("omnifocus://task/parentCCC");
  });

  it("maps tagIds to tag URIs", () => {
    const tagIds = [TagId.of("tagDDD"), TagId.of("tagEEE")];
    const links = buildTaskLinks({ id, projectId: null, parentId: null, tagIds });
    expect(links.tags).toEqual(["omnifocus://tag/tagDDD", "omnifocus://tag/tagEEE"]);
  });

  it("fully populated task produces all URIs", () => {
    const projectId = ProjectId.of("projFFF");
    const parentId = TaskId.of("parentGGG");
    const tagIds = [TagId.of("tagHHH")];
    const links = buildTaskLinks({ id, projectId, parentId, tagIds });
    expect(links).toEqual({
      self: "omnifocus://task/taskAAA",
      project: "omnifocus://project/projFFF",
      parent: "omnifocus://task/parentGGG",
      tags: ["omnifocus://tag/tagHHH"],
    });
  });
});

// ---------------------------------------------------------------------------
// buildProjectLinks
// ---------------------------------------------------------------------------

describe("buildProjectLinks", () => {
  const id = ProjectId.of("projAAA");

  it("root-level project (null folderId) has null folder", () => {
    const links = buildProjectLinks({ id, folderId: null });
    expect(links).toEqual({
      self: "omnifocus://project/projAAA",
      folder: null,
    });
  });

  it("produces correct self URI", () => {
    const links = buildProjectLinks({ id, folderId: null });
    expect(links.self).toBe("omnifocus://project/projAAA");
  });

  it("produces correct folder URI when folderId is set", () => {
    const folderId = FolderId.of("folderBBB");
    const links = buildProjectLinks({ id, folderId });
    expect(links.folder).toBe("omnifocus://folder/folderBBB");
  });
});
