/**
 * Tests for the `export_opml` tool — schema, description, handler envelope.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ExportService } from "../../services/exportService.js";
import { EXPORT_OPML_DESCRIPTION, exportOpmlInputSchema, handleExportOpml } from "./opml.js";

function makeCtx() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const exportService = new ExportService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { exportService, makeMeta }, adapter };
}

describe("export_opml — input schema", () => {
  it("accepts scope='all' without id", () => {
    expect(() => exportOpmlInputSchema.parse({ scope: "all" })).not.toThrow();
  });

  it("accepts scope='project' with an id", () => {
    const result = exportOpmlInputSchema.parse({ scope: "project", id: "proj_abc" });
    expect(result.scope).toBe("project");
    expect(result.id).toBe("proj_abc");
  });

  it("accepts scope='folder' with an id", () => {
    const result = exportOpmlInputSchema.parse({ scope: "folder", id: "folder_xyz" });
    expect(result.scope).toBe("folder");
  });

  it("rejects an unknown scope value", () => {
    expect(() => exportOpmlInputSchema.parse({ scope: "task" })).toThrow();
  });
});

describe("export_opml — description", () => {
  it("mentions OPML", () => {
    expect(EXPORT_OPML_DESCRIPTION).toMatch(/OPML/i);
  });

  it("has a when-not clause", () => {
    expect(EXPORT_OPML_DESCRIPTION).toMatch(/Do NOT/i);
  });

  it("is read-only (no side effects)", () => {
    expect(EXPORT_OPML_DESCRIPTION).toMatch(/no side effects/i);
  });
});

describe("export_opml — handler", () => {
  it("returns an ok envelope with opml string and counts", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createProject({ name: "Test Project" });

    const envelope = await handleExportOpml({ scope: "all" }, ctx);
    expect(typeof envelope.data.opml).toBe("string");
    expect(envelope.data.opml).toContain("<opml");
    expect(envelope.data.projectCount).toBe(1);
    expect(typeof envelope.data.taskCount).toBe("number");
  });

  it("handler throws for scope='project' without id", async () => {
    const { ctx } = makeCtx();
    await expect(handleExportOpml({ scope: "project" }, ctx)).rejects.toThrow(/requires an id/);
  });

  it("returns empty OPML for scope='all' with no projects", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleExportOpml({ scope: "all" }, ctx);
    expect(envelope.data.projectCount).toBe(0);
    expect(envelope.data.opml).toContain("</opml>");
  });
});
