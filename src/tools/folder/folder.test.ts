/**
 * Tests for folder MCP tools: folder_list, folder_get, folder_create,
 * folder_update, folder_move, folder_delete.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { FolderService } from "../../services/folderService.js";
import { folderCreateInputSchema, handleFolderCreate } from "./create.js";
import { folderDeleteInputSchema, handleFolderDelete } from "./delete.js";
import { folderGetInputSchema, handleFolderGet } from "./get.js";
import { folderListInputSchema, handleFolderList } from "./list.js";
import { folderMoveInputSchema, handleFolderMove } from "./move.js";
import { folderUpdateInputSchema, handleFolderUpdate } from "./update.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const folderService = new FolderService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { folderService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// folder_list
// ---------------------------------------------------------------------------

describe("folder_list — schema", () => {
  it("accepts an empty object", () => {
    expect(folderListInputSchema.parse({})).toEqual({});
  });

  it("accepts a parentId", () => {
    const parsed = folderListInputSchema.parse({ parentId: "folder_000001" });
    expect(parsed.parentId).toBe("folder_000001");
  });
});

describe("folder_list — handler", () => {
  it("returns empty list when no folders exist", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleFolderList({}, ctx);
    expect(envelope.data.folders).toEqual([]);
  });

  it("returns created folders", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createFolder({ name: "Work" });
    await adapter.createFolder({ name: "Personal" });
    const envelope = await handleFolderList({}, ctx);
    expect(envelope.data.folders).toHaveLength(2);
  });

  it("filters by parentId", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    await adapter.createFolder({ name: "Projects", parentId });
    await adapter.createFolder({ name: "Personal" });
    const envelope = await handleFolderList({ parentId }, ctx);
    expect(envelope.data.folders).toHaveLength(1);
    expect(envelope.data.folders[0]?.name).toBe("Projects");
  });

  it("includes projectCount and subfolderCount", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createFolder({ name: "Work" });
    const envelope = await handleFolderList({}, ctx);
    expect(envelope.data.folders[0]).toHaveProperty("projectCount");
    expect(envelope.data.folders[0]).toHaveProperty("subfolderCount");
  });
});

// ---------------------------------------------------------------------------
// folder_get
// ---------------------------------------------------------------------------

describe("folder_get — schema", () => {
  it("requires id", () => {
    expect(() => folderGetInputSchema.parse({})).toThrow();
  });
});

describe("folder_get — handler", () => {
  it("returns the folder for a known ID", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createFolder({ name: "Work" });
    const envelope = await handleFolderGet({ id }, ctx);
    expect(envelope.data.folder.id).toBe(id);
    expect(envelope.data.folder.name).toBe("Work");
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleFolderGet({ id: "folder_999999" as never }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// folder_create
// ---------------------------------------------------------------------------

describe("folder_create — schema", () => {
  it("requires name", () => {
    expect(() => folderCreateInputSchema.parse({})).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => folderCreateInputSchema.parse({ name: "" })).toThrow();
  });

  it("accepts optional parentId", () => {
    const parsed = folderCreateInputSchema.parse({ name: "Work", parentId: "folder_000001" });
    expect(parsed.parentId).toBe("folder_000001");
  });
});

describe("folder_create — handler", () => {
  it("creates a folder and returns the full folder entity", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = await handleFolderCreate({ name: "Work" }, ctx);
    expect(envelope.data.folder.id).toBeTruthy();
    expect(envelope.data.folder.name).toBe("Work");
    // Returned entity matches a subsequent getFolder
    const fetched = await adapter.getFolder(envelope.data.folder.id);
    expect(fetched.id).toBe(envelope.data.folder.id);
    const folders = await adapter.listFolders();
    expect(folders).toHaveLength(1);
  });

  it("creates a nested folder", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    const envelope = await handleFolderCreate({ name: "Projects", parentId }, ctx);
    const child = await adapter.getFolder(envelope.data.folder.id);
    expect(child.parentId).toBe(parentId);
  });

  it("throws NotFound for unknown parentId", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleFolderCreate({ name: "X", parentId: "folder_999999" as never }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// folder_update
// ---------------------------------------------------------------------------

describe("folder_update — schema", () => {
  it("requires id", () => {
    expect(() => folderUpdateInputSchema.parse({})).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => folderUpdateInputSchema.parse({ id: "folder_000001", name: "" })).toThrow();
  });
});

describe("folder_update — handler", () => {
  it("renames a folder", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createFolder({ name: "Old" });
    await handleFolderUpdate({ id, name: "New" }, ctx);
    const folder = await adapter.getFolder(id);
    expect(folder.name).toBe("New");
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleFolderUpdate({ id: "folder_999999" as never, name: "X" }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// folder_move
// ---------------------------------------------------------------------------

describe("folder_move — schema", () => {
  it("requires id and parentId", () => {
    expect(() => folderMoveInputSchema.parse({ id: "folder_000001" })).toThrow();
  });

  it("accepts null parentId", () => {
    const parsed = folderMoveInputSchema.parse({ id: "folder_000001", parentId: null });
    expect(parsed.parentId).toBeNull();
  });
});

describe("folder_move — handler", () => {
  it("moves a folder under a new parent", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    const childId = await adapter.createFolder({ name: "Projects" });
    await handleFolderMove({ id: childId, parentId }, ctx);
    const child = await adapter.getFolder(childId);
    expect(child.parentId).toBe(parentId);
  });

  it("promotes a folder to root when parentId=null", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    const childId = await adapter.createFolder({ name: "Projects", parentId });
    await handleFolderMove({ id: childId, parentId: null }, ctx);
    const child = await adapter.getFolder(childId);
    expect(child.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// folder_delete
// ---------------------------------------------------------------------------

describe("folder_delete — schema", () => {
  it("requires id", () => {
    expect(() => folderDeleteInputSchema.parse({})).toThrow();
  });

  it("accepts optional cascade flag", () => {
    const parsed = folderDeleteInputSchema.parse({ id: "folder_000001", cascade: true });
    expect(parsed.cascade).toBe(true);
  });
});

describe("folder_delete — handler", () => {
  it("deletes an empty folder", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createFolder({ name: "Temp" });
    await handleFolderDelete({ id }, ctx);
    const folders = await adapter.listFolders();
    expect(folders).toHaveLength(0);
  });

  it("rejects non-empty folder without cascade", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    await adapter.createFolder({ name: "Projects", parentId });
    await expect(handleFolderDelete({ id: parentId }, ctx)).rejects.toThrow();
  });

  it("cascade=true deletes non-empty folder and its subfolders", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createFolder({ name: "Work" });
    await adapter.createFolder({ name: "Projects", parentId });
    await handleFolderDelete({ id: parentId, cascade: true }, ctx);
    const folders = await adapter.listFolders();
    expect(folders).toHaveLength(0);
  });

  it("cascade=true orphans projects inside the deleted folder", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Work" });
    await adapter.createProject({ name: "Big Project", folderId });
    await handleFolderDelete({ id: folderId, cascade: true }, ctx);
    const projects = await adapter.listProjects({});
    expect(projects).toHaveLength(1);
    expect(projects[0]?.folderId).toBeNull();
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleFolderDelete({ id: "folder_999999" as never }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("FolderService — cache invalidation", () => {
  it("create / update / move / delete each emit folder:${id}, perspective:*, search:* (no forecast:*)", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const cache = new OmniFocusLruCache();
    const scopes: InvalidationScope[] = [];
    cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => scopes.push(...e.scopes));
    const folderService = new FolderService({ adapter, cache });

    const { id } = await folderService.create({ name: "Area" });
    expect(scopes.slice(-4)).toEqual([`folder:${id}`, "folder:list", "perspective:*", "search:*"]);

    const before = scopes.length;
    await folderService.update(id, { name: "Area!" });
    await folderService.move(id, null);
    await folderService.delete(id);

    // Three mutations × four scopes each = twelve new emissions.
    expect(scopes.length - before).toBe(12);
    for (let i = 0; i < 3; i++) {
      expect(scopes.slice(before + i * 4, before + i * 4 + 4)).toEqual([
        `folder:${id}`,
        "folder:list",
        "perspective:*",
        "search:*",
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// FolderService.list — cache read-through
// ---------------------------------------------------------------------------

describe("FolderService.list — cache hit", () => {
  it("reports cacheHit true on second call with same input", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const cache = new OmniFocusLruCache();
    const folderService = new FolderService({ adapter, cache });
    await adapter.createFolder({ name: "Area" });
    await folderService.list();
    const second = await folderService.list();
    expect(second.cacheHit).toBe(true);
  });

  it("reports cacheHit false when no cache is wired", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const folderService = new FolderService({ adapter });
    await adapter.createFolder({ name: "Area" });
    await folderService.list();
    const second = await folderService.list();
    expect(second.cacheHit).toBe(false);
  });

  it("cache is cleared after a mutation", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const cache = new OmniFocusLruCache();
    const folderService = new FolderService({ adapter, cache });
    await folderService.list();
    await folderService.create({ name: "Area" });
    const afterMutation = await folderService.list();
    expect(afterMutation.cacheHit).toBe(false);
  });
});
