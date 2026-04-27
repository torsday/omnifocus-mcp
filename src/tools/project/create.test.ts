/**
 * Tests for project_create tool.
 *
 * Covers: schema validation, successful creation, optional fields,
 * cache invalidation, and response shape.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import {
  isClarificationNeeded,
  type ResponseMeta,
  type ToolEnvelope,
  type ToolSuccess,
} from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { ReplayStore } from "../../state/replayStore.js";
import {
  handleProjectCreate,
  PROJECT_CREATE_DESCRIPTION,
  projectCreateInputSchema,
} from "./create.js";

/** Narrow a handler envelope to ToolSuccess or fail the assertion. */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
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
  const idempotencyStore = new IdempotencyStore();
  const replayStore = new ReplayStore(60_000);
  return {
    ctx: { adapter, makeMeta, idempotencyStore, replayStore },
    adapter,
    idempotencyStore,
    replayStore,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_create — input schema", () => {
  it("requires name", () => {
    expect(() => projectCreateInputSchema.parse({})).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => projectCreateInputSchema.parse({ name: "" })).toThrow();
  });

  it("accepts minimal input (name only)", () => {
    const parsed = projectCreateInputSchema.parse({ name: "My Project" });
    expect(parsed.name).toBe("My Project");
  });

  it("accepts full optional fields", () => {
    const parsed = projectCreateInputSchema.parse({
      name: "Full Project",
      status: "on-hold",
      completionCriterion: "sequential",
      flagged: true,
      estimatedMinutes: 60,
      reviewIntervalDays: 7,
      deferDate: "2026-01-01T00:00:00+00:00",
      dueDate: "2026-02-01T00:00:00+00:00",
    });
    expect(parsed.status).toBe("on-hold");
    expect(parsed.completionCriterion).toBe("sequential");
    expect(parsed.flagged).toBe(true);
    expect(parsed.estimatedMinutes).toBe(60);
    expect(parsed.reviewIntervalDays).toBe(7);
  });

  it("rejects invalid status", () => {
    expect(() => projectCreateInputSchema.parse({ name: "P", status: "completed" })).toThrow();
  });

  it("rejects estimatedMinutes < 1", () => {
    expect(() => projectCreateInputSchema.parse({ name: "P", estimatedMinutes: 0 })).toThrow();
  });

  it("normalises status alias 'paused' → 'on-hold' (#573)", () => {
    const parsed = projectCreateInputSchema.parse({ name: "P", status: "paused" });
    expect(parsed.status).toBe("on-hold");
  });

  it("normalises completionCriterion aliases (#573)", () => {
    expect(
      projectCreateInputSchema.parse({ name: "P", completionCriterion: "in order" })
        .completionCriterion,
    ).toBe("sequential");
    expect(
      projectCreateInputSchema.parse({ name: "P", completionCriterion: "in-order" })
        .completionCriterion,
    ).toBe("sequential");
    expect(
      projectCreateInputSchema.parse({ name: "P", completionCriterion: "any order" })
        .completionCriterion,
    ).toBe("parallel");
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_create — handler", () => {
  it("creates a project and returns { created: true, id }", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleProjectCreate({ name: "New Project" }, ctx));

    expect(envelope.data.created).toBe(true);
    expect(typeof envelope.data.id).toBe("string");
    expect(envelope.data.id.length).toBeGreaterThan(0);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleProjectCreate({ name: "P" }, ctx));
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("project is retrievable from adapter after creation", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = assertOk(await handleProjectCreate({ name: "Retrievable" }, ctx));
    const project = await adapter.getProject(envelope.data.id);
    expect(project.name).toBe("Retrievable");
  });

  it("creates with status on-hold", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = assertOk(
      await handleProjectCreate({ name: "On Hold", status: "on-hold" }, ctx),
    );
    const project = await adapter.getProject(envelope.data.id);
    expect(project.status).toBe("on-hold");
  });

  it("creates with flagged=true", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = assertOk(await handleProjectCreate({ name: "Flagged", flagged: true }, ctx));
    const project = await adapter.getProject(envelope.data.id);
    expect(project.flagged).toBe(true);
  });

  it("creates without optional fields (minimal path)", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleProjectCreate({ name: "Minimal" }, ctx));
    expect(envelope.data.created).toBe(true);
  });

  it("multiple creates return distinct IDs", async () => {
    const { ctx } = makeCtx();
    const a = assertOk(await handleProjectCreate({ name: "A" }, ctx));
    const b = assertOk(await handleProjectCreate({ name: "B" }, ctx));
    expect(a.data.id).not.toBe(b.data.id);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_create — cache invalidation", () => {
  it("emits project:${id}, forecast:*, perspective:*, search:*", async () => {
    const { ctx: base } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);

    const envelope = assertOk(
      await handleProjectCreate({ name: "Cache Test" }, { ...base, cache }),
    );
    const id = envelope.data.id;

    expect(scopes).toEqual([`project:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("does not invalidate when no cache is provided", async () => {
    const { ctx } = makeCtx();
    // No error, just no cache side-effects
    const envelope = assertOk(await handleProjectCreate({ name: "No Cache" }, ctx));
    expect(envelope.data.created).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency (#252)
// ---------------------------------------------------------------------------

describe("project_create — idempotency_key schema", () => {
  it("accepts idempotency_key", () => {
    const result = projectCreateInputSchema.safeParse({ name: "P", idempotency_key: "abc" });
    expect(result.success).toBe(true);
  });

  it("rejects empty idempotency_key", () => {
    const result = projectCreateInputSchema.safeParse({ name: "P", idempotency_key: "" });
    expect(result.success).toBe(false);
  });

  it("rejects idempotency_key longer than 128 chars", () => {
    const result = projectCreateInputSchema.safeParse({
      name: "P",
      idempotency_key: "x".repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

describe("project_create — idempotency_key", () => {
  it("returns clarification-needed on name collision when no key is provided", async () => {
    const { ctx, replayStore } = makeCtx();
    await handleProjectCreate({ name: "A" }, ctx);
    const second = await handleProjectCreate({ name: "A" }, ctx);
    expect(isClarificationNeeded(second)).toBe(true);
    if (!isClarificationNeeded(second)) throw new Error("expected clarification-needed");
    expect(second.question).toContain('"A"');
    expect(replayStore.size).toBe(1);
  });

  it("replays the cached envelope on repeat with same key", async () => {
    const { adapter, ctx } = makeCtx();
    const first = assertOk(await handleProjectCreate({ name: "A", idempotency_key: "k1" }, ctx));
    const second = assertOk(await handleProjectCreate({ name: "A", idempotency_key: "k1" }, ctx));
    expect(second.data.id).toBe(first.data.id);
    expect(second.meta.idempotentReplay).toBe(true);
    const projects = await adapter.listProjects();
    expect(projects.length).toBe(1);
  });

  it("treats different keys as separate creates when user confirms force-create", async () => {
    const { adapter, ctx, replayStore } = makeCtx();
    const first = assertOk(await handleProjectCreate({ name: "A", idempotency_key: "k1" }, ctx));

    // Second call with different key hits collision guard → clarification-needed.
    const clarify = await handleProjectCreate({ name: "A", idempotency_key: "k2" }, ctx);
    expect(isClarificationNeeded(clarify)).toBe(true);
    if (!isClarificationNeeded(clarify)) throw new Error("expected clarification-needed");

    // User picks choice 1 → force-create.
    const entry = replayStore.consume(clarify.replayToken);
    if (!entry) throw new Error("token not found");
    const second = assertOk(
      (await entry.callback(1)) as ToolEnvelope<{ created: boolean; id: string }>,
    );

    expect(second.data.id).not.toBe(first.data.id);
    const projects = await adapter.listProjects();
    expect(projects.length).toBe(2);
  });

  it("coalesces concurrent calls with the same key onto one adapter create", async () => {
    const { adapter, ctx } = makeCtx();
    const [a, b] = await Promise.all([
      handleProjectCreate({ name: "A", idempotency_key: "race" }, ctx),
      handleProjectCreate({ name: "A", idempotency_key: "race" }, ctx),
    ]);
    expect(assertOk(a).data.id).toBe(assertOk(b).data.id);
    const projects = await adapter.listProjects();
    expect(projects.length).toBe(1);
  });
});

describe("project_create — description", () => {
  it("mentions idempotency_key", () => {
    expect(PROJECT_CREATE_DESCRIPTION).toContain("idempotency_key");
  });

  it("mentions sync_trigger", () => {
    expect(PROJECT_CREATE_DESCRIPTION).toContain("sync_trigger");
  });
});
