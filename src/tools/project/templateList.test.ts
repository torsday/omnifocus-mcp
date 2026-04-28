/**
 * Tests for `project_template_list`.
 *
 * Covers: empty result when folder absent, parse-and-filter behaviour,
 * sort order (capturedAt desc, name tiebreak), and projects without a fence.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { buildProjectTemplateNote } from "../../domain/projectTemplates.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleProjectTemplateList, projectTemplateListInputSchema } from "./templateList.js";

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

describe("project_template_list — input schema", () => {
  it("accepts an empty object", () => {
    expect(projectTemplateListInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_template_list — handler", () => {
  it("returns an empty list cleanly when the Templates folder does not exist", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates).toEqual([]);
  });

  it("returns an empty list when the folder exists but has no template-projects", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createFolder({ name: "Templates" });
    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates).toEqual([]);
  });

  it("skips projects in the Templates folder that lack a parseable fence", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Templates" });
    await adapter.createProject({ name: "Just a draft", folderId, note: "scratch" });

    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates).toEqual([]);
  });

  it("returns parsed metadata for template-projects with a valid fence", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Templates" });
    const note = buildProjectTemplateNote(
      {
        name: "Client onboarding",
        parameterNames: ["client", "startDate"],
        capturedAt: "2026-04-27T20:00:00Z",
      },
      "T:\n\t- step",
    );
    const id = await adapter.createProject({ name: "Client onboarding", folderId, note });

    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates).toEqual([
      {
        templateId: id,
        templateName: "Client onboarding",
        parameterNames: ["client", "startDate"],
        capturedAt: "2026-04-27T20:00:00Z",
      },
    ]);
  });

  it("respects a custom templates folder name (case-insensitive lookup)", async () => {
    const { ctx, adapter } = makeCtx("My Templates");
    const folderId = await adapter.createFolder({ name: "my templates" });
    const note = buildProjectTemplateNote(
      { name: "T", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      "",
    );
    await adapter.createProject({ name: "T", folderId, note });

    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates).toHaveLength(1);
  });

  it("sorts most-recent first (capturedAt desc), tie-breaks on name asc", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Templates" });

    const noteFor = (name: string, capturedAt: string): string =>
      buildProjectTemplateNote({ name, parameterNames: [], capturedAt }, "");

    await adapter.createProject({
      name: "Older",
      folderId,
      note: noteFor("Older", "2026-04-01T00:00:00Z"),
    });
    await adapter.createProject({
      name: "Newest-A",
      folderId,
      note: noteFor("Newest-A", "2026-04-27T00:00:00Z"),
    });
    await adapter.createProject({
      name: "Newest-B",
      folderId,
      note: noteFor("Newest-B", "2026-04-27T00:00:00Z"),
    });

    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates.map((t) => t.templateName)).toEqual([
      "Newest-A",
      "Newest-B",
      "Older",
    ]);
  });

  it("does not enumerate projects from other folders", async () => {
    const { ctx, adapter } = makeCtx();
    const templatesFolderId = await adapter.createFolder({ name: "Templates" });
    const otherFolderId = await adapter.createFolder({ name: "Inbox-style" });

    const noteFor = (name: string): string =>
      buildProjectTemplateNote(
        { name, parameterNames: [], capturedAt: "2026-04-27T00:00:00Z" },
        "",
      );

    await adapter.createProject({
      name: "TemplateA",
      folderId: templatesFolderId,
      note: noteFor("TemplateA"),
    });
    await adapter.createProject({
      name: "Decoy",
      folderId: otherFolderId,
      note: noteFor("Decoy"),
    });

    const envelope = await handleProjectTemplateList({}, ctx);
    expect(envelope.data.templates.map((t) => t.templateName)).toEqual(["TemplateA"]);
  });
});
