/**
 * Tests for `project_template_save`.
 *
 * Covers: schema validation, source-project NotFound, lazy folder creation,
 * fence-bearing note structure, duplicate-name rejection, cache invalidation,
 * and meta.syncPending.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import { parseProjectTemplateMeta } from "../../domain/projectTemplates.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";
import {
  handleProjectTemplateSave,
  projectTemplateSaveInputSchema,
  TemplateExistsError,
} from "./templateSave.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

function makeCtx(templatesFolderName = "Templates") {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { adapter, ctx: { adapter, makeMeta, templatesFolderName } };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_template_save — input schema", () => {
  it("requires projectId and templateName", () => {
    expect(() => projectTemplateSaveInputSchema.parse({})).toThrow();
    expect(() => projectTemplateSaveInputSchema.parse({ projectId: "project_001" })).toThrow();
  });

  it("accepts the minimal shape", () => {
    const parsed = projectTemplateSaveInputSchema.parse({
      projectId: "project_001",
      templateName: "Client onboarding",
    });
    expect(parsed.templateName).toBe("Client onboarding");
  });

  it("accepts ordered parameterNames", () => {
    const parsed = projectTemplateSaveInputSchema.parse({
      projectId: "project_001",
      templateName: "T",
      parameterNames: ["client", "startDate"],
    });
    expect(parsed.parameterNames).toEqual(["client", "startDate"]);
  });

  it("rejects an empty templateName", () => {
    expect(() =>
      projectTemplateSaveInputSchema.parse({ projectId: "project_001", templateName: "" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_template_save — handler", () => {
  it("creates the Templates folder on first save", async () => {
    const { ctx, adapter } = makeCtx();
    const sourceId = await adapter.createProject({ name: "Source" });

    await handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx);

    const folders = await adapter.listFolders();
    expect(folders.map((f) => f.name)).toContain("Templates");
  });

  it("reuses an existing Templates folder (case-insensitive)", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "templates" });
    const sourceId = await adapter.createProject({ name: "Source" });

    await handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx);

    const folders = await adapter.listFolders();
    expect(folders.filter((f) => f.name.toLowerCase() === "templates")).toHaveLength(1);
    const projects = await adapter.listProjects({ folderId });
    expect(projects.map((p) => p.name)).toContain("T1");
  });

  it("respects a custom templates folder name", async () => {
    const { ctx, adapter } = makeCtx("My Templates");
    const sourceId = await adapter.createProject({ name: "Source" });

    await handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx);

    const folders = await adapter.listFolders();
    expect(folders.map((f) => f.name)).toContain("My Templates");
    expect(folders.map((f) => f.name)).not.toContain("Templates");
  });

  it("creates a new template-project containing a parseable fence", async () => {
    const { ctx, adapter } = makeCtx();
    const sourceId = await adapter.createProject({ name: "Source" });
    await adapter.createTask({ name: "Step one", projectId: sourceId, flagged: true });

    const envelope = await handleProjectTemplateSave(
      {
        projectId: sourceId,
        templateName: "Client onboarding",
        parameterNames: ["client"],
      },
      ctx,
    );

    const templateId = envelope.data.templateId;
    const template = await adapter.getProject(templateId);
    const meta = parseProjectTemplateMeta(template.note);
    expect(meta).toEqual({
      name: "Client onboarding",
      parameterNames: ["client"],
      capturedAt: envelope.data.capturedAt,
    });
    // TaskPaper body should be present below the fence
    expect(template.note).toContain("Step one");
  });

  it("rejects duplicate templateName within the Templates folder", async () => {
    const { ctx, adapter } = makeCtx();
    const sourceId = await adapter.createProject({ name: "Source" });

    await handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx);
    await expect(
      handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx),
    ).rejects.toBeInstanceOf(TemplateExistsError);
  });

  it("treats duplicate-name match as case-insensitive", async () => {
    const { ctx, adapter } = makeCtx();
    const sourceId = await adapter.createProject({ name: "Source" });

    await handleProjectTemplateSave({ projectId: sourceId, templateName: "T1" }, ctx);
    await expect(
      handleProjectTemplateSave({ projectId: sourceId, templateName: "t1" }, ctx),
    ).rejects.toBeInstanceOf(TemplateExistsError);
  });

  it("propagates NotFound when the source project does not exist", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectTemplateSave(
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid id for the negative test
        { projectId: "project_999999" as any, templateName: "T1" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("sets meta.syncPending = true on success", async () => {
    const { ctx, adapter } = makeCtx();
    const sourceId = await adapter.createProject({ name: "Source" });

    const envelope = await handleProjectTemplateSave(
      { projectId: sourceId, templateName: "T1" },
      ctx,
    );
    expect(envelope.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_template_save — cache invalidation", () => {
  it("emits project:${templateId} after creation", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const sourceId = await adapter.createProject({ name: "Source" });

    const envelope = await handleProjectTemplateSave(
      { projectId: sourceId, templateName: "T1" },
      { ...base, cache },
    );

    expect(scopes).toContain(`project:${envelope.data.templateId}`);
  });
});
