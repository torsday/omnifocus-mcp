/**
 * Unit tests for `database_undo` and `database_redo`.
 *
 * Coverage:
 *   - Empty-stack returns { undid|redid: false }; non-empty returns true
 *   - Cache flush only happens on actual mutation (false → no-op)
 *   - syncPending mirrors the boolean result
 *   - Schema rejects calls without `confirm: true`
 *   - Round-trip: undo bumps redo stack; redo bumps undo stack
 *   - Registration shape
 */

import { describe, expect, it, vi } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ClearableCache } from "../../cache/invalidation.js";
import type { ResponseMeta } from "../../envelope/index.js";

import { databaseRedoInputSchema, handleDatabaseRedo, registerDatabaseRedoTool } from "./redo.js";
import { databaseUndoInputSchema, handleDatabaseUndo, registerDatabaseUndoTool } from "./undo.js";

const META: ResponseMeta = {
  correlationId: "01TESTUNDOREDO",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

function makeStubCache(): ClearableCache & { clearCalls: number; invalidateCalls: number } {
  let clearCalls = 0;
  let invalidateCalls = 0;
  return {
    get clearCalls() {
      return clearCalls;
    },
    get invalidateCalls() {
      return invalidateCalls;
    },
    clear() {
      clearCalls += 1;
    },
    invalidate() {
      invalidateCalls += 1;
    },
  };
}

function makeCtx(adapter: InMemoryAdapter, cache?: ClearableCache) {
  return {
    adapter,
    makeMeta: (partial: Partial<ResponseMeta> = {}) => ({ ...META, ...partial }),
    ...(cache !== undefined && { cache }),
  };
}

// ---------------------------------------------------------------------------
// undo — empty stack
// ---------------------------------------------------------------------------

describe("handleDatabaseUndo — empty stack", () => {
  it("returns { undid: false } when the stack is empty", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleDatabaseUndo({ confirm: true }, makeCtx(adapter));
    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.undid).toBe(false);
  });

  it("does NOT flush the cache on an empty-stack no-op", async () => {
    const adapter = new InMemoryAdapter();
    const cache = makeStubCache();
    await handleDatabaseUndo({ confirm: true }, makeCtx(adapter, cache));
    expect(cache.clearCalls).toBe(0);
  });

  it("emits syncPending=false on an empty-stack no-op", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleDatabaseUndo({ confirm: true }, makeCtx(adapter));
    if (!("data" in env)) return;
    expect(env.meta.syncPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// undo — non-empty stack
// ---------------------------------------------------------------------------

describe("handleDatabaseUndo — non-empty stack", () => {
  it("returns { undid: true } and flushes the cache", async () => {
    const adapter = new InMemoryAdapter();
    adapter.undoStackDepth = 3; // simulate prior mutations

    const cache = makeStubCache();
    const env = await handleDatabaseUndo({ confirm: true }, makeCtx(adapter, cache));
    if (!("data" in env)) return;
    expect(env.data.undid).toBe(true);
    expect(cache.clearCalls).toBe(1);
    expect(env.meta.syncPending).toBe(true);
  });

  it("decrements undoStackDepth and increments redoStackDepth", async () => {
    const adapter = new InMemoryAdapter();
    adapter.undoStackDepth = 2;
    adapter.redoStackDepth = 0;

    await handleDatabaseUndo({ confirm: true }, makeCtx(adapter));
    expect(adapter.undoStackDepth).toBe(1);
    expect(adapter.redoStackDepth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// redo — symmetric coverage
// ---------------------------------------------------------------------------

describe("handleDatabaseRedo", () => {
  it("returns { redid: false } when the redo stack is empty", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleDatabaseRedo({ confirm: true }, makeCtx(adapter));
    if (!("data" in env)) return;
    expect(env.data.redid).toBe(false);
    expect(env.meta.syncPending).toBe(false);
  });

  it("returns { redid: true } and flushes the cache when the stack has an entry", async () => {
    const adapter = new InMemoryAdapter();
    adapter.redoStackDepth = 1;

    const cache = makeStubCache();
    const env = await handleDatabaseRedo({ confirm: true }, makeCtx(adapter, cache));
    if (!("data" in env)) return;
    expect(env.data.redid).toBe(true);
    expect(cache.clearCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Round-trip — undo then redo
// ---------------------------------------------------------------------------

describe("undo → redo round-trip", () => {
  it("undo pushes to redo stack; redo pulls back", async () => {
    const adapter = new InMemoryAdapter();
    adapter.undoStackDepth = 1;
    adapter.redoStackDepth = 0;

    await handleDatabaseUndo({ confirm: true }, makeCtx(adapter));
    expect(adapter.undoStackDepth).toBe(0);
    expect(adapter.redoStackDepth).toBe(1);

    await handleDatabaseRedo({ confirm: true }, makeCtx(adapter));
    expect(adapter.undoStackDepth).toBe(1);
    expect(adapter.redoStackDepth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Schema — confirm is mandatory and must be exactly true
// ---------------------------------------------------------------------------

describe("schemas — confirm: true is mandatory", () => {
  it("undo schema rejects missing confirm", () => {
    expect(databaseUndoInputSchema.safeParse({}).success).toBe(false);
  });

  it("undo schema rejects confirm: false", () => {
    expect(databaseUndoInputSchema.safeParse({ confirm: false }).success).toBe(false);
  });

  it("undo schema accepts confirm: true", () => {
    expect(databaseUndoInputSchema.safeParse({ confirm: true }).success).toBe(true);
  });

  it("redo schema rejects missing confirm", () => {
    expect(databaseRedoInputSchema.safeParse({}).success).toBe(false);
  });

  it("redo schema rejects confirm: false", () => {
    expect(databaseRedoInputSchema.safeParse({ confirm: false }).success).toBe(false);
  });

  it("redo schema accepts confirm: true", () => {
    expect(databaseRedoInputSchema.safeParse({ confirm: true }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerDatabaseUndoTool / registerDatabaseRedoTool", () => {
  it("undo registers under canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<typeof registerDatabaseUndoTool>[0];
    const adapter = new InMemoryAdapter();
    registerDatabaseUndoTool(server, makeCtx(adapter));
    expect(registerTool.mock.calls[0]?.[0]).toBe("database_undo");
  });

  it("redo registers under canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<typeof registerDatabaseRedoTool>[0];
    const adapter = new InMemoryAdapter();
    registerDatabaseRedoTool(server, makeCtx(adapter));
    expect(registerTool.mock.calls[0]?.[0]).toBe("database_redo");
  });
});
