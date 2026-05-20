/**
 * End-to-end contract tests for the idempotency-key replay surface (#982).
 *
 * Per-tool unit tests (e.g. `src/tools/task/update.test.ts`,
 * `src/tools/note/note.test.ts`) cover the per-handler wiring. This suite
 * exercises the cross-cutting contract documented in `docs/idempotency.md`:
 * what should happen when the same key meets the same input, the same key
 * meets *different* input, a different key, and a key whose TTL has
 * expired.
 *
 * Runs against `InMemoryAdapter` in the unit tier — fast, deterministic,
 * no live-OmniFocus dependency. The contract is independent of which
 * adapter sits behind the handler.
 *
 * @see docs/idempotency.md — the contract this suite verifies
 * @see #836 — parent audit; AC #5 is what this closes
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../src/adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../src/envelope/index.js";
import { IdempotencyStore } from "../../src/server/idempotencyStore.js";
import { handleTaskUpdate } from "../../src/tools/task/update.js";

/**
 * Narrow a tool envelope to its success arm. The handlers in this suite
 * always return ok() on the happy path; this helper throws if the
 * envelope unexpectedly came back as an error so the test surfaces the
 * failure with the actual error text instead of "data is undefined".
 */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if ("error" in envelope) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope.error)}`);
  }
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got: ${JSON.stringify(envelope)}`);
  }
  return envelope as ToolSuccess<T>;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function harness(storeOpts?: { ttlMs?: number; now?: () => number }) {
  const adapter = new InMemoryAdapter();
  const idempotencyStore = new IdempotencyStore({
    ttlMs: storeOpts?.ttlMs ?? 600_000,
    ...(storeOpts?.now !== undefined ? { now: storeOpts.now } : {}),
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  const taskId = await adapter.createTask({ name: "Original" });
  return {
    ctx: { adapter, makeMeta, idempotencyStore },
    adapter,
    idempotencyStore,
    taskId,
  };
}

// ---------------------------------------------------------------------------
// AC §5 — same key + same input → cached envelope
// ---------------------------------------------------------------------------

describe("idempotency contract — same key + same input", () => {
  it("returns the cached envelope on retry with meta.idempotentReplay = true", async () => {
    const { ctx, adapter, taskId } = await harness();

    const first = assertOk(
      await handleTaskUpdate({ id: taskId, name: "Renamed", idempotency_key: "k-1" }, ctx),
    );
    expect(first.data.task.name).toBe("Renamed");
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = assertOk(
      await handleTaskUpdate({ id: taskId, name: "Renamed", idempotency_key: "k-1" }, ctx),
    );
    expect(second.data.task.name).toBe("Renamed");
    expect(second.meta.idempotentReplay).toBe(true);

    // Underlying state matches the first call's outcome.
    expect((await adapter.getTask(taskId)).name).toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
// AC §5 — same key + DIFFERENT input → cached envelope (same outcome contract)
// ---------------------------------------------------------------------------

describe("idempotency contract — same key + different input", () => {
  it("replays the original envelope; the new input is NOT applied", async () => {
    const { ctx, adapter, taskId } = await harness();

    const first = assertOk(
      await handleTaskUpdate({ id: taskId, name: "Original-rename", idempotency_key: "k-1" }, ctx),
    );
    expect(first.data.task.name).toBe("Original-rename");

    // Same key, different input. The contract is "same key → same
    // outcome", so the second call replays the first envelope and
    // does NOT apply the would-be new name.
    const second = assertOk(
      await handleTaskUpdate({ id: taskId, name: "Different-rename", idempotency_key: "k-1" }, ctx),
    );
    expect(second.data.task.name).toBe("Original-rename");
    expect(second.meta.idempotentReplay).toBe(true);

    // Underlying task still has the first call's name.
    expect((await adapter.getTask(taskId)).name).toBe("Original-rename");
  });
});

// ---------------------------------------------------------------------------
// AC §5 — different key → fresh execution
// ---------------------------------------------------------------------------

describe("idempotency contract — different keys are independent", () => {
  it("each key triggers its own fresh execution", async () => {
    const { ctx, adapter, taskId } = await harness();

    await handleTaskUpdate({ id: taskId, name: "from-key-a", idempotency_key: "key-a" }, ctx);
    const result = assertOk(
      await handleTaskUpdate({ id: taskId, name: "from-key-b", idempotency_key: "key-b" }, ctx),
    );

    // Second call ran for real.
    expect(result.meta.idempotentReplay).toBeUndefined();
    expect(result.data.task.name).toBe("from-key-b");
    expect((await adapter.getTask(taskId)).name).toBe("from-key-b");
  });
});

// ---------------------------------------------------------------------------
// AC §5 — TTL expiry → same key now executes fresh
// ---------------------------------------------------------------------------

describe("idempotency contract — TTL expiry", () => {
  it("after the TTL window, same-key calls execute fresh", async () => {
    // Inject a controllable clock; entries expire at `set-time + ttlMs`.
    let clock = 1_000_000;
    const { ctx, adapter, taskId } = await harness({
      ttlMs: 60_000, // 60s TTL for the test
      now: () => clock,
    });

    const first = assertOk(
      await handleTaskUpdate({ id: taskId, name: "before-expiry", idempotency_key: "k-1" }, ctx),
    );
    expect(first.data.task.name).toBe("before-expiry");
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Within TTL — replay.
    clock += 30_000;
    const within = assertOk(
      await handleTaskUpdate({ id: taskId, name: "wont-apply", idempotency_key: "k-1" }, ctx),
    );
    expect(within.meta.idempotentReplay).toBe(true);
    expect(within.data.task.name).toBe("before-expiry");

    // After TTL — fresh execution; the previously-ignored input applies.
    clock += 60_001;
    const after = assertOk(
      await handleTaskUpdate({ id: taskId, name: "after-expiry", idempotency_key: "k-1" }, ctx),
    );
    expect(after.meta.idempotentReplay).toBeUndefined();
    expect(after.data.task.name).toBe("after-expiry");
    expect((await adapter.getTask(taskId)).name).toBe("after-expiry");
  });
});

// ---------------------------------------------------------------------------
// Cross-tool isolation — the same key under two different tools is two
// independent entries (the store keys by raw string; collisions only happen
// when callers reuse a key intentionally).
// ---------------------------------------------------------------------------

describe("idempotency contract — store is keyed by raw key only", () => {
  it("same key used twice on the same tool replays; the contract is per-key, not per-(tool, key)", async () => {
    // This codifies the current design: the IdempotencyStore is a flat
    // key→envelope map. Tools that want per-tool partitioning must
    // namespace the key themselves (e.g. `task_update:abc`). Document
    // here so the next maintainer reading the test suite knows the
    // surface they're working against.
    const { ctx, adapter, taskId } = await harness();

    const first = assertOk(
      await handleTaskUpdate({ id: taskId, name: "A", idempotency_key: "shared-key" }, ctx),
    );
    const second = assertOk(
      await handleTaskUpdate({ id: taskId, name: "B", idempotency_key: "shared-key" }, ctx),
    );

    expect(second.meta.idempotentReplay).toBe(true);
    expect(second.data.task.name).toBe(first.data.task.name);
    expect((await adapter.getTask(taskId)).name).toBe("A");
  });
});
