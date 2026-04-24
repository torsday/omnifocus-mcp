/**
 * MCP server bootstrap for omnifocus-mcp.
 *
 * Stands up the server over stdio (ADR-0010) using the high-level McpServer
 * API from @modelcontextprotocol/sdk. Currently registers `internal_status`,
 * the four OmniFocus workflow prompts, the ten MCP resources, and the
 * folder + tag tool surface (16 tools). The remaining tool registrations
 * and per-tool middleware composition arrive in follow-ups under #289 / #291.
 *
 * Signal handlers for SIGINT/SIGTERM delegate to `shutdownController` (#26),
 * which drains in-flight calls, flushes logs, and exits 0.
 *
 * Cold-start target: < 500ms on a warm macOS (DESIGN §17).
 *
 * @see DESIGN.md §17 — lifecycle
 * @see DESIGN.md §28 — MCP resources
 * @see docs/adr/0010-stdio-as-sole-transport.md
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig, redactConfig } from "../config/env.js";
import { logger } from "../logging/logger.js";
import {
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  PROJECT_PLANNING_PROMPT,
  WEEKLY_REVIEW_PROMPT,
  registerOmniFocusPrompts,
} from "../prompts/omnifocus.js";
import {
  CAPABILITIES_URI,
  buildCapabilities,
  registerCapabilitiesResource,
} from "../resources/capabilities.js";
import {
  FLAGGED_URI,
  FORECAST_TODAY_URI,
  INBOX_URI,
  OVERDUE_URI,
  PERSPECTIVE_URI_TEMPLATE,
  PROJECT_URI_TEMPLATE,
  REVIEW_DUE_URI,
  SNAPSHOT_URI,
  TAG_URI_TEMPLATE,
  registerOmniFocusResources,
} from "../resources/omnifocus.js";
import { registerFolderCreateTool } from "../tools/folder/create.js";
import { registerFolderDeleteTool } from "../tools/folder/delete.js";
import { registerFolderGetTool } from "../tools/folder/get.js";
import { registerFolderListTool } from "../tools/folder/list.js";
import { registerFolderMoveTool } from "../tools/folder/move.js";
import { registerFolderUpdateTool } from "../tools/folder/update.js";
import { registerInternalStatusTool } from "../tools/observability/internalStatus.js";
import { registerTagCreateTool } from "../tools/tag/create.js";
import { registerTagDeleteTool } from "../tools/tag/delete.js";
import { registerTagGetTool } from "../tools/tag/get.js";
import { registerTagGetLocationTool } from "../tools/tag/getLocation.js";
import { registerTagListTool } from "../tools/tag/list.js";
import { registerTagMoveTool } from "../tools/tag/move.js";
import { registerTagSetAllowsNextActionTool } from "../tools/tag/setAllowsNextAction.js";
import { registerTagSetLocationTool } from "../tools/tag/setLocation.js";
import { registerTagSetStatusTool } from "../tools/tag/setStatus.js";
import { registerTagUpdateTool } from "../tools/tag/update.js";
import { circuitBreakerRegistry } from "./circuitBreaker.js";
import { composeAdapter, composeServices, makeMeta } from "./composition.js";
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

  // Compose the live adapter chain (JxaTransport + OmniJsTransport →
  // TransportRouter) and the full service bundle. Cache wrapping at the
  // adapter layer (#22) arrives in a follow-up; per-tool middleware
  // composition (#291) wraps individual handlers.
  const adapter = composeAdapter(config);
  const services = composeServices(adapter, config);

  // Register internal_status tool.
  registerInternalStatusTool(server, {
    startedAt,
    adapter,
    circuitRegistry: circuitBreakerRegistry,
    makeMeta,
  });

  // Register MCP prompts (DESIGN §29) — four workflow templates.
  registerOmniFocusPrompts(server);

  // Register the ten MCP resources (DESIGN §28).
  registerCapabilitiesResource(server, () => buildCapabilities(config));
  registerOmniFocusResources(server, {
    adapter,
    projectService: services.projectService,
    reviewService: services.reviewService,
    forecastService: services.forecastService,
    perspectiveService: services.perspectiveService,
  });

  // Folder tools — six uniform `{folderService, makeMeta}` registrations.
  const folderCtx = { folderService: services.folderService, makeMeta };
  registerFolderCreateTool(server, folderCtx);
  registerFolderDeleteTool(server, folderCtx);
  registerFolderGetTool(server, folderCtx);
  registerFolderListTool(server, folderCtx);
  registerFolderMoveTool(server, folderCtx);
  registerFolderUpdateTool(server, folderCtx);

  // Tag tools — ten uniform `{tagService, makeMeta}` registrations.
  const tagCtx = { tagService: services.tagService, makeMeta };
  registerTagCreateTool(server, tagCtx);
  registerTagDeleteTool(server, tagCtx);
  registerTagGetTool(server, tagCtx);
  registerTagGetLocationTool(server, tagCtx);
  registerTagListTool(server, tagCtx);
  registerTagMoveTool(server, tagCtx);
  registerTagSetAllowsNextActionTool(server, tagCtx);
  registerTagSetLocationTool(server, tagCtx);
  registerTagSetStatusTool(server, tagCtx);
  registerTagUpdateTool(server, tagCtx);

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
      tools: [
        "internal_status",
        "folder_create",
        "folder_delete",
        "folder_get",
        "folder_list",
        "folder_move",
        "folder_update",
        "tag_create",
        "tag_delete",
        "tag_get",
        "tag_get_location",
        "tag_list",
        "tag_move",
        "tag_set_allows_next_action",
        "tag_set_location",
        "tag_set_status",
        "tag_update",
      ],
      prompts: [
        DAILY_REVIEW_PROMPT,
        WEEKLY_REVIEW_PROMPT,
        CAPTURE_MEETING_PROMPT,
        PROJECT_PLANNING_PROMPT,
      ],
      resources: [
        CAPABILITIES_URI,
        SNAPSHOT_URI,
        INBOX_URI,
        FORECAST_TODAY_URI,
        OVERDUE_URI,
        FLAGGED_URI,
        REVIEW_DUE_URI,
        PROJECT_URI_TEMPLATE,
        TAG_URI_TEMPLATE,
        PERSPECTIVE_URI_TEMPLATE,
      ],
    },
    "server started",
  );
}
