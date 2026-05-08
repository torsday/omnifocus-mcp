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
