/**
 * Unit tests for `JxaTransport` — M2 perspective domain methods.
 *
 * All tests use a fake spawner that returns pre-shaped JSON, so no `osascript`
 * binary is required. Integration tests against a live OmniFocus instance are
 * in JxaTransport.m2.integration.test.ts and gated behind
 * `OMNIFOCUS_INTEGRATION=1`.
 *
 * Covers:
 *   - listPerspectives — returns Perspective[] (wired via perspective_list JXA)
 *   - evaluatePerspective — returns Task[] for a builtin ID (wired via perspective_evaluate JXA)
 *   - evaluateCustomPerspective — throws ScriptError (JXA cannot do custom perspectives)
 *
 * @see src/adapter/jxa/JxaTransport.ts — implementation
 * @see src/scripts/jxa/perspective_list.js — underlying JXA script
 * @see src/scripts/jxa/perspective_evaluate.js — underlying JXA script
 */

import { describe, expect, it, vi } from "vitest";
import type { BuiltinPerspectiveId } from "../../domain/perspective.js";
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PERSPECTIVE = {
  id: "inbox",
  name: "Inbox",
  kind: "builtin" as const,
  requiresPro: false,
  icon: null,
};

const CUSTOM_PERSPECTIVE = {
  id: "custom-abc123",
  name: "My Custom",
  kind: "custom" as const,
  requiresPro: true,
  icon: "🎯",
};

const BASE_TASK = {
  id: "task_bbb",
  name: "Review item",
  note: null,
  noteHtml: null,
  projectId: null,
  parentId: null,
  tagIds: [],
  deferDate: null,
  dueDate: null,
  estimatedMinutes: null,
  flagged: false,
  completed: false,
  completedAt: null,
  dropped: false,
  droppedAt: null,
  available: true,
  blocked: false,
  sequential: false,
  completedByChildren: false,
  repetition: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// listPerspectives
// ---------------------------------------------------------------------------

describe("JxaTransport — listPerspectives", () => {
  it("returns parsed perspectives", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ perspectives: [BASE_PERSPECTIVE, CUSTOM_PERSPECTIVE] }),
    });
    const perspectives = await t.listPerspectives();
    expect(perspectives).toHaveLength(2);
    expect(perspectives[0]?.id).toBe("inbox");
    expect(perspectives[0]?.kind).toBe("builtin");
    expect(perspectives[1]?.id).toBe("custom-abc123");
    expect(perspectives[1]?.requiresPro).toBe(true);
  });

  it("returns empty array when no perspectives", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ perspectives: [] }),
    });
    const perspectives = await t.listPerspectives();
    expect(perspectives).toHaveLength(0);
  });

  it("returns icon field", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ perspectives: [CUSTOM_PERSPECTIVE] }),
    });
    const [p] = await t.listPerspectives();
    expect(p?.icon).toBe("🎯");
  });

  it("propagates a ScriptError on non-zero exit", async () => {
    const t = new JxaTransport({
      spawner: spawnerFailing("Error: unexpected script failure"),
    });
    await expect(t.listPerspectives()).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// evaluatePerspective (builtin)
// ---------------------------------------------------------------------------

describe("JxaTransport — evaluatePerspective", () => {
  it("returns tasks for a builtin perspective ID", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tasks: [BASE_TASK] }),
    });
    const tasks = await t.evaluatePerspective("inbox" as BuiltinPerspectiveId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task_bbb");
    expect(tasks[0]?.name).toBe("Review item");
  });

  it("returns empty array for empty perspective", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tasks: [] }),
    });
    const tasks = await t.evaluatePerspective("flagged" as BuiltinPerspectiveId);
    expect(tasks).toHaveLength(0);
  });

  it("brands task IDs", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tasks: [BASE_TASK] }),
    });
    const tasks = await t.evaluatePerspective("projects" as BuiltinPerspectiveId);
    // branded ID is still the same string value
    expect(tasks[0]?.id).toBe("task_bbb");
  });

  it("propagates a ScriptError on non-zero exit", async () => {
    const t = new JxaTransport({
      spawner: spawnerFailing("Error: no such perspective"),
    });
    await expect(t.evaluatePerspective("inbox" as BuiltinPerspectiveId)).rejects.toBeInstanceOf(
      ScriptError,
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateCustomPerspective (throws — JXA cannot do custom perspectives)
// ---------------------------------------------------------------------------

describe("JxaTransport — evaluateCustomPerspective", () => {
  it("throws ScriptError with omnijs-only reason", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ tasks: [] }), // never called
    });
    const err = await t.evaluateCustomPerspective("my-custom-id").catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details?.reason).toBe("omnijs-only");
    expect((err as ScriptError).details?.transport).toBe("jxa");
  });

  it("never invokes the spawner", async () => {
    const spawner = spawnerReturning({ tasks: [] });
    const t = new JxaTransport({ spawner });
    await t.evaluateCustomPerspective("x").catch(() => {});
    expect(spawner).not.toHaveBeenCalled();
  });
});
