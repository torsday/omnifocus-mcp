/**
 * Unit tests for the `repetition_from_prose` tool handler.
 *
 * The grammar's behaviour is exhaustively tested in
 * `src/domain/repetitionGrammar.test.ts`. These tests cover the tool seam:
 * registration, envelope wrapping, and pass-through to the parser.
 */

import { describe, expect, it, vi } from "vitest";

import type { ResponseMeta } from "../../envelope/index.js";

import { handleRepetitionFromProse, registerRepetitionFromProseTool } from "./fromProse.js";

const META: ResponseMeta = {
  correlationId: "01TESTREPETITIONFROMPROSE",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

const ctx = { makeMeta: () => META };

describe("handleRepetitionFromProse", () => {
  it("wraps an ok parse in an ok envelope", async () => {
    const env = await handleRepetitionFromProse({ prose: "weekly" }, ctx);
    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.kind).toBe("ok");
    if (env.data.kind !== "ok") return;
    expect(env.data.rule).toEqual({ method: "fixed", unit: "weeks", steps: 1 });
  });

  it("wraps an ambiguous parse in an ok envelope (the result is the ambiguity)", async () => {
    const env = await handleRepetitionFromProse({ prose: "every other Tuesday" }, ctx);
    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.kind).toBe("ambiguous");
  });

  it("wraps an error parse in an ok envelope (the parse error is the result, not a tool error)", async () => {
    const env = await handleRepetitionFromProse({ prose: "buy milk" }, ctx);
    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.kind).toBe("error");
  });

  it("populates meta from the supplied makeMeta", async () => {
    const env = await handleRepetitionFromProse({ prose: "daily" }, ctx);
    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.meta.correlationId).toBe(META.correlationId);
  });
});

describe("registerRepetitionFromProseTool", () => {
  it("registers the tool with the canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<
      typeof registerRepetitionFromProseTool
    >[0];
    registerRepetitionFromProseTool(server, ctx);
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toBe("repetition_from_prose");
  });

  it("supplies an inputSchema with `prose` as a required field", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<
      typeof registerRepetitionFromProseTool
    >[0];
    registerRepetitionFromProseTool(server, ctx);
    const config = registerTool.mock.calls[0]?.[1];
    expect(config).toHaveProperty("inputSchema.prose");
  });
});
