/**
 * Unit tests for `JxaTransport` — tag and folder domain methods.
 *
 * All tests use a fake spawner that returns pre-shaped JSON, so no `osascript`
 * binary is required. Integration tests against a live OmniFocus instance are
 * in JxaTransport.tags-folders.integration.test.ts and gated behind
 * `OMNIFOCUS_INTEGRATION=1`.
 *
 * @see src/adapter/jxa/JxaTransport.ts — implementation
 * @see src/scripts/jxa/tag_*.js / folder_*.js — underlying scripts
 */

import { describe, expect, it, vi } from "vitest";
import type { FolderId, TagId } from "../../domain/ids.js";
import { ScriptError } from "../../errors/index.js";
import { JxaTransport } from "./JxaTransport.js";
import type { ScriptSpawner, SpawnResult } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnerReturning(payload: unknown): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: JSON.stringify(payload),
      stderr: "",
      exitCode: 0,
      timedOut: false,
    }),
  );
}

function spawnerFailing(stderr: string): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr,
      exitCode: 1,
      timedOut: false,
    }),
  );
}

const BASE_TAG = {
  id: "tag_aaa",
  name: "Work",
  parentId: null,
  status: "active",
  location: null,
  allowsNextAction: true,
  taskCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
};

const BASE_FOLDER = {
  id: "folder_bbb",
  name: "Personal",
  parentId: null,
  projectCount: 2,
  subfolderCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// listTags
// ---------------------------------------------------------------------------

describe("JxaTransport — listTags", () => {
  it("returns parsed tags with branded IDs", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tags: [BASE_TAG] }) });
    const tags = await t.listTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe("tag_aaa");
    expect(tags[0]?.name).toBe("Work");
    expect(tags[0]?.status).toBe("active");
  });

  it("passes parentId and status filters to the script", async () => {
    const spawner = spawnerReturning({ tags: [] });
    const t = new JxaTransport({ spawner });
    await t.listTags({ parentId: "tag_parent" as TagId, status: "on-hold" });
    const call = (spawner as ReturnType<typeof vi.fn>).mock.calls[0];
    const arg = JSON.parse(call[1] as string) as { parentId: string; status: string };
    expect(arg.parentId).toBe("tag_parent");
    expect(arg.status).toBe("on-hold");
  });

  it("returns empty array when no tags", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tags: [] }) });
    expect(await t.listTags()).toEqual([]);
  });

  it("surfaces ScriptError on script failure", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("OmniFocus got an error") });
    await expect(t.listTags()).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// getTag
// ---------------------------------------------------------------------------

