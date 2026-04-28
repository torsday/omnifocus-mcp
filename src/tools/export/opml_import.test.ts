/**
 * Unit tests for the `import_opml` tool — covers handler shape, the lever-4
 * name pairing introduced in #609 (id ⇄ name), the empty-import case, and
 * orphan handling.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ExportService } from "../../services/exportService.js";
import { handleImportOpml } from "./opml_import.js";

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const exportService = new ExportService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { adapter, exportService, makeMeta }, adapter };
}

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>OmniFocus</title></head>
  <body>
    <outline text="Buy milk" />
    <outline text="Call dentist" />
  </body>
</opml>`;

describe("import_opml — name pairing (#609)", () => {
  it("returns { imported, tasks: [{ id, name }] } pairing each new id with its display name", async () => {
    const { ctx } = makeCtx();
    const env = await handleImportOpml({ opml: SAMPLE_OPML }, ctx);

    expect(env.data.imported).toBe(2);
    expect(env.data.tasks).toHaveLength(2);
    const names = env.data.tasks.map((t) => t.name).sort();
    expect(names).toEqual(["Buy milk", "Call dentist"]);
    for (const t of env.data.tasks) {
      expect(typeof t.id).toBe("string");
      expect(t.id.length).toBeGreaterThan(0);
    }
  });

  it("uses a single getTasksMany call for the batch lookup", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "getTasksMany");
    await handleImportOpml({ opml: SAMPLE_OPML }, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns { imported: 0, tasks: [] } and skips the batch when no tasks are imported", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "getTasksMany");
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>x</title></head><body></body></opml>`;
    const env = await handleImportOpml({ opml: empty }, ctx);
    expect(env.data.imported).toBe(0);
    expect(env.data.tasks).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops orphan ids (deleted between import and lookup) rather than emitting half-paired records", async () => {
    const { ctx, adapter } = makeCtx();
    // Force the post-import lookup to report one slot as null (orphan).
    const realGet = adapter.getTasksMany.bind(adapter);
    vi.spyOn(adapter, "getTasksMany").mockImplementation(async (ids) => {
      const real = await realGet(ids);
      return real.map((t, i) => (i === 0 ? null : t));
    });
    const env = await handleImportOpml({ opml: SAMPLE_OPML }, ctx);
    expect(env.data.imported).toBe(2);
    // Imported is the actual count from the adapter; tasks omits the orphan.
    expect(env.data.tasks).toHaveLength(1);
  });

  it("sets meta.syncPending = true so callers know a sync is needed", async () => {
    const { ctx } = makeCtx();
    const env = await handleImportOpml({ opml: SAMPLE_OPML }, ctx);
    expect(env.meta.syncPending).toBe(true);
  });
});
