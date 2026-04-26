/**
 * Tests for `run_jxa_script` raw escape-hatch tool.
 *
 * Covers: schema, gated registration (ADR-0004), adapter dispatch, audit
 * logging of the full script body, ValidationError when the adapter does
 * not expose the method.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { handleRunJxaScript, registerRunJxaScriptTool, runJxaScriptInputSchema } from "./jxa.js";

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test",
    durationMs: 1,
    cacheHit: false,
    transport: "jxa",
    ofVersion: "test",
    ...partial,
  };
}

describe("run_jxa_script — input schema", () => {
  it("requires a non-empty script", () => {
    expect(runJxaScriptInputSchema.safeParse({}).success).toBe(false);
    expect(runJxaScriptInputSchema.safeParse({ script: "" }).success).toBe(false);
    expect(
      runJxaScriptInputSchema.safeParse({ script: "function run(){return '{}';}" }).success,
    ).toBe(true);
  });

  it("accepts an arbitrary arg payload", () => {
    const parsed = runJxaScriptInputSchema.parse({
      script: "x",
      arg: { foo: 1, nested: [true, null] },
    });
    expect(parsed.arg).toEqual({ foo: 1, nested: [true, null] });
  });
});

describe("run_jxa_script — handler", () => {
  it("calls adapter.runJxaScript with the script and arg", async () => {
    const runJxaScript = vi.fn(async () => ({ ok: true }));
    const adapter = { runJxaScript } as unknown as OmniFocusAdapter;
    const res = await handleRunJxaScript(
      { script: "function run(){}", arg: { n: 1 } },
      { adapter, makeMeta, logger: { info: vi.fn() } },
    );
    expect(runJxaScript).toHaveBeenCalledWith("function run(){}", { n: 1 });
    expect(res.data.result).toEqual({ ok: true });
    expect(res.meta.syncPending).toBe(true);
  });

  it("audit-logs raw_script.invoked with the full script body", async () => {
    const info = vi.fn();
    const script = "function run(){ return '42'; }";
    const adapter = { runJxaScript: async () => 42 } as unknown as OmniFocusAdapter;
    await handleRunJxaScript({ script }, { adapter, makeMeta, logger: { info } });

    expect(info).toHaveBeenCalledTimes(1);
    const fields = info.mock.calls[0]?.[0];
    expect(fields).toMatchObject({
      event: "raw_script.invoked",
      tool: "run_jxa_script",
      script,
      scriptLength: script.length,
    });
  });

  it("throws ValidationError when the adapter does not expose runJxaScript", async () => {
    const adapter = {} as OmniFocusAdapter;
    await expect(
      handleRunJxaScript({ script: "x" }, { adapter, makeMeta, logger: { info: vi.fn() } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("run_jxa_script — gated registration", () => {
  function ctx(): Parameters<typeof registerRunJxaScriptTool>[1] {
    return {
      adapter: { runJxaScript: async () => null } as unknown as OmniFocusAdapter,
      makeMeta,
      logger: { info: vi.fn() },
    };
  }

  it("does NOT register the tool when allowRawScript=false", () => {
    const server = new McpServer({ name: "t", version: "0" });
    const spy = vi.spyOn(server, "registerTool") as unknown as ReturnType<typeof vi.fn>;
    const handle = registerRunJxaScriptTool(server, ctx(), { allowRawScript: false });
    expect(handle).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers the tool when allowRawScript=true", () => {
    const server = new McpServer({ name: "t", version: "0" });
    const spy = vi.spyOn(server, "registerTool") as unknown as ReturnType<typeof vi.fn>;
    const handle = registerRunJxaScriptTool(server, ctx(), { allowRawScript: true });
    expect(handle).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("run_jxa_script");
  });
});
