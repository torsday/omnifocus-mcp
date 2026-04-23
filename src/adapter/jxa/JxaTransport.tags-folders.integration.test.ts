/**
 * Integration tests for `JxaTransport` — tag and folder domain methods.
 *
 * These tests require a running OmniFocus instance and are gated behind the
 * `OMNIFOCUS_INTEGRATION=1` environment variable. They exercise real JXA
 * calls via `osascript` rather than a mocked spawner.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * @see src/adapter/jxa/JxaTransport.tags-folders.test.ts — unit tests (no OF required)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FolderId, TagId } from "../../domain/ids.js";
import { JxaTransport } from "./JxaTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("JxaTransport — tag integration", () => {
  const t = new JxaTransport();
  let createdTagId: TagId;

  beforeAll(async () => {
    createdTagId = await t.createTag({ name: "__mcp_test_tag__" });
  });

  afterAll(async () => {
    if (createdTagId) {
      await t.deleteTag(createdTagId).catch(() => {
        /* already deleted */
      });
    }
  });

  it("createTag returns a valid ID", () => {
    expect(typeof createdTagId).toBe("string");
    expect(createdTagId.length).toBeGreaterThan(0);
  });

  it("getTag returns the created tag", async () => {
    const tag = await t.getTag(createdTagId);
    expect(tag.id).toBe(createdTagId);
    expect(tag.name).toBe("__mcp_test_tag__");
    expect(tag.status).toBe("active");
  });

  it("listTags includes the created tag", async () => {
    const tags = await t.listTags();
    const found = tags.find((tag) => tag.id === createdTagId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("__mcp_test_tag__");
  });

  it("updateTag renames the tag", async () => {
    await t.updateTag(createdTagId, { name: "__mcp_test_tag_renamed__" });
    const tag = await t.getTag(createdTagId);
    expect(tag.name).toBe("__mcp_test_tag_renamed__");
  });

  it("updateTag sets status to on-hold", async () => {
    await t.updateTag(createdTagId, { status: "on-hold" });
    const tag = await t.getTag(createdTagId);
    expect(tag.status).toBe("on-hold");
  });

  it("deleteTag removes the tag", async () => {
    await t.deleteTag(createdTagId);
    const tags = await t.listTags();
    const found = tags.find((tag) => tag.id === createdTagId);
    expect(found).toBeUndefined();
  });
});

describe.skipIf(!INTEGRATION)("JxaTransport — folder integration", () => {
  const t = new JxaTransport();
  let createdFolderId: FolderId;

  beforeAll(async () => {
    createdFolderId = await t.createFolder({ name: "__mcp_test_folder__" });
  });

  afterAll(async () => {
    if (createdFolderId) {
      await t.deleteFolder(createdFolderId).catch(() => {
        /* already deleted */
      });
    }
  });

  it("createFolder returns a valid ID", () => {
    expect(typeof createdFolderId).toBe("string");
    expect(createdFolderId.length).toBeGreaterThan(0);
  });

  it("getFolder returns the created folder", async () => {
    const folder = await t.getFolder(createdFolderId);
    expect(folder.id).toBe(createdFolderId);
    expect(folder.name).toBe("__mcp_test_folder__");
    expect(folder.parentId).toBeNull();
  });

  it("listFolders includes the created folder", async () => {
    const folders = await t.listFolders();
    const found = folders.find((f) => f.id === createdFolderId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("__mcp_test_folder__");
  });

  it("updateFolder renames the folder", async () => {
    await t.updateFolder(createdFolderId, { name: "__mcp_test_folder_renamed__" });
    const folder = await t.getFolder(createdFolderId);
    expect(folder.name).toBe("__mcp_test_folder_renamed__");
  });

  it("deleteFolder removes the folder", async () => {
    await t.deleteFolder(createdFolderId);
    const folders = await t.listFolders();
    const found = folders.find((f) => f.id === createdFolderId);
    expect(found).toBeUndefined();
  });
});
