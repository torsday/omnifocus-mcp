/**
 * Tests for `project_template_instantiate`.
 *
 * Covers: schema validation, lookup-by-name (Templates folder absent + present),
 * parameter validation (missing reported), substitution + date-shifting,
 * targetFolderId routing, cache invalidation, meta.syncPending.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import { buildProjectTemplateNote } from "../../domain/projectTemplates.js";
import type { ResponseMeta } from "../../envelope/index.js";
import {
  handleProjectTemplateInstantiate,
  MissingTemplateParameterError,
  projectTemplateInstantiateInputSchema,
  TemplateNotFoundError,
} from "./templateInstantiate.js";

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

async function seedTemplate(
  adapter: InMemoryAdapter,
  opts: {
    name: string;
    parameterNames?: string[];
    body: string;
    folderName?: string;
  },
): Promise<void> {
  const folderName = opts.folderName ?? "Templates";
  const folders = await adapter.listFolders();
  let folder = folders.find((f) => f.name.toLowerCase() === folderName.toLowerCase());
  if (folder === undefined) {
    const folderId = await adapter.createFolder({ name: folderName });
    folder = (await adapter.listFolders()).find((f) => f.id === folderId)!;
  }
  const note = buildProjectTemplateNote(
    {
      name: opts.name,
      parameterNames: opts.parameterNames ?? [],
      capturedAt: "2026-04-27T20:00:00Z",
    },
    opts.body,
  );
  await adapter.createProject({ name: opts.name, folderId: folder.id, note });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_template_instantiate — input schema", () => {
  it("requires templateName", () => {
    expect(() => projectTemplateInstantiateInputSchema.parse({})).toThrow();
  });

  it("accepts the minimal shape and defaults parameters to {}", () => {
    const parsed = projectTemplateInstantiateInputSchema.parse({ templateName: "T1" });
    expect(parsed.parameters).toEqual({});
  });

  it("accepts parameters and a YYYY-MM-DD dueDate", () => {
    const parsed = projectTemplateInstantiateInputSchema.parse({
      templateName: "T1",
      parameters: { client: "Acme" },
      dueDate: "2026-06-04",
    });
    expect(parsed.dueDate).toBe("2026-06-04");
  });

  it("rejects a non-YYYY-MM-DD dueDate", () => {
    expect(() =>
      projectTemplateInstantiateInputSchema.parse({
        templateName: "T1",
        dueDate: "next Friday",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler — lookup
// ---------------------------------------------------------------------------

describe("project_template_instantiate — template lookup", () => {
  it("throws TemplateNotFound when the Templates folder doesn't exist yet", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectTemplateInstantiate({ templateName: "T1", parameters: {} }, ctx),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("throws TemplateNotFound when the folder exists but no project matches the name", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createFolder({ name: "Templates" });
    await expect(
      handleProjectTemplateInstantiate({ templateName: "T1", parameters: {} }, ctx),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("throws TemplateNotFound when the project exists but lacks a template fence", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Templates" });
    await adapter.createProject({ name: "T1", folderId, note: "just user prose" });
    await expect(
      handleProjectTemplateInstantiate({ templateName: "T1", parameters: {} }, ctx),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("matches templateName case-insensitively", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "Client onboarding", body: "Client onboarding:" });
    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "client onboarding", parameters: {} },
      ctx,
    );
    expect(envelope.data.projectId).toBeDefined();
  });

  it("respects a custom templates folder name", async () => {
    const { ctx, adapter } = makeCtx("My Templates");
    await seedTemplate(adapter, {
      name: "T1",
      body: "T1:",
      folderName: "my templates",
    });
    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      ctx,
    );
    expect(envelope.data.projectId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler — parameter validation
// ---------------------------------------------------------------------------

describe("project_template_instantiate — parameter validation", () => {
  it("throws MissingTemplateParameter listing every missing name", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, {
      name: "T1",
      parameterNames: ["client", "startDate", "owner"],
      body: "T1:\n\t- step",
    });

    const err = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: { client: "Acme" } },
      ctx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(MissingTemplateParameterError);
    expect((err as MissingTemplateParameterError).missing).toEqual(["startDate", "owner"]);
  });

  it("succeeds when no parameters are recorded on the template", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });
    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      ctx,
    );
    expect(envelope.data.projectId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler — substitution + shifting
// ---------------------------------------------------------------------------

describe("project_template_instantiate — substitution + shifting", () => {
  it("creates tasks with substituted names", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, {
      name: "Onboarding",
      parameterNames: ["client"],
      body: "Onboarding:\n\t- Welcome {{client}} to the team",
    });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "Onboarding", parameters: { client: "Acme" } },
      ctx,
    );

    expect(envelope.data.taskCount).toBe(1);
    const tasks = await adapter.listTasks({ projectId: envelope.data.projectId });
    expect(tasks.map((t) => t.name)).toContain("Welcome Acme to the team");
  });

  it("shifts dates relative to the supplied dueDate when an anchor exists", async () => {
    const { ctx, adapter } = makeCtx();
    // Template has earliest @due at 2026-05-04; instantiating at 2026-06-04 should add 31 days.
    await seedTemplate(adapter, {
      name: "Launch",
      body: "Launch:\n\t- kickoff @due(2026-05-04)\n\t- review @due(2026-05-11)",
    });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "Launch", parameters: {}, dueDate: "2026-06-04" },
      ctx,
    );

    const tasks = await adapter.listTasks({ projectId: envelope.data.projectId });
    const dueDates = tasks
      .map((t) => t.dueDate?.slice(0, 10))
      .filter((d): d is string => d !== undefined)
      .sort();
    expect(dueDates).toEqual(["2026-06-04", "2026-06-11"]);
  });

  it("imports unchanged when dueDate is supplied but the template has no @due to anchor on", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, {
      name: "Quick",
      body: "Quick:\n\t- jot @flagged",
    });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "Quick", parameters: {}, dueDate: "2026-06-04" },
      ctx,
    );

    expect(envelope.data.taskCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Handler — output + side effects
// ---------------------------------------------------------------------------

describe("project_template_instantiate — output + side effects", () => {
  it("creates the new project under targetFolderId when supplied", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });
    const targetFolderId = await adapter.createFolder({ name: "Active" });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {}, targetFolderId },
      ctx,
    );

    const project = await adapter.getProject(envelope.data.projectId);
    expect(project.folderId).toBe(targetFolderId);
    expect(project.name).toBe("T1");
  });

  it("creates the new project at the library root when no targetFolderId supplied", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      ctx,
    );

    const project = await adapter.getProject(envelope.data.projectId);
    expect(project.folderId).toBeNull();
  });

  it("does NOT instantiate inside the Templates folder by default", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      ctx,
    );

    const project = await adapter.getProject(envelope.data.projectId);
    const templatesFolder = (await adapter.listFolders()).find((f) => f.name === "Templates");
    expect(project.folderId).not.toBe(templatesFolder?.id);
  });

  it("sets meta.syncPending = true on success", async () => {
    const { ctx, adapter } = makeCtx();
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      ctx,
    );
    expect(envelope.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_template_instantiate — cache invalidation", () => {
  it("emits project:${projectId} after creation", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    await seedTemplate(adapter, { name: "T1", body: "T1:\n\t- step" });

    const envelope = await handleProjectTemplateInstantiate(
      { templateName: "T1", parameters: {} },
      { ...base, cache },
    );

    expect(scopes).toContain(`project:${envelope.data.projectId}`);
  });
});