describe("JxaTransport — getTag", () => {
  it("returns a single tag", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tag: BASE_TAG }) });
    const tag = await t.getTag("tag_aaa" as TagId);
    expect(tag.id).toBe("tag_aaa");
    expect(tag.allowsNextAction).toBe(true);
    expect(tag.taskCount).toBe(3);
  });

  it("passes the id to the script", async () => {
    const spawner = spawnerReturning({ tag: BASE_TAG });
    const t = new JxaTransport({ spawner });
    await t.getTag("tag_aaa" as TagId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { id: string };
    expect(arg.id).toBe("tag_aaa");
  });

  it("surfaces ScriptError on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("tag not found") });
    await expect(t.getTag("tag_missing" as TagId)).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// createTag
// ---------------------------------------------------------------------------

describe("JxaTransport — createTag", () => {
  it("returns the new tag's branded ID", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ tag: BASE_TAG }) });
    const id = await t.createTag({ name: "Work" });
    expect(id).toBe("tag_aaa");
  });

  it("passes name and parentId to the script", async () => {
    const spawner = spawnerReturning({ tag: BASE_TAG });
    const t = new JxaTransport({ spawner });
    await t.createTag({ name: "Work", parentId: "tag_parent" as TagId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { name: string; parentId: string };
    expect(arg.name).toBe("Work");
    expect(arg.parentId).toBe("tag_parent");
  });

  it("passes null parentId when none supplied", async () => {
    const spawner = spawnerReturning({ tag: BASE_TAG });
    const t = new JxaTransport({ spawner });
    await t.createTag({ name: "Work" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { parentId: null };
    expect(arg.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTag
// ---------------------------------------------------------------------------

describe("JxaTransport — updateTag", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tag: { ...BASE_TAG, name: "Updated" } }),
    });
    await expect(t.updateTag("tag_aaa" as TagId, { name: "Updated" })).resolves.toBeUndefined();
  });

  it("passes only supplied patch fields to the script", async () => {
    const spawner = spawnerReturning({ tag: BASE_TAG });
    const t = new JxaTransport({ spawner });
    await t.updateTag("tag_aaa" as TagId, { status: "on-hold" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { id: string; status: string; name?: string };
    expect(arg.id).toBe("tag_aaa");
    expect(arg.status).toBe("on-hold");
    expect(arg.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteTag
// ---------------------------------------------------------------------------

describe("JxaTransport — deleteTag", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "tag_aaa" }) });
    await expect(t.deleteTag("tag_aaa" as TagId)).resolves.toBeUndefined();
  });

  it("passes id to the script", async () => {
    const spawner = spawnerReturning({ id: "tag_aaa" });
    const t = new JxaTransport({ spawner });
    await t.deleteTag("tag_aaa" as TagId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { id: string };
    expect(arg.id).toBe("tag_aaa");
  });

  it("surfaces ScriptError on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("tag not found") });
    await expect(t.deleteTag("tag_missing" as TagId)).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// listFolders
// ---------------------------------------------------------------------------

describe("JxaTransport — listFolders", () => {
  it("returns parsed folders with branded IDs", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ folders: [BASE_FOLDER] }) });
    const folders = await t.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]?.id).toBe("folder_bbb");
    expect(folders[0]?.name).toBe("Personal");
    expect(folders[0]?.projectCount).toBe(2);
  });

  it("passes parentId filter to the script", async () => {
    const spawner = spawnerReturning({ folders: [] });
    const t = new JxaTransport({ spawner });
    await t.listFolders({ parentId: "folder_parent" as FolderId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { parentId: string };
    expect(arg.parentId).toBe("folder_parent");
  });

  it("surfaces ScriptError on script failure", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("Error: -1700") });
    await expect(t.listFolders()).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// getFolder
// ---------------------------------------------------------------------------

describe("JxaTransport — getFolder", () => {
  it("returns a single folder", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ folder: BASE_FOLDER }) });
    const folder = await t.getFolder("folder_bbb" as FolderId);
    expect(folder.id).toBe("folder_bbb");
    expect(folder.subfolderCount).toBe(1);
  });

  it("passes the id to the script", async () => {
    const spawner = spawnerReturning({ folder: BASE_FOLDER });
    const t = new JxaTransport({ spawner });
    await t.getFolder("folder_bbb" as FolderId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { id: string };
    expect(arg.id).toBe("folder_bbb");
  });
});

// ---------------------------------------------------------------------------
// createFolder
// ---------------------------------------------------------------------------

describe("JxaTransport — createFolder", () => {
  it("returns the new folder's branded ID", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ folder: BASE_FOLDER }) });
    const id = await t.createFolder({ name: "Personal" });
    expect(id).toBe("folder_bbb");
  });

  it("passes name and null parentId when none supplied", async () => {
    const spawner = spawnerReturning({ folder: BASE_FOLDER });
    const t = new JxaTransport({ spawner });
    await t.createFolder({ name: "Personal" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { name: string; parentId: null };
    expect(arg.name).toBe("Personal");
    expect(arg.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateFolder
// ---------------------------------------------------------------------------

describe("JxaTransport — updateFolder", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ folder: { ...BASE_FOLDER, name: "Updated" } }),
    });
    await expect(
      t.updateFolder("folder_bbb" as FolderId, { name: "Updated" }),
    ).resolves.toBeUndefined();
  });

  it("passes id and name to the script", async () => {
    const spawner = spawnerReturning({ folder: BASE_FOLDER });
    const t = new JxaTransport({ spawner });
    await t.updateFolder("folder_bbb" as FolderId, { name: "Renamed" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as string[])[1],
    ) as { id: string; name: string };
    expect(arg.id).toBe("folder_bbb");
    expect(arg.name).toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
// deleteFolder
// ---------------------------------------------------------------------------

describe("JxaTransport — deleteFolder", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "folder_bbb" }) });
    await expect(t.deleteFolder("folder_bbb" as FolderId)).resolves.toBeUndefined();
  });

  it("surfaces ScriptError when folder non-empty", async () => {
    const t = new JxaTransport({
      spawner: spawnerFailing("Cannot delete non-empty folder"),
    });
    await expect(t.deleteFolder("folder_bbb" as FolderId)).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// not-yet-wired stubs still throw (regression guard)
// ---------------------------------------------------------------------------

describe("JxaTransport — not-yet-wired stubs still throw after tag/folder wiring", () => {
  const t = new JxaTransport({ spawner: spawnerReturning({}) });

  it("listTasks throws not-yet-wired", async () => {
    const err = await t.listTasks({}).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({ reason: "not-yet-wired" });
  });

  it("listProjects throws not-yet-wired", async () => {
    const err = await t.listProjects().catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({ reason: "not-yet-wired" });
  });
});
