/**
 * MCP server bootstrap for omnifocus-mcp.
 *
 * Stands up the server over stdio (ADR-0010) using the high-level McpServer
 * API from @modelcontextprotocol/sdk. Currently registers the
 * `internal_status` tool and the four OmniFocus workflow prompts; the full
 * tool surface, MCP resources, and per-tool middleware composition arrive in
 * follow-ups under #278.
 *
 * Signal handlers for SIGINT/SIGTERM delegate to `shutdownController` (#26),
 * which drains in-flight calls, flushes logs, and exits 0.
 *
 * Cold-start target: < 500ms on a warm macOS (DESIGN §17).
 *
 * @see DESIGN.md §17 — lifecycle
 * @see docs/adr/0010-stdio-as-sole-transport.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { parseConfig, redactConfig } from "../config/env.js";
import type { ResponseMeta } from "../envelope/index.js";
import { logger } from "../logging/logger.js";
import {
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  PROJECT_PLANNING_PROMPT,
  WEEKLY_REVIEW_PROMPT,
  registerOmniFocusPrompts,
} from "../prompts/omnifocus.js";
import { registerInternalStatusTool } from "../tools/observability/internalStatus.js";
import { circuitBreakerRegistry } from "./circuitBreaker.js";
import { shutdownController } from "./shutdown.js";
import { installStdoutGuard } from "./stdoutGuard.js";

const PACKAGE_VERSION = "0.0.1";
const SERVER_NAME = "omnifocus-mcp";

/** Timestamp (ms) captured at module load — used for uptime reporting. */
const startedAt = Date.now();

/**
 * Create and return an unconnected McpServer instance.
 * Separated from `startServer` so tests can inspect the server without
 * launching stdio transport.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: PACKAGE_VERSION,
  });
  return server;
}

/**
 * Boot the MCP server over stdio, parse config, wire signal handlers,
 * and emit the `server.started` event. Never returns while the server
 * is running.
 *
 * Unhandled exceptions log at `fatal` and exit 1 (DESIGN §17).
 */
export async function startServer(): Promise<void> {
  // Guard stdout before anything else — a stray write before connect would
  // corrupt the MCP framing.
  installStdoutGuard();

  const config = parseConfig();

  // Apply validated log level before the first structured log event.
  logger.level = config.OMNIFOCUS_LOG_LEVEL;

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Register internal_status tool.
  // Uses InMemoryAdapter for getLastSync until the real adapter is wired (M1+).
  const internalStatusAdapter = new InMemoryAdapter();
  registerInternalStatusTool(server, {
    startedAt,
    adapter: internalStatusAdapter,
    circuitRegistry: circuitBreakerRegistry,
    makeMeta: (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
      correlationId: `internal-${Date.now()}`,
      durationMs: 0,
      cacheHit: false,
      transport: "memory",
      ofVersion: "unknown",
      ...partial,
    }),
  });

  // Register MCP prompts (DESIGN §29) — four workflow templates: daily-review,
  // weekly-review, capture-meeting, project-planning. Prompts are pure
  // templates with no runtime dependencies, so they wire in without an
  // adapter or service chain.
  registerOmniFocusPrompts(server);

  // Graceful shutdown — delegate to shutdownController so tool handlers can
  // call assertNotShuttingDown() and in-flight queues drain cleanly.
  process.on("SIGINT", () => {
    void shutdownController.initiate("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdownController.initiate("SIGTERM");
  });

  // Unhandled rejection / exception: log fatal and exit 1 (DESIGN §17).
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ event: "server.unhandled_rejection", reason }, "unhandled rejection");
    logger.flush();
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ event: "server.uncaught_exception", err }, "uncaught exception");
    logger.flush();
    process.exit(1);
  });

  await server.connect(transport);

  logger.info(
    {
      event: "server.started",
      version: PACKAGE_VERSION,
      config: redactConfig(config),
      tools: ["internal_status"],
      prompts: [
        DAILY_REVIEW_PROMPT,
        WEEKLY_REVIEW_PROMPT,
        CAPTURE_MEETING_PROMPT,
        PROJECT_PLANNING_PROMPT,
      ],
    },
    "server started",
  );
}
