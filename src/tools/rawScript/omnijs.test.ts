/**
 * Tests for `run_omnijs_script` raw escape-hatch tool.
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
import {
  handleRunOmniJsScript,
  registerRunOmniJsScriptTool,
  runOmniJsScriptInputSchema,
} from "./omnijs.js";

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test",
    durationMs: 1,
    cacheHit: false,
    transport: "omnijs",
    ofVersion: "test",
    ...partial,
  };
}

describe("run_omnijs_script — input schema", () => {
  it("requires a non-empty script", () => {
    expect(runOmniJsScriptInputSchema.safeParse({}).success).toBe(false);
    expect(runOmniJsScriptInputSchema.safeParse({ script: "" }).success).toBe(false);
    expect(runOmniJsScriptInputSchema.safeParse({ script: "Task.all.length" }).success).toBe(true);
  });

  it("accepts an arbitrary arg payload", () => {
    const parsed = runOmniJsScriptInputSchema.parse({ script: "x", arg: [1, 2, 3] });
    expect(parsed.arg).toEqual([1, 2, 3]);
  });
});

describe("run_omnijs_script — handler", () => {
  it("calls adapter.runOmniJsScript with the script and arg", async () => {
    const runOmniJsScript = vi.fn(async () => "ok");
    const adapter = { runOmniJsScript } as unknown as OmniFocusAdapter;
    const res = await handleRunOmniJsScript(
      { script: "Task.all.length", arg: { k: "v" } },
      { adapter, makeMeta, logger: { info: vi.fn() } },
    );
    expect(runOmniJsScript).toHaveBeenCalledWith("Task.all.length", { k: "v" });
    expect(res.data.result).toBe("ok");
    expect(res.meta.syncPending).toBe(true);
  });

  it("audit-logs raw_script.invoked with the full script body", async () => {
    const info = vi.fn();
    const script = "Task.all.length";
    const adapter = { runOmniJsScript: async () => 0 } as unknown as OmniFocusAdapter;
    await handleRunOmniJsScript({ script }, { adapter, makeMeta, logger: { info } });
    const [fields] = info.mock.calls[0];
    expect(fields).toMatchObject({
      event: "raw_script.invoked",
      tool: "run_omnijs_script",
      script,
      scriptLength: script.length,
    });
  });

  it("throws ValidationError when the adapter does not expose runOmniJsScript", async () => {
    const adapter = {} as OmniFocusAdapter;
    await expect(
      handleRunOmniJsScript({ script: "x" }, { adapter, makeMeta, logger: { info: vi.fn() } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("run_omnijs_script — gated registration", () => {
  function ctx(): Parameters<typeof registerRunOmniJsScriptTool>[1] {
    return {
      adapter: { runOmniJsScript: async () => null } as unknown as OmniFocusAdapter,
      makeMeta,
      logger: { info: vi.fn() },
    };
  }

  it("does NOT register the tool when allowRawScript=false", () => {
    const server = new McpServer({ name: "t", version: "0" });
    const spy = vi.spyOn(server, "registerTool") as unknown as ReturnType<typeof vi.fn>;
    const handle = registerRunOmniJsScriptTool(server, ctx(), { allowRawScript: false });
    expect(handle).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers the tool when allowRawScript=true", () => {
    const server = new McpServer({ name: "t", version: "0" });
    const spy = vi.spyOn(server, "registerTool") as unknown as ReturnType<typeof vi.fn>;
    const handle = registerRunOmniJsScriptTool(server, ctx(), { allowRawScript: true });
    expect(handle).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("run_omnijs_script");
  });
});
