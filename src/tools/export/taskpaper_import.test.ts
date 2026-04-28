/**
 * Unit tests for the `import_taskpaper` handler — covers the lever-4 name
 * pairing introduced in #609 (id ⇄ name), batching, and orphan handling.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ExportService } from "../../services/exportService.js";
import { handleImportTaskPaper } from "./taskpaper.js";

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

const SAMPLE_TP = `- Buy milk @errands
- Call dentist @due(2026-05-01)`;

describe("import_taskpaper — name pairing (#609)", () => {
  it("returns { tasks: [{ id, name }], warnings } pairing each new id with its display name", async () => {
    const { ctx } = makeCtx();
    const env = await handleImportTaskPaper({ text: SAMPLE_TP }, ctx);

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
    await handleImportTaskPaper({ text: SAMPLE_TP }, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns { tasks: [] } and skips the batch when nothing creatable is parsed", async () => {
    const { ctx, adapter } = makeCtx();
    const spy = vi.spyOn(adapter, "getTasksMany");
    // Only a project heading with no tasks — parser returns no created ids.
    const env = await handleImportTaskPaper({ text: "Some project:" }, ctx);
    expect(env.data.tasks).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops orphan ids rather than emitting half-paired records", async () => {
    const { ctx, adapter } = makeCtx();
    const realGet = adapter.getTasksMany.bind(adapter);
    vi.spyOn(adapter, "getTasksMany").mockImplementation(async (ids) => {
      const real = await realGet(ids);
      return real.map((t, i) => (i === 0 ? null : t));
    });
    const env = await handleImportTaskPaper({ text: SAMPLE_TP }, ctx);
    expect(env.data.tasks).toHaveLength(1);
  });
});
