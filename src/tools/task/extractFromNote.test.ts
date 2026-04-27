/**
 * Unit tests for the `task_extract_from_note` tool.
 *
 * Extractor behaviour is covered exhaustively in
 * `src/domain/proseExtractor.test.ts`. These tests cover the tool seam:
 * source resolution (task / project / inline), the dry-run path, the write
 * path with confirmation, schema-level required-confirmation enforcement,
 * and registration.
 */

import { describe, expect, it, vi } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";

import {
  handleTaskExtractFromNote,
  registerTaskExtractFromNoteTool,
  taskExtractFromNoteInputSchema,
} from "./extractFromNote.js";

const META: ResponseMeta = {
  correlationId: "01TESTEXTRACTFROMNOTE",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

function makeCtx(adapter: InMemoryAdapter) {
  return {
    adapter,
    makeMeta: (partial: Partial<ResponseMeta> = {}) => ({ ...META, ...partial }),
  };
}

// ---------------------------------------------------------------------------
// Dry-run path
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromNote — dry run", () => {
  it("inline source returns proposed + unmappedLines without writing", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "target" });
    const before = (await adapter.listTasks({ projectId: projId })).length;

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "inline", text: "1. Send report\n2. File receipts\nContext line" },
        targetProjectId: projId,
        dryRun: true,
      },
      makeCtx(adapter),
    );

    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.phase).toBe("dryRun");
    if (env.data.phase !== "dryRun") return;
    expect(env.data.proposed).toEqual([
      { name: "Send report", sourceLines: [1] },
      { name: "File receipts", sourceLines: [2] },
    ]);
    expect(env.data.unmappedLines).toEqual(["L3: Context line"]);

    const after = (await adapter.listTasks({ projectId: projId })).length;
    expect(after).toBe(before);
  });

  it("task source reads from the task's note field", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const sourceTask = await adapter.createTask({
      name: "with-note",
      projectId: projId,
      note: "- Alpha\n- Beta",
    });
    const targetId = await adapter.createProject({ name: "target" });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "task", taskId: sourceTask },
        targetProjectId: targetId,
        dryRun: true,
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    if (env.data.phase !== "dryRun") return;
    expect(env.data.proposed.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });

  it("project source reads from the project's note field", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "src", note: "1. X\n2. Y" });
    const targetId = await adapter.createProject({ name: "target" });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "project", projectId: projId },
        targetProjectId: targetId,
        dryRun: true,
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    if (env.data.phase !== "dryRun") return;
    expect(env.data.proposed.map((p) => p.name)).toEqual(["X", "Y"]);
  });

  it("returns empty arrays when source note is empty/null", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const sourceTask = await adapter.createTask({ name: "no-note", projectId: projId });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "task", taskId: sourceTask },
        targetProjectId: projId,
        dryRun: true,
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.phase !== "dryRun") return;
    expect(env.data.proposed).toEqual([]);
    expect(env.data.unmappedLines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromNote — write path", () => {
  it("creates tasks from confirmation[] in the target project", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "target" });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "inline", text: "ignored — write phase reads confirmation" },
        targetProjectId: projId,
        dryRun: false,
        confirmation: [
          { name: "Alpha", sourceLines: [1] },
          { name: "Beta", note: "extra context", sourceLines: [2] },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.phase).toBe("created");
    if (env.data.phase !== "created") return;
    expect(env.data.outcome.succeeded).toHaveLength(2);
    expect(env.data.outcome.failed).toHaveLength(0);

    const tasks = await adapter.listTasks({ projectId: projId });
    const names = tasks.map((t) => t.name).sort();
    expect(names).toEqual(["Alpha", "Beta"]);
    const beta = tasks.find((t) => t.name === "Beta");
    expect(beta?.note).toBe("extra context");
  });

  it("emits syncPending=true when at least one task was created", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "target" });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "inline", text: "noop" },
        targetProjectId: projId,
        dryRun: false,
        confirmation: [{ name: "X", sourceLines: [1] }],
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.phase !== "created") return;
    expect(env.meta.syncPending).toBe(true);
  });

  it("propagates dueDate and deferDate from confirmation", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "target" });

    const env = await handleTaskExtractFromNote(
      {
        source: { kind: "inline", text: "noop" },
        targetProjectId: projId,
        dryRun: false,
        confirmation: [
          {
            name: "Dated",
            sourceLines: [1],
            dueDate: "2026-12-01T00:00:00.000Z",
            deferDate: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.phase !== "created") return;
    const tasks = await adapter.listTasks({ projectId: projId });
    const dated = tasks.find((t) => t.name === "Dated");
    expect(dated?.dueDate).toBeTruthy();
    expect(dated?.deferDate).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Schema validation — confirmation required when dryRun=false
// ---------------------------------------------------------------------------

describe("taskExtractFromNoteInputSchema", () => {
  it("rejects dryRun=false without confirmation", () => {
    const projId = "abc123def456" as never;
    const result = taskExtractFromNoteInputSchema.safeParse({
      source: { kind: "inline", text: "x" },
      targetProjectId: projId,
      dryRun: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts dryRun=true without confirmation (the default)", () => {
    const projId = "abc123def456" as never;
    const result = taskExtractFromNoteInputSchema.safeParse({
      source: { kind: "inline", text: "x" },
      targetProjectId: projId,
      dryRun: true,
    });
    expect(result.success).toBe(true);
  });

  it("dryRun defaults to true when omitted", () => {
    const projId = "abc123def456" as never;
    const result = taskExtractFromNoteInputSchema.safeParse({
      source: { kind: "inline", text: "x" },
      targetProjectId: projId,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dryRun).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerTaskExtractFromNoteTool", () => {
  it("registers under the canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<
      typeof registerTaskExtractFromNoteTool
    >[0];
    const adapter = new InMemoryAdapter();
    registerTaskExtractFromNoteTool(server, makeCtx(adapter));
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toBe("task_extract_from_note");
  });
});
