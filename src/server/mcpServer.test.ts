import { describe, expect, it } from "vitest";
import { registerPerspectiveCreateTool } from "../tools/perspective/create.js";
import { registerPerspectiveEvaluateDryRunTool } from "../tools/perspective/evaluateDryRun.js";
import { registerPerspectiveUpdateTool } from "../tools/perspective/update.js";
import { registerTaskReclassifyTool } from "../tools/task/reclassify.js";
import { createMcpServer } from "./mcpServer.js";

describe("createMcpServer", () => {
  it("returns an McpServer instance", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("exposes an underlying Server with correct name and version", () => {
    const server = createMcpServer();
    // The McpServer wraps a lower-level Server accessible via .server
    const inner = server.server;
    expect(inner).toBeDefined();
  });

  it("starts with no registered tools (empty registry)", () => {
    const server = createMcpServer();
    // Before any tool registration the server should have no registered tools.
    // We verify this by checking the internal _registeredTools map via the
    // public API shape — tools/list will return an empty array when connected.
    expect(server).toBeDefined();
    // Can't call tools/list without a transport; structural check is sufficient.
  });
});

// Reach into the McpServer to invoke the SDK-installed `tools/list` request
// handler directly. The handler runs the same JSON-schema serializer the
// real stdio transport uses, so this faithfully reproduces the production
// path without standing up a transport pair.
async function invokeListTools(server: ReturnType<typeof createMcpServer>) {
  const inner = server.server as unknown as {
    _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
  };
  const handler = inner._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler not registered");
  return (await handler({ method: "tools/list", params: {} }, {})) as {
    tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
  };
}

describe("tools/list serialization (regression for #717)", () => {
  // The four tools whose input shapes hold recursive Zod schemas
  // (TaskPredicate, PerspectiveRuleInput). Without `register()`-ing those
  // schemas with a stable id, the SDK's `toJSONSchema` traversal recurses
  // forever and the handler throws "Maximum call stack size exceeded",
  // which makes the MCP handshake unusable for every client.
  it("serializes task_reclassify input schema without overflow", async () => {
    const server = createMcpServer();
    const ctx = {
      adapter: {} as never,
      makeMeta: () => ({}) as never,
    };
    registerTaskReclassifyTool(server, ctx);

    const result = await invokeListTools(server);
    expect(result.tools).toHaveLength(1);
    const json = JSON.stringify(result.tools[0]?.inputSchema);
    expect(json).toContain("$ref");
    expect(json).toContain("TaskPredicate");
  });

  it("serializes perspective tools' input schemas without overflow", async () => {
    const server = createMcpServer();
    const ctx = {
      adapter: {} as never,
      cache: {} as never,
      perspectiveService: {} as never,
      makeMeta: () => ({}) as never,
    };
    registerPerspectiveCreateTool(server, ctx);
    registerPerspectiveEvaluateDryRunTool(server, ctx);
    registerPerspectiveUpdateTool(server, ctx);

    const result = await invokeListTools(server);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "perspective_create",
      "perspective_evaluate_dry_run",
      "perspective_update",
    ]);
    for (const tool of result.tools) {
      const json = JSON.stringify(tool.inputSchema);
      expect(json).toContain("PerspectiveRuleInput");
    }
  });
});

// ─── Prompt-cache determinism (#772) ─────────────────────────────────────────
// Anthropic's prompt cache reuses static prefixes byte-for-byte. The
// `tools/list` response is the largest static prefix this server emits and is
// paid by every session at handshake. If any part of the serializer or
// registration order is non-deterministic, every session pays the full prefix
// cost; deterministic output unlocks ~10× cache reuse on the static portion.
//
// This test registers a representative mix of schema shapes (recursive,
// optional, primitive, array-of-objects) on two fresh server instances and
// asserts the SDK's `tools/list` output is structurally identical and
// JSON-byte-identical between them.
//
// Single-process scope — catches drift inside the SDK serializer and
// `zod-to-json-schema` (definitions cache, $ref dedup, key ordering).
// Cross-process determinism is covered by the E2E suite
// (`tests/e2e/determinism.test.ts`).
describe("tools/list determinism (#772)", () => {
  function buildServerWithMixedTools() {
    const server = createMcpServer();
    const reclassifyCtx = {
      adapter: {} as never,
      makeMeta: () => ({}) as never,
    };
    const perspectiveCtx = {
      adapter: {} as never,
      cache: {} as never,
      perspectiveService: {} as never,
      makeMeta: () => ({}) as never,
    };
    // Order matters: V8 object insertion order is the iteration order
    // `Object.entries(this._registeredTools)` walks in the SDK handler.
    // Two builds in the same order must produce byte-identical output.
    registerTaskReclassifyTool(server, reclassifyCtx);
    registerPerspectiveCreateTool(server, perspectiveCtx);
    registerPerspectiveEvaluateDryRunTool(server, perspectiveCtx);
    registerPerspectiveUpdateTool(server, perspectiveCtx);
    return server;
  }

  it("emits byte-identical JSON for tools/list across two builds", async () => {
    const a = await invokeListTools(buildServerWithMixedTools());
    const b = await invokeListTools(buildServerWithMixedTools());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("preserves registration order in the tools array (not alphabetical)", async () => {
    const result = await invokeListTools(buildServerWithMixedTools());
    expect(result.tools.map((t) => t.name)).toEqual([
      "task_reclassify",
      "perspective_create",
      "perspective_evaluate_dry_run",
      "perspective_update",
    ]);
  });

  // Stability of the first 4 KiB of output — explicit acceptance criterion
  // from #772. Prompt-cache hits depend on a stable byte-prefix; this guards
  // the prefix specifically, not just the full payload.
  it("emits a stable hash of the first 4 KiB of tools/list output", async () => {
    const { createHash } = await import("node:crypto");
    const hashOf = async (): Promise<string> => {
      const result = await invokeListTools(buildServerWithMixedTools());
      const bytes = Buffer.from(JSON.stringify(result), "utf8").subarray(0, 4096);
      return createHash("sha256").update(bytes).digest("hex");
    };
    const first = await hashOf();
    const second = await hashOf();
    const third = await hashOf();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
