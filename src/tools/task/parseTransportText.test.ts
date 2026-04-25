/**
 * Unit tests for the task_parse_transport_text MCP tool handler.
 */

import { describe, expect, it } from "vitest";
import type { ResponseMeta } from "../../envelope/index.js";
import {
  handleTaskParseTransportText,
  TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION,
} from "./parseTransportText.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  const makeMeta = (): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
  });
  return { ctx: { makeMeta } };
}

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

describe("task_parse_transport_text — handler", () => {
  it("returns tasks and count in data on happy path", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText(
      { text: "Buy groceries\nCall dentist" },
      ctx,
    );
    expect(envelope.data.count).toBe(2);
    expect(envelope.data.tasks).toHaveLength(2);
    expect(envelope.data.tasks[0]?.name).toBe("Buy groceries");
    expect(envelope.data.tasks[1]?.name).toBe("Call dentist");
  });

  it("wraps result in ok() envelope", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText({ text: "Task one" }, ctx);
    expect("data" in envelope).toBe(true);
    expect(envelope.meta.correlationId).toBe("test-cid");
  });

  it("warnings appear in data.warnings when present", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText({ text: "Task #next-tuesday" }, ctx);
    expect(envelope.data.warnings).toBeDefined();
    expect(envelope.data.warnings?.length).toBeGreaterThan(0);
    expect(envelope.data.warnings?.[0]).toContain("next-tuesday");
  });

  it("data.warnings is undefined when no warnings", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText({ text: "Task #today" }, ctx);
    expect(envelope.data.warnings).toBeUndefined();
  });

  it("does not set syncPending", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText({ text: "Task" }, ctx);
    expect(envelope.meta.syncPending).toBeUndefined();
  });

  it("meta.warnings is undefined (advisories are in data.warnings)", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskParseTransportText({ text: "Task #next-friday" }, ctx);
    expect(envelope.meta.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("task_parse_transport_text — description", () => {
  it("mentions task_create", () => {
    expect(TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION).toContain("task_create");
  });

  it("mentions no side effects", () => {
    expect(TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION).toContain("no side effects");
  });
});
