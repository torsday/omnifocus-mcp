/**
 * Tests for `perspective_evaluate_dry_run` — schema validation + handler
 * passes rules through the service to the adapter.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { PerspectiveRule } from "../../domain/perspective.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { PerspectiveService } from "../../services/perspectiveService.js";
import {
  handlePerspectiveEvaluateDryRun,
  perspectiveEvaluateDryRunInputSchema,
} from "./evaluateDryRun.js";

function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

const FLAGGED_RULE: PerspectiveRule[] = [{ actionStatus: "flagged" }] as PerspectiveRule[];

describe("perspective_evaluate_dry_run — input schema", () => {
  it("requires rules", () => {
    expect(() => perspectiveEvaluateDryRunInputSchema.parse({})).toThrow();
  });

  it("accepts an empty rules array (= show everything)", () => {
    expect(() => perspectiveEvaluateDryRunInputSchema.parse({ rules: [] })).not.toThrow();
  });

  it("accepts an aggregation enum", () => {
    expect(() =>
      perspectiveEvaluateDryRunInputSchema.parse({ aggregation: "all", rules: [] }),
    ).not.toThrow();
    expect(() =>
      perspectiveEvaluateDryRunInputSchema.parse({ aggregation: "any", rules: [] }),
    ).not.toThrow();
    expect(() =>
      perspectiveEvaluateDryRunInputSchema.parse({ aggregation: "none", rules: [] }),
    ).not.toThrow();
  });

  it("rejects an unknown aggregation", () => {
    expect(() =>
      perspectiveEvaluateDryRunInputSchema.parse({ aggregation: "bogus", rules: [] }),
    ).toThrow();
  });
});

describe("perspective_evaluate_dry_run — handler", () => {
  it("returns the tasks the adapter resolves for these rules + aggregation", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t1 = await adapter.createTask({ name: "alpha", projectId: projId, flagged: true });
    await adapter.createTask({ name: "beta", projectId: projId });

    // Seed the adapter so a (rules, aggregation) lookup returns just t1.
    adapter.seedPerspectiveRulesEvaluation(FLAGGED_RULE, [t1], "all");

    const service = new PerspectiveService({ adapter });
    const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
      correlationId: "test",
      durationMs: 1,
      cacheHit: false,
      transport: "memory",
      ofVersion: "test",
      ...partial,
    });

    const envelope = assertOk(
      await handlePerspectiveEvaluateDryRun(
        { aggregation: "all", rules: FLAGGED_RULE },
        { perspectiveService: service, makeMeta },
      ),
    );

    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.id).toBe(t1);
  });

  it("returns an empty list when the adapter has no seeded mapping (no match)", async () => {
    const adapter = new InMemoryAdapter();
    const service = new PerspectiveService({ adapter });
    const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
      correlationId: "test",
      durationMs: 1,
      cacheHit: false,
      transport: "memory",
      ofVersion: "test",
      ...partial,
    });

    const envelope = assertOk(
      await handlePerspectiveEvaluateDryRun(
        { rules: [] },
        { perspectiveService: service, makeMeta },
      ),
    );
    expect(envelope.data.tasks).toEqual([]);
  });

  it("aggregation is forwarded through service to adapter", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t1 = await adapter.createTask({ name: "x", projectId: projId, flagged: true });

    // Seed two distinct mappings — same rules, different aggregation.
    adapter.seedPerspectiveRulesEvaluation(FLAGGED_RULE, [t1], "all");
    adapter.seedPerspectiveRulesEvaluation(FLAGGED_RULE, [], "any");

    const service = new PerspectiveService({ adapter });
    const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
      correlationId: "test",
      durationMs: 1,
      cacheHit: false,
      transport: "memory",
      ofVersion: "test",
      ...partial,
    });

    const aggAll = assertOk(
      await handlePerspectiveEvaluateDryRun(
        { aggregation: "all", rules: FLAGGED_RULE },
        { perspectiveService: service, makeMeta },
      ),
    );
    const aggAny = assertOk(
      await handlePerspectiveEvaluateDryRun(
        { aggregation: "any", rules: FLAGGED_RULE },
        { perspectiveService: service, makeMeta },
      ),
    );

    expect(aggAll.data.tasks).toHaveLength(1);
    expect(aggAny.data.tasks).toHaveLength(0);
  });
});
