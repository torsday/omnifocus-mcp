/**
 * Tests for `project_template_delete`.
 *
 * Covers: schema validation, TemplateNotFoundError when folder absent,
 * TemplateNotFoundError when template absent, successful delete, case-insensitive
 * match, ignores non-template projects with same name, cache invalidation,
 * meta.syncPending, registration name.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import {
  handleProjectTemplateDelete,
  projectTemplateDeleteInputSchema,
  registerProjectTemplateDeleteTool,
  TemplateNotFoundError,
} from "./templateDelete.js";
import { handleProjectTemplateSave } from "./templateSave.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

const BASE_META: ResponseMeta = {
  correlationId: "test-cid",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "test",
};

function makeCtx(templatesFolderName = "Templates") {
  const adapter = new InMemoryAdapter();
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    ...BASE_META,
    ...partial,
  });
  return { adapter, ctx: { adapter, makeMeta, templatesFolderName } };
}

async function saveTemplate(
  adapter: InMemoryAdapter,
  ctx: ReturnType<typeof makeCtx>["ctx"],
  templateName: string,
) {
  const sourceId = await adapter.createProject({ name: `Source for ${templateName}` });
  await handleProjectTemplateSave({ projectId: sourceId, templateName }, ctx);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_template_delete — input schema", () => {
  it("requires templateName", () => {
    expect(() => projectTemplateDeleteInputSchema.parse({})).toThrow();
  });

  it("rejects an empty templateName", () => {
    expect(() => projectTemplateDeleteInputSchema.parse({ templateName: "" })).toThrow();
  });

  it("accepts a valid templateName", () => {
    const parsed = projectTemplateDeleteInputSchema.parse({ templateName: "Client onboarding" });
    expect(parsed.templateName).toBe("Client onboarding");
  });
});

// ---------------------------------------------------------------------------
// Handler — TemplateNotFoundError
// ---------------------------------------------------------------------------

describe("project_template_delete — TemplateNotFoundError", () => {
  it("throws when the Templates folder does not exist", async () => {
    const { ctx } = makeCtx();
    await expect(handleProjectTemplateDelete({ templateName: "T1" }, ctx)).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
  });

  it("throws when the folder exists but no matching template is found", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createFolder({ name: "Templates" });
    await expect(
      handleProjectTemplateDelete({ templateName: "Nonexistent" }, ctx),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("throws when only a non-template project with that name exists (no fence)", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Templates" });
    await adapter.createProject({ name: "Client onboarding", folderId });
    await expect(
      handleProjectTemplateDelete({ templateName: "Client onboarding" }, ctx),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Handler — successful delete
// ---------------------------------------------------------------------------

describe("project_template_delete — successful delete", () => {
  it("returns { deleted: true, templateName } on success", async () => {
    const { ctx, adapter } = makeCtx();
    await saveTemplate(adapter, ctx, "Client onboarding");

    const result = await handleProjectTemplateDelete({ templateName: "Client onboarding" }, ctx);
    expect(result.data.deleted).toBe(true);
    expect(result.data.templateName).toBe("Client onboarding");
  });

  it("actually removes the template from the folder", async () => {
    const { ctx, adapter } = makeCtx();
    await saveTemplate(adapter, ctx, "T1");

    await handleProjectTemplateDelete({ templateName: "T1" }, ctx);

    const folders = await adapter.listFolders();
    const folder = folders.find((f) => f.name.toLowerCase() === "templates");
    const remaining = folder ? await adapter.listProjects({ folderId: folder.id }) : [];
    expect(remaining.map((p) => p.name)).not.toContain("T1");
  });

  it("a second delete call throws TemplateNotFoundError (idempotency: no silent success)", async () => {
    const { ctx, adapter } = makeCtx();
    await saveTemplate(adapter, ctx, "T1");

    await handleProjectTemplateDelete({ templateName: "T1" }, ctx);
    await expect(handleProjectTemplateDelete({ templateName: "T1" }, ctx)).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
  });

  it("matches template name case-insensitively", async () => {
    const { ctx, adapter } = makeCtx();
    await saveTemplate(adapter, ctx, "Client Onboarding");

    const result = await handleProjectTemplateDelete({ templateName: "client onboarding" }, ctx);
    expect(result.data.deleted).toBe(true);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    await saveTemplate(adapter, ctx, "T1");

    const result = await handleProjectTemplateDelete({ templateName: "T1" }, ctx);
    expect(result.meta.syncPending).toBe(true);
  });

  it("respects a custom templates folder name", async () => {
    const { ctx, adapter } = makeCtx("My Templates");
    await saveTemplate(adapter, ctx, "T1");

    const result = await handleProjectTemplateDelete({ templateName: "T1" }, ctx);
    expect(result.data.deleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_template_delete — cache invalidation", () => {
  it("emits project:${templateId} after deletion", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    await saveTemplate(adapter, base, "T1");

    const folders = await adapter.listFolders();
    const folder = folders.find((f) => f.name.toLowerCase() === "templates");
    const projects = folder ? await adapter.listProjects({ folderId: folder.id }) : [];
    const templateId = projects[0]?.id;

    await handleProjectTemplateDelete({ templateName: "T1" }, { ...base, cache });

    expect(scopes).toContain(`project:${templateId}`);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("project_template_delete — registration", () => {
  it("registers under canonical tool name", () => {
    const registerTool = vi.fn();
    const server = {
      registerTool,
    } as unknown as Parameters<typeof registerProjectTemplateDeleteTool>[0];
    const { ctx } = makeCtx();
    registerProjectTemplateDeleteTool(server, ctx);
    expect(registerTool.mock.calls[0]?.[0]).toBe("project_template_delete");
  });
});
