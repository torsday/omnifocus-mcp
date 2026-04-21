/**
 * MCP server bootstrap for omnifocus-mcp.
 *
 * Stands up the server over stdio (ADR-0010) using the high-level McpServer
 * API from @modelcontextprotocol/sdk. No tools are registered here — they
 * arrive from per-noun registrations in M1+.
 *
 * Signal handlers for SIGINT/SIGTERM initiate graceful shutdown (#26). Until
 * that issue lands, we do a best-effort close and exit.
 *
 * Cold-start target: < 500ms on a warm macOS (DESIGN §17).
 *
 * @see DESIGN.md §17 — lifecycle
 * @see docs/adr/0010-stdio-as-sole-transport.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig, redactConfig } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { installStdoutGuard } from "./stdoutGuard.js";

const PACKAGE_VERSION = "0.0.1";
const SERVER_NAME = "omnifocus-mcp";

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

  // Graceful shutdown — full implementation lands in #26.
  const shutdown = async (reason: string) => {
    logger.info({ event: "server.shutdown", reason, graceMs: 0 }, "shutting down");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);

  logger.info(
    {
      event: "server.started",
      version: PACKAGE_VERSION,
      config: redactConfig(config),
      tools: [],
    },
    "server started",
  );
}
