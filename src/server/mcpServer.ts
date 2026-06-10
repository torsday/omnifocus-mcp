/**
 * MCP server bootstrap for omnifocus-mcp.
 *
 * Stands up the server over stdio (ADR-0010) using the high-level McpServer
 * API from @modelcontextprotocol/sdk. Currently registers `internal_status`,
 * the five OmniFocus workflow prompts, the thirteen MCP resources, and 79 domain
 * tools across folder, tag, note, search, forecast, perspective, plugin,
 * sync, review, export, app, project, task, repetition, attachment, and
 * database surfaces. Two additional raw-script escape-hatch tools
 * (`run_jxa_script`, `run_omnijs_script`) register only when
 * `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` (ADR-0004), bringing the wired surface to 81.
 * Every registered tool is
 * wrapped in `assertNotShuttingDown → withCircuitBreaker → withRateLimitMeta
 * → withLoopDetection` via `installToolMiddleware` (#291), which runs once
 * before any `register*Tool` helper.
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
// Read version from package.json so the value the server announces in
// `initialize` and `server.started` always matches the published artifact.
// `resolveJsonModule` in tsconfig and tsup's bundler both inline the JSON,
// so this stays a compile-time constant — no runtime fs read.
import packageJson from "../../package.json" with { type: "json" };
import { RESPONSIVENESS_PROBE_SCRIPT } from "../adapter/_shared/busyProbe.js";
import { killActiveChildren } from "../adapter/_shared/childRegistry.js";
import { configureRetryPolicy } from "../adapter/_shared/retryPolicy.js";
import { getSpawnFloorMs } from "../adapter/_shared/spawnFloor.js";
import { configureTransportCircuits } from "../adapter/_shared/transportCircuit.js";
import { wrapWithConcurrency } from "../adapter/concurrent.js";
import {
  disposePersistentJxa,
  getPersistentTransportStats,
} from "../adapter/jxa/persistentScriptRunner.js";
import { configurePersistentJxa, runJxaScript } from "../adapter/jxa/scriptRunner.js";
import { ReadPool } from "../concurrency/ReadPool.js";
import { WriteQueue } from "../concurrency/WriteQueue.js";
import { parseConfig, redactConfig } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { onTransportBusy, onTransportCall, onTransportRetry } from "../logging/transportCall.js";
import { LoopDetector } from "../loopDetector/LoopDetector.js";
import { LatencyStatsRegistry } from "../observability/latencyStats.js";
import { ResponseStatsRegistry } from "../observability/responseStats.js";
import { buildTelemetrySink } from "../observability/telemetrySink.js";
import { ToolDurationStatsRegistry } from "../observability/toolDurationStats.js";
import {
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  PROJECT_PLANNING_PROMPT,
  registerOmniFocusPrompts,
  WEEKLY_REVIEW_PROMPT,
} from "../prompts/omnifocus.js";
import { ToolRateLimiter } from "../rateLimit/ToolRateLimiter.js";
import {
  buildCapabilities,
  CAPABILITIES_URI,
  probeCalendarAccess,
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
  registerOmniFocusResources,
  SNAPSHOT_URI,
  TAG_URI_TEMPLATE,
} from "../resources/omnifocus.js";
import { replayStore } from "../state/replayStore.js";
import { negotiateDensityFromCapabilities } from "../state/sessionState.js";
import { ALL_TOOL_DESCRIPTIONS } from "../tools/allDescriptions.js";
import { registerAppLaunchTool } from "../tools/app/launch.js";
import { registerAttachmentTools } from "../tools/attachment/index.js";
import { registerClarifyTool } from "../tools/clarify.js";
import { registerDatabaseRedoTool } from "../tools/database/redo.js";
import { registerDatabaseUndoTool } from "../tools/database/undo.js";
import { registerDecisionClearTool } from "../tools/decision/clear.js";
import { registerDecisionRecordTool } from "../tools/decision/record.js";
import { registerExportOpmlTool } from "../tools/export/opml.js";
import { registerImportOpmlTool } from "../tools/export/opml_import.js";
import { registerTaskPaperTools } from "../tools/export/taskpaper.js";
import { registerFolderCreateTool } from "../tools/folder/create.js";
import { registerFolderCreateDescribeTool } from "../tools/folder/createDescribe.js";
import { registerFolderDeleteTool } from "../tools/folder/delete.js";
import { registerFolderDeleteDescribeTool } from "../tools/folder/deleteDescribe.js";
import { registerFolderGetTool } from "../tools/folder/get.js";
import { registerFolderListTool } from "../tools/folder/list.js";
import { registerFolderMoveTool } from "../tools/folder/move.js";
import { registerFolderMoveDescribeTool } from "../tools/folder/moveDescribe.js";
import { registerFolderUpdateTool } from "../tools/folder/update.js";
import { registerFolderUpdateDescribeTool } from "../tools/folder/updateDescribe.js";
import { registerForecastGetTool } from "../tools/forecast/get.js";
import { registerForecastGetTagTool } from "../tools/forecast/get_tag.js";
import { registerForecastPackTool } from "../tools/forecast/pack.js";
import { registerForecastSetTagTool } from "../tools/forecast/set_tag.js";
import { registerOmnifocusDoctorTool } from "../tools/lifecycle/doctor.js";
import { registerNoteAppendTool } from "../tools/note/append.js";
import { registerNoteGetTool } from "../tools/note/get.js";
import { registerNoteGetHtmlTool } from "../tools/note/get_html.js";
import { registerNoteSetTool } from "../tools/note/set.js";
import { registerNoteSetHtmlTool } from "../tools/note/set_html.js";
import { registerInternalStatusTool } from "../tools/observability/internalStatus.js";
import { registerPerspectiveCreateTool } from "../tools/perspective/create.js";
import { registerPerspectiveDeleteTool } from "../tools/perspective/delete.js";
import { registerPerspectiveEvaluateTool } from "../tools/perspective/evaluate.js";
import { registerPerspectiveEvaluateDryRunTool } from "../tools/perspective/evaluateDryRun.js";
import { registerPerspectiveGetTool } from "../tools/perspective/get.js";
import { registerPerspectiveListTool } from "../tools/perspective/list.js";
import { registerPerspectiveUpdateTool } from "../tools/perspective/update.js";
import { registerPluginInvokeTool } from "../tools/plugin/invoke.js";
import { registerProjectBatchCompleteTool } from "../tools/project/batchComplete.js";
import { registerProjectBatchDropTool } from "../tools/project/batchDrop.js";
import { registerProjectCompleteTool } from "../tools/project/complete.js";
import { registerProjectCompleteDescribeTool } from "../tools/project/completeDescribe.js";
import { registerProjectCreateTool } from "../tools/project/create.js";
import { registerProjectCreateDescribeTool } from "../tools/project/createDescribe.js";
import { registerProjectDeleteTool } from "../tools/project/delete.js";
import { registerProjectDeleteDescribeTool } from "../tools/project/deleteDescribe.js";
import { registerProjectDropTool } from "../tools/project/drop.js";
import { registerProjectDropDescribeTool } from "../tools/project/dropDescribe.js";
import { registerProjectGetTool } from "../tools/project/get.js";
import { registerProjectGetManyTool } from "../tools/project/getMany.js";
import { registerProjectListTool } from "../tools/project/list.js";
import { registerProjectMoveTool } from "../tools/project/move.js";
import { registerProjectMoveDescribeTool } from "../tools/project/moveDescribe.js";
import { registerProjectTemplateDeleteTool } from "../tools/project/templateDelete.js";
import { registerProjectTemplateInstantiateTool } from "../tools/project/templateInstantiate.js";
import { registerProjectTemplateListTool } from "../tools/project/templateList.js";
import { registerProjectTemplateSaveTool } from "../tools/project/templateSave.js";
import { registerProjectUpdateTool } from "../tools/project/update.js";
import { registerProjectUpdateDescribeTool } from "../tools/project/updateDescribe.js";
import { registerRunJxaScriptTool } from "../tools/rawScript/jxa.js";
import { registerRunOmniJsScriptTool } from "../tools/rawScript/omnijs.js";
import { registerRepetitionFromProseTool } from "../tools/repetition/fromProse.js";
import { registerReviewListDueTool } from "../tools/review/listDue.js";
import { registerReviewMarkReviewedTool } from "../tools/review/markReviewed.js";
import { registerProjectMarkReviewedTool } from "../tools/review/projectMarkReviewed.js";
import { registerReviewSetIntervalTool } from "../tools/review/setInterval.js";
import { registerProjectSetNextReviewDateTool } from "../tools/review/setNextReviewDate.js";
import { registerSearchQueryTool } from "../tools/search/query.js";
import { registerChangesSinceTool } from "../tools/sync/changesSince.js";
import { registerSyncStatusTool } from "../tools/sync/status.js";
import { registerSyncTriggerTool } from "../tools/sync/trigger.js";
import { registerTagCreateTool } from "../tools/tag/create.js";
import { registerTagCreateDescribeTool } from "../tools/tag/createDescribe.js";
import { registerTagDeleteTool } from "../tools/tag/delete.js";
import { registerTagDeleteDescribeTool } from "../tools/tag/deleteDescribe.js";
import { registerTagGetTool } from "../tools/tag/get.js";
import { registerTagGetLocationTool } from "../tools/tag/getLocation.js";
import { registerTagGetManyTool } from "../tools/tag/getMany.js";
import { registerTagListTool } from "../tools/tag/list.js";
import { registerTagMoveTool } from "../tools/tag/move.js";
import { registerTagMoveDescribeTool } from "../tools/tag/moveDescribe.js";
import { registerTagSetAllowsNextActionTool } from "../tools/tag/setAllowsNextAction.js";
import { registerTagSetLocationTool } from "../tools/tag/setLocation.js";
import { registerTagSetStatusTool } from "../tools/tag/setStatus.js";
import { registerTagUpdateTool } from "../tools/tag/update.js";
import { registerTagUpdateDescribeTool } from "../tools/tag/updateDescribe.js";
import { registerTaskBatchAssignTool } from "../tools/task/batchAssign.js";
import { registerTaskBatchCompleteTool } from "../tools/task/batchComplete.js";
import { registerTaskBatchCreateTool } from "../tools/task/batchCreate.js";
import { registerTaskBatchCreateDescribeTool } from "../tools/task/batchCreateDescribe.js";
import { registerTaskBatchDeferSmartTool } from "../tools/task/batchDeferSmart.js";
import { registerTaskBatchDeleteTool } from "../tools/task/batchDelete.js";
import { registerTaskBatchDropTool } from "../tools/task/batchDrop.js";
import { registerTaskBatchMoveTool } from "../tools/task/batchMove.js";
import { registerTaskBatchUncompleteTool } from "../tools/task/batchUncomplete.js";
import { registerTaskBatchUndropTool } from "../tools/task/batchUndrop.js";
import { registerTaskBatchUpdateTool } from "../tools/task/batchUpdate.js";
import { registerTaskBatchUpdateDescribeTool } from "../tools/task/batchUpdateDescribe.js";
import { registerTaskClearAlarmsTool } from "../tools/task/clearAlarms.js";
import { registerTaskClearRepetitionTool } from "../tools/task/clearRepetition.js";
import { registerTaskCompleteTool } from "../tools/task/complete.js";
import { registerTaskCompleteDescribeTool } from "../tools/task/completeDescribe.js";
import { registerTaskConvertToProjectTool } from "../tools/task/convertToProject.js";
import { registerTaskCreateTool } from "../tools/task/create.js";
import { registerTaskCreateDescribeTool } from "../tools/task/createDescribe.js";
import { registerTaskDeferSmartTool } from "../tools/task/deferSmart.js";
import { registerTaskDeleteTool } from "../tools/task/delete.js";
import { registerTaskDeleteDescribeTool } from "../tools/task/deleteDescribe.js";
import { registerTaskDropTool } from "../tools/task/drop.js";
import { registerTaskDropDescribeTool } from "../tools/task/dropDescribe.js";
import { registerTaskDuplicateTool } from "../tools/task/duplicate.js";
import { registerTaskExtractFromImageTool } from "../tools/task/extractFromImage.js";
import { registerTaskExtractFromNoteTool } from "../tools/task/extractFromNote.js";
import { registerTaskFindByNameTool } from "../tools/task/findByName.js";
import { registerTaskFindSimilarTool } from "../tools/task/findSimilar.js";
import { registerTaskGetTool } from "../tools/task/get.js";
import { registerTaskGetManyTool } from "../tools/task/getMany.js";
import { registerTaskListTool } from "../tools/task/list.js";
import { registerTaskMoveTool } from "../tools/task/move.js";
import { registerTaskMoveDescribeTool } from "../tools/task/moveDescribe.js";
import { registerTaskParseTransportTextTool } from "../tools/task/parseTransportText.js";
import { registerTaskReclassifyTool } from "../tools/task/reclassify.js";
import { registerTaskReorderTool } from "../tools/task/reorder.js";
import { registerTaskSearchTool } from "../tools/task/search.js";
import { registerTaskSetAlarmsTool } from "../tools/task/setAlarms.js";
import { registerTaskSetRepetitionTool } from "../tools/task/setRepetition.js";
import { registerTaskUncompleteTool } from "../tools/task/uncomplete.js";
import { registerTaskUndropTool } from "../tools/task/undrop.js";
import { registerTaskUpdateTool } from "../tools/task/update.js";
import { registerTaskUpdateDescribeTool } from "../tools/task/updateDescribe.js";
import {
  registerTaskClearWaitingOnTool,
  registerTaskSetWaitingOnTool,
} from "../tools/task/waitingOn.js";
import { registerWebhookDeleteTool } from "../tools/webhook/delete.js";
import { registerWebhookListTool } from "../tools/webhook/list.js";
import { registerWebhookRegisterTool } from "../tools/webhook/register.js";
import { registerWebhookTestTool } from "../tools/webhook/test.js";
import {
  registerAppWindowNewTabTool,
  registerAppWindowNewTool,
  registerWindowGetStateTool,
  registerWindowSetFocusTool,
  registerWindowSetPerspectiveTool,
} from "../tools/window/index.js";
import { DatabaseWatcher } from "../watcher/DatabaseWatcher.js";
import { HttpsDispatcher } from "../webhooks/httpsDispatcher.js";
import { WebhookOrchestrator } from "../webhooks/orchestrator.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { circuitBreakerRegistry } from "./circuitBreaker.js";
import {
  composeAdapter,
  composeServices,
  makeDatabaseChangeHandler,
  makeMeta,
} from "./composition.js";
import { idempotencyStore } from "./idempotencyStore.js";
import { installToolMiddleware } from "./middleware.js";
import { shutdownController } from "./shutdown.js";
import { installStdoutGuard } from "./stdoutGuard.js";

const PACKAGE_VERSION = packageJson.version;
const SERVER_NAME = packageJson.name.split("/").pop() ?? "omnifocus-mcp";

/**
 * Tool names that only register when OMNIFOCUS_ALLOW_RAW_SCRIPT is set
 * (ADR-0004). Filtered out of the `server.started` manifest unless
 * actually registered, so the log accurately reflects the live surface.
 */
const RAW_SCRIPT_TOOLS = new Set(["run_jxa_script", "run_omnijs_script"]);

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

  // #818: negotiate session-wide response density from the client's
  // `initialize` capabilities. With stdio as the sole transport (ADR-0010)
  // there is one connection per process, so the negotiated value lives in a
  // process singleton. Unknown/absent → "default" (behavior unchanged).
  server.server.oninitialized = () => {
    const caps = server.server.getClientCapabilities();
    const negotiated = negotiateDensityFromCapabilities(
      caps?.experimental as Record<string, unknown> | undefined,
    );
    logger.info({ density: negotiated }, "session density negotiated");
  };

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

  // Apply the JXA retry-once policy (#816). Done before any tool registration
  // so the very first invocation respects the configured policy.
  configureRetryPolicy({
    enabled: config.OMNIFOCUS_TRANSIENT_RETRY_ENABLED,
    delayMs: config.OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS,
  });

  // Apply the transport-level circuit-breaker policy (#835). Done at boot
  // so the breakers exist before the first script call; the runners reach
  // for the module-level instance.
  configureTransportCircuits({
    enabled: config.OMNIFOCUS_CIRCUIT_ENABLED,
    threshold: config.OMNIFOCUS_CIRCUIT_THRESHOLD,
    recoveryMs: config.OMNIFOCUS_CIRCUIT_RECOVERY_MS,
    logger,
  });

  // Select the persistent osascript transport when enabled (#882). Off by
  // default; the one-shot path stays the default until a field soak proves it.
  configurePersistentJxa(config.OMNIFOCUS_PERSISTENT_OSASCRIPT);

  const server = createMcpServer();

  // Install per-tool middleware (#291) BEFORE any register* helper runs so
  // every tool gets wrapped through:
  //   assertNotShuttingDown → withCircuitBreaker → withRateLimitMeta → withLoopDetection
  // Singletons live for the lifetime of the server: the rate limiter shares
  // its sliding window across calls, the loop detector its dedup keys, and
  // the circuit-breaker registry already holds per-tool state.
  const rateLimiter = new ToolRateLimiter(config.OMNIFOCUS_TOOL_RATE_LIMIT);
  const loopDetector = new LoopDetector({ maxKeys: config.OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS });
  const responseStats = new ResponseStatsRegistry({
    sampleRate: config.OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE,
    thresholdBytes: config.OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES,
    logger,
  });
  // Transport latency telemetry (#940). Subscribed to `transport.call`
  // events at composition time so the script runners stay free of
  // observability dependencies. When the sample rate is 0 (production
  // default) the registry's `record` short-circuits and the listener is
  // effectively a no-op.
  const latencyStats = new LatencyStatsRegistry({
    sampleRate: config.OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE,
    thresholdMs: config.OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS,
    logger,
    getSpawnFloorMs: () => getSpawnFloorMs() ?? null,
  });
  onTransportCall((event) => {
    latencyStats.record({
      transport: event.transport,
      scriptName: event.scriptName,
      durationMs: event.durationMs,
      ...(event.scriptMs !== undefined ? { scriptMs: event.scriptMs } : {}),
    });
  });
  // Per-tool middleware-layer duration telemetry (#798). Recorded
  // alongside response-byte telemetry from the same patch point. When the
  // sample rate is 0 (production default) `record` short-circuits.
  const toolDurationStats = new ToolDurationStatsRegistry({
    sampleRate: config.OMNIFOCUS_DURATION_STATS_SAMPLE_RATE,
    thresholdMs: config.OMNIFOCUS_DURATION_STATS_THRESHOLD_MS,
    logger,
  });
  installToolMiddleware(server, {
    rateLimiter,
    loopDetector,
    circuitRegistry: circuitBreakerRegistry,
    shutdown: shutdownController,
    responseStats,
    toolDurationStats,
  });

  const transport = new StdioServerTransport();

  // Compose the live adapter chain (JxaTransport + OmniJsTransport →
  // TransportRouter) and front it with the concurrency primitives from
  // ADR-0009 / DESIGN §16: a ReadPool for non-mutating JXA reads, a
  // single-slot WriteQueue for JXA mutations, and a separate single-slot
  // queue for OmniJS calls. Every adapter call from this point on goes
  // through one of those three gates — `wrapWithConcurrency` decides per
  // method (#376). Each queue is registered with the shutdown controller
  // so SIGINT/SIGTERM drain in-flight calls before exit (DESIGN §17).
  const router = composeAdapter(config);
  const readPool = new ReadPool({ size: config.OMNIFOCUS_READ_POOL_SIZE, name: "jxa-read" });
  const jxaWriteQueue = new WriteQueue({
    cap: config.OMNIFOCUS_WRITE_QUEUE_CAP,
    name: "jxa-write",
  });
  const omniJsQueue = new WriteQueue({
    cap: config.OMNIFOCUS_WRITE_QUEUE_CAP,
    name: "omnijs",
  });
  shutdownController.registerQueue(readPool);
  shutdownController.registerQueue(jxaWriteQueue);
  shutdownController.registerQueue(omniJsQueue);
  // After the queues drain, gracefully close the persistent osascript child
  // (#882) — stdin EOF, then SIGTERM → 1s grace → SIGKILL. Runs before the
  // orphan sweep so a clean exit is attempted first; no-op when the persistent
  // transport was never started (one-shot default).
  shutdownController.registerCleanup("persistent-osascript", async () => {
    await disposePersistentJxa();
  });
  // Then kill any one-shot osascript child still in flight so it can't outlive
  // the server and keep OmniFocus locked across a restart (#839). Idempotent —
  // the persistent child is already gone by here (pruned from the registry).
  shutdownController.registerCleanup("osascript-children", async () => {
    await killActiveChildren();
  });
  const adapter = wrapWithConcurrency(router, { readPool, jxaWriteQueue, omniJsQueue });
  const services = composeServices(adapter, config);

  // Opt-in JSONL telemetry sink (#823). Constructed only when
  // OMNIFOCUS_TELEMETRY_SINK_PATH is set; otherwise `buildTelemetrySink`
  // returns undefined and no subscribers are wired (zero overhead). When
  // enabled, it durably exports the same observability events the in-process
  // registries see — transport.call, transport.retry, of.busy.detected,
  // cache.invalidated — plus a throttled response-stats sample piggybacked on
  // transport.call (no separate timer). Subscriber callbacks are best-effort
  // (the sink's record() never throws), so a failing sink can't break a call.
  const telemetrySink = buildTelemetrySink({
    path: config.OMNIFOCUS_TELEMETRY_SINK_PATH,
    maxBytes: config.OMNIFOCUS_TELEMETRY_SINK_MAX_BYTES,
  });
  if (telemetrySink !== undefined) {
    const SAMPLE_INTERVAL_MS = 60_000;
    let lastResponseSampleAt = 0;
    onTransportCall((event) => {
      telemetrySink.record({ event: "transport.call", ...event });
      // Piggyback a periodic response-stats snapshot (#823 "response stats
      // sample") off transport.call traffic rather than a dedicated timer.
      const nowMs = Date.now();
      if (
        config.OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE > 0 &&
        nowMs - lastResponseSampleAt >= SAMPLE_INTERVAL_MS
      ) {
        lastResponseSampleAt = nowMs;
        telemetrySink.record({ event: "response.stats.sample", ...responseStats.snapshot() });
      }
    });
    onTransportRetry((event) => telemetrySink.record({ event: "transport.retry", ...event }));
    onTransportBusy((event) => telemetrySink.record({ event: "of.busy.detected", ...event }));
    services.cache.on("cache.invalidated", (payload: Record<string, unknown>) => {
      telemetrySink.record({ event: "cache.invalidated", ...payload });
    });
    // Flush remaining buffered events on clean shutdown (DESIGN §17).
    shutdownController.registerCleanup("telemetry-sink", async () => {
      telemetrySink.close();
    });
    logger.info(
      { event: "telemetry.sink.enabled", maxBytes: config.OMNIFOCUS_TELEMETRY_SINK_MAX_BYTES },
      "telemetry sink enabled — appending observability events as JSONL",
    );
  }

  // Register internal_status tool.
  registerInternalStatusTool(server, {
    startedAt,
    adapter,
    circuitRegistry: circuitBreakerRegistry,
    makeMeta,
    probeResponseStats: () =>
      config.OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE > 0 ? responseStats.snapshot() : null,
    probeLatencyStats: () =>
      config.OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE > 0 ? latencyStats.snapshot() : null,
    probeToolDurationStats: () =>
      config.OMNIFOCUS_DURATION_STATS_SAMPLE_RATE > 0 ? toolDurationStats.snapshot() : null,
    probeCache: () => {
      const s = services.cache.stats();
      return { ...s, services: services.cache.serviceStats() };
    },
    probeStores: () => ({
      idempotencyEntries: idempotencyStore.size,
      loopDetectorKeys: loopDetector.size,
    }),
    probeTransportStats: () => getPersistentTransportStats(),
    // Total pending work across the read pool + both write queues (#1108).
    // In-process counters only — preserves internal_status's no-JXA contract.
    probeQueueDepth: () =>
      readPool.pendingCount() + jxaWriteQueue.pendingCount() + omniJsQueue.pendingCount(),
  });

  // Register MCP prompts (DESIGN §29) — four workflow templates.
  registerOmniFocusPrompts(server);

  // Webhook subsystem (per ADR-0016, #483 slice 1). The registry initializes
  // unconditionally so `webhooks://capabilities` reads work and `webhook_list`
  // reflects the on-disk state even when the subsystem is disabled. Mutation
  // tools enforce the env gate at handler entry.
  const webhookRegistry = new WebhookRegistry();
  const webhookCtx = {
    registry: webhookRegistry,
    enabled: config.OMNIFOCUS_WEBHOOKS_ENABLED,
    makeMeta,
  };
  registerWebhookRegisterTool(server, webhookCtx);
  registerWebhookListTool(server, webhookCtx);
  registerWebhookDeleteTool(server, webhookCtx);
  // Slice 4+5 of #483: orchestrator + webhook_test + cache-observation
  // hook (the orchestrator is threaded into makeDatabaseChangeHandler
  // below so observeSnapshot fires whenever the database watcher
  // detects an OF state change — see ADR-0016 §1).
  const webhookOrchestrator = new WebhookOrchestrator({
    registry: webhookRegistry,
    dispatcher: new HttpsDispatcher(),
  });
  registerWebhookTestTool(server, {
    orchestrator: webhookOrchestrator,
    enabled: config.OMNIFOCUS_WEBHOOKS_ENABLED,
    makeMeta,
  });

  // Register the ten MCP resources (DESIGN §28).
  registerCapabilitiesResource(server, async () => {
    const summaries = webhookRegistry.list();
    return buildCapabilities(config, {
      calendarAccess: await probeCalendarAccess(),
      webhooks: {
        enabled: config.OMNIFOCUS_WEBHOOKS_ENABLED,
        count: summaries.length,
        names: summaries.map((w) => w.name),
      },
    });
  });
  registerOmniFocusResources(server, {
    adapter,
    projectService: services.projectService,
    reviewService: services.reviewService,
    forecastService: services.forecastService,
    perspectiveService: services.perspectiveService,
  });

  // Folder tools — six uniform `{folderService, makeMeta}` registrations,
  // plus four `{adapter, makeMeta}` describe (preview) tools.
  const folderCtx = { folderService: services.folderService, makeMeta };
  registerFolderCreateTool(server, folderCtx);
  registerFolderDeleteTool(server, folderCtx);
  registerFolderGetTool(server, folderCtx);
  registerFolderListTool(server, folderCtx);
  registerFolderMoveTool(server, folderCtx);
  registerFolderUpdateTool(server, folderCtx);

  // Folder describe tools.
  const folderDescribeCtx = { adapter, makeMeta };
  registerFolderCreateDescribeTool(server, folderDescribeCtx);
  registerFolderDeleteDescribeTool(server, folderDescribeCtx);
  registerFolderMoveDescribeTool(server, folderDescribeCtx);
  registerFolderUpdateDescribeTool(server, folderDescribeCtx);

  // Tag tools — ten uniform `{tagService, makeMeta}` registrations,
  // plus four `{adapter, makeMeta}` describe (preview) tools.
  const tagCtx = { tagService: services.tagService, makeMeta };
  registerTagCreateTool(server, tagCtx);
  registerTagDeleteTool(server, tagCtx);
  registerTagGetManyTool(server, { adapter, makeMeta });
  registerTagGetTool(server, tagCtx);
  registerTagGetLocationTool(server, tagCtx);
  registerTagListTool(server, tagCtx);
  registerTagMoveTool(server, tagCtx);
  registerTagSetAllowsNextActionTool(server, tagCtx);
  registerTagSetLocationTool(server, tagCtx);
  registerTagSetStatusTool(server, tagCtx);
  registerTagUpdateTool(server, tagCtx);

  // Tag describe tools.
  const tagDescribeCtx = { adapter, makeMeta };
  registerTagCreateDescribeTool(server, tagDescribeCtx);
  registerTagDeleteDescribeTool(server, tagDescribeCtx);
  registerTagMoveDescribeTool(server, tagDescribeCtx);
  registerTagUpdateDescribeTool(server, tagDescribeCtx);

  // Note tools — five `{adapter, makeMeta, cache}` registrations.
  // cache is required so note mutations invalidate stale task/project entries
  // (ADR-0006 / docs/cache-invalidation.md).
  const noteCtx = { adapter, makeMeta, cache: services.cache };
  registerNoteAppendTool(server, noteCtx);
  registerNoteGetTool(server, noteCtx);
  registerNoteGetHtmlTool(server, noteCtx);
  registerNoteSetTool(server, noteCtx);
  registerNoteSetHtmlTool(server, noteCtx);

  // Search.
  registerSearchQueryTool(server, { searchService: services.searchService, makeMeta });

  // Forecast.
  registerForecastGetTool(server, { forecastService: services.forecastService, makeMeta });
  registerForecastPackTool(server, { forecastService: services.forecastService, makeMeta });
  registerForecastGetTagTool(server, { forecastService: services.forecastService, makeMeta });
  registerForecastSetTagTool(server, {
    forecastService: services.forecastService,
    cache: services.cache,
    makeMeta,
  });

  // Perspectives.
  const perspectiveCtx = { perspectiveService: services.perspectiveService, makeMeta };
  registerPerspectiveListTool(server, perspectiveCtx);
  registerPerspectiveEvaluateTool(server, perspectiveCtx);
  registerPerspectiveEvaluateDryRunTool(server, perspectiveCtx);
  registerPerspectiveGetTool(server, perspectiveCtx);
  registerPerspectiveDeleteTool(server, {
    perspectiveService: services.perspectiveService,
    cache: services.cache,
    makeMeta,
  });
  registerPerspectiveCreateTool(server, { adapter, cache: services.cache, makeMeta });
  registerPerspectiveUpdateTool(server, { adapter, cache: services.cache, makeMeta });

  // Plugin invoke.
  registerPluginInvokeTool(server, { adapter, makeMeta });

  // Sync — trigger receives the shared cache so invalidate-on-sync can clear
  // every cached read after a sync is kicked off (docs/cache-invalidation.md).
  registerSyncStatusTool(server, { adapter, makeMeta });
  registerSyncTriggerTool(server, { adapter, makeMeta, cache: services.cache });
  registerChangesSinceTool(server, { adapter, makeMeta });

  // Database undo/redo — full cache flush on success since OmniFocus's
  // undo stack is opaque (we don't know what was reverted).
  registerDatabaseUndoTool(server, { adapter, makeMeta, cache: services.cache });
  registerDatabaseRedoTool(server, { adapter, makeMeta, cache: services.cache });

  // Review tools — four `{reviewService, makeMeta}` registrations.
  // ReviewService receives the shared cache so markReviewed/setInterval
  // invalidate stale project entries (ADR-0006).
  const reviewCtx = { reviewService: services.reviewService, makeMeta };
  registerReviewListDueTool(server, reviewCtx);
  registerReviewMarkReviewedTool(server, reviewCtx);
  registerProjectMarkReviewedTool(server, reviewCtx);
  registerReviewSetIntervalTool(server, reviewCtx);
  registerProjectSetNextReviewDateTool(server, reviewCtx);

  // Export — opml + taskpaper (taskpaper helper registers both
  // export_taskpaper and import_taskpaper).
  const exportCtx = { exportService: services.exportService, adapter, makeMeta };
  registerExportOpmlTool(server, exportCtx);
  registerImportOpmlTool(server, exportCtx);
  registerTaskPaperTools(server, exportCtx);

  // App.
  registerAppLaunchTool(server, { adapter, makeMeta });

  // Lifecycle self-diagnostic (#838). Composes the typed-error suggestions
  // from the reliability triad (#816 / #835 / #817) into a single probe.
  //
  // The connectivity probe is a real osascript round-trip: the bounded
  // responsiveness script from the busy classifier (#1109) reads the default
  // document's name plus an O(1) `flattenedTasks` count, exercising both the
  // AppleEvent bridge (running + TCC) and the database layer the read tools
  // depend on. Routed through `runJxaScript` so failures surface as the same
  // typed errors every other tool produces — exactly what the doctor's
  // classifier keys on. Deliberately NOT `getLastSync()`: that adapter
  // method is a process-local cache read that never spawns osascript and can
  // never throw, so probing it reported `pass` even with OmniFocus quit.
  // The in-memory E2E harness (ADR-0014) has no live OmniFocus, so it gets a
  // resolved no-op to keep the doctor consistent with the rest of the tools.
  registerOmnifocusDoctorTool(server, {
    adapter,
    startedAt,
    serverVersion: PACKAGE_VERSION,
    makeMeta,
    probeConnectivity: config.OMNIFOCUS_E2E_USE_MEMORY
      ? async (): Promise<void> => undefined
      : async (): Promise<void> => {
          await runJxaScript(RESPONSIVENESS_PROBE_SCRIPT, {}, { scriptName: "ping" });
        },
  });

  // Window controls — UI-affecting; advisory; no cache invalidation. (#466)
  const windowCtx = { adapter, makeMeta };
  registerWindowGetStateTool(server, windowCtx);
  registerWindowSetPerspectiveTool(server, windowCtx);
  registerWindowSetFocusTool(server, windowCtx);
  registerAppWindowNewTool(server, windowCtx);
  registerAppWindowNewTabTool(server, windowCtx);

  // Project tools — eight registrations split across two context shapes.
  // Service-backed handlers receive `{projectService, makeMeta, cache?}`;
  // adapter-backed handlers (create/delete/update — idempotent mutations)
  // receive `{adapter, makeMeta, cache?, idempotencyStore?}` and rely on
  // the module-singleton idempotency store. The shared cache flows in so
  // every mutation can invalidate scopes per ADR-0006.
  const projectServiceCtx = {
    projectService: services.projectService,
    makeMeta,
    cache: services.cache,
  };
  const projectAdapterCtx = { adapter, makeMeta, cache: services.cache };
  registerProjectBatchCompleteTool(server, projectAdapterCtx);
  registerProjectBatchDropTool(server, projectAdapterCtx);
  registerProjectCompleteTool(server, projectServiceCtx);
  registerProjectCreateTool(server, { ...projectAdapterCtx, replayStore });
  registerProjectDeleteTool(server, projectAdapterCtx);
  registerProjectDropTool(server, projectServiceCtx);
  registerProjectGetManyTool(server, { adapter, makeMeta });
  registerProjectGetTool(server, { projectService: services.projectService, makeMeta });
  registerProjectListTool(server, { projectService: services.projectService, makeMeta });
  registerProjectMoveTool(server, projectServiceCtx);
  registerProjectUpdateTool(server, projectAdapterCtx);
  // Project templates — read + write tools share the configured Templates folder name.
  const projectTemplateCtx = {
    adapter,
    makeMeta,
    cache: services.cache,
    templatesFolderName: config.OMNIFOCUS_TEMPLATES_FOLDER_NAME,
  };
  registerProjectTemplateSaveTool(server, projectTemplateCtx);
  registerProjectTemplateListTool(server, projectTemplateCtx);
  registerProjectTemplateDeleteTool(server, projectTemplateCtx);
  registerProjectTemplateInstantiateTool(server, projectTemplateCtx);

  // Project describe tools.
  const projectDescribeCtx = { adapter, makeMeta };
  registerProjectCompleteDescribeTool(server, projectDescribeCtx);
  registerProjectCreateDescribeTool(server, projectDescribeCtx);
  registerProjectDeleteDescribeTool(server, projectDescribeCtx);
  registerProjectDropDescribeTool(server, projectDescribeCtx);
  registerProjectMoveDescribeTool(server, projectDescribeCtx);
  registerProjectUpdateDescribeTool(server, projectDescribeCtx);

  // Task tools — twenty registrations across four context shapes.
  // Service-backed reads use `{taskService, makeMeta}`; raw adapter reads
  // (find_by_name, get_many, parse_transport_text) use `{adapter, makeMeta}`;
  // mutations use `{adapter, makeMeta, cache?}` so invalidate-on-write
  // (ADR-0006 / docs/cache-invalidation.md) sees the shared cache; and the
  // three idempotent mutations (create, delete, update) additionally fall
  // back to the module-singleton idempotency store.
  const taskServiceCtx = { taskService: services.taskService, makeMeta };
  const taskAdapterCtx = { adapter, makeMeta };
  const taskMutationCtx = { adapter, makeMeta, cache: services.cache };
  registerTaskGetTool(server, taskServiceCtx);
  registerTaskListTool(server, taskServiceCtx);
  registerTaskFindByNameTool(server, taskAdapterCtx);
  registerTaskFindSimilarTool(server, taskAdapterCtx);
  registerTaskSearchTool(server, { searchService: services.searchService, makeMeta });
  registerTaskGetManyTool(server, taskAdapterCtx);
  registerTaskParseTransportTextTool(server, { makeMeta });
  registerClarifyTool(server, { makeMeta });
  registerRepetitionFromProseTool(server, { makeMeta, replayStore });
  registerDecisionRecordTool(server, taskMutationCtx);
  registerDecisionClearTool(server, taskMutationCtx);
  registerTaskDeferSmartTool(server, taskMutationCtx);
  registerTaskBatchDeferSmartTool(server, taskMutationCtx);
  registerTaskReclassifyTool(server, taskMutationCtx);
  registerTaskBatchAssignTool(server, taskMutationCtx);
  registerTaskBatchCompleteTool(server, taskMutationCtx);
  registerTaskBatchCreateTool(server, taskMutationCtx);
  registerTaskBatchDeleteTool(server, taskMutationCtx);
  registerTaskBatchDropTool(server, taskMutationCtx);
  registerTaskBatchMoveTool(server, taskMutationCtx);
  registerTaskBatchUncompleteTool(server, taskMutationCtx);
  registerTaskBatchUndropTool(server, taskMutationCtx);
  registerTaskBatchUpdateTool(server, taskMutationCtx);
  registerTaskClearAlarmsTool(server, taskMutationCtx);
  registerTaskClearRepetitionTool(server, taskMutationCtx);
  registerTaskCompleteTool(server, { ...taskMutationCtx, replayStore });
  registerTaskDropTool(server, taskMutationCtx);
  registerTaskDuplicateTool(server, taskMutationCtx);
  registerTaskExtractFromImageTool(server, {
    ...taskMutationCtx,
    attachmentService: services.attachmentService,
  });
  registerTaskExtractFromNoteTool(server, taskMutationCtx);
  registerTaskConvertToProjectTool(server, taskMutationCtx);
  // Waiting-on tools — mutation context plus the configured @waiting tag name.
  const taskWaitingOnCtx = {
    adapter,
    makeMeta,
    cache: services.cache,
    waitingTagName: config.OMNIFOCUS_WAITING_TAG_NAME,
  };
  registerTaskSetWaitingOnTool(server, taskWaitingOnCtx);
  registerTaskClearWaitingOnTool(server, taskWaitingOnCtx);
  registerTaskMoveTool(server, taskMutationCtx);
  registerTaskReorderTool(server, taskMutationCtx);
  registerTaskSetAlarmsTool(server, taskMutationCtx);
  registerTaskSetRepetitionTool(server, taskMutationCtx);
  registerTaskUncompleteTool(server, taskMutationCtx);
  registerTaskUndropTool(server, taskMutationCtx);
  registerTaskCreateTool(server, taskMutationCtx);
  registerTaskDeleteTool(server, taskMutationCtx);
  registerTaskUpdateTool(server, taskMutationCtx);

  // Task describe tools.
  const taskDescribeCtx = { adapter, makeMeta };
  registerTaskBatchCreateDescribeTool(server, taskDescribeCtx);
  registerTaskBatchUpdateDescribeTool(server, taskDescribeCtx);
  registerTaskCompleteDescribeTool(server, taskDescribeCtx);
  registerTaskCreateDescribeTool(server, taskDescribeCtx);
  registerTaskDeleteDescribeTool(server, taskDescribeCtx);
  registerTaskDropDescribeTool(server, taskDescribeCtx);
  registerTaskMoveDescribeTool(server, taskDescribeCtx);
  registerTaskUpdateDescribeTool(server, taskDescribeCtx);

  // Attachment tools — four uniform `{attachmentService, makeMeta}`
  // registrations exposed via the `registerAttachmentTools` helper:
  // attachment_list / attachment_add / attachment_remove /
  // attachment_save_to_path.
  registerAttachmentTools(server, {
    attachmentService: services.attachmentService,
    makeMeta,
  });

  // Raw-script escape hatches (run_jxa_script, run_omnijs_script) —
  // gated by OMNIFOCUS_ALLOW_RAW_SCRIPT (ADR-0004). When the flag is unset
  // the helpers no-op, so this is safe to call unconditionally.
  const rawScriptCtx = { adapter, makeMeta };
  const rawScriptOpts = { allowRawScript: config.OMNIFOCUS_ALLOW_RAW_SCRIPT };
  registerRunJxaScriptTool(server, rawScriptCtx, rawScriptOpts);
  registerRunOmniJsScriptTool(server, rawScriptCtx, rawScriptOpts);

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

  // Start the database watcher. The handler queries OmniFocus for which
  // specific tasks/projects changed, evicts those cache entries, and fans
  // out per-object + aggregate-view resource notifications. See
  // {@link makeDatabaseChangeHandler} for the full behaviour and fallback
  // semantics when getChangesSince() is unavailable.
  const handleDatabaseChange = makeDatabaseChangeHandler({
    adapter,
    cache: services.cache,
    server,
    aggregateUris: [
      SNAPSHOT_URI,
      INBOX_URI,
      FORECAST_TODAY_URI,
      OVERDUE_URI,
      FLAGGED_URI,
      REVIEW_DUE_URI,
    ],
    orchestrator: webhookOrchestrator,
  });

  const dbWatcher = new DatabaseWatcher((ctx) => {
    handleDatabaseChange(ctx).catch((err) => {
      logger.error({ event: "database.changed.handler_error", err });
    });
  });
  dbWatcher.start();
  // The watcher is stopped via process exit (persistent: false keeps it from
  // blocking exit), but stop eagerly on SIGINT/SIGTERM for clean logging.
  process.on("exit", () => dbWatcher.stop());

  // Build the tools manifest emitted in `server.started` from the single
  // source of truth. Raw-script tools are filtered out unless actually
  // registered (they only register when OMNIFOCUS_ALLOW_RAW_SCRIPT is set).
  const tools = Object.keys(ALL_TOOL_DESCRIPTIONS)
    .filter((t) => config.OMNIFOCUS_ALLOW_RAW_SCRIPT || !RAW_SCRIPT_TOOLS.has(t))
    .sort();

  logger.info(
    {
      event: "server.started",
      version: PACKAGE_VERSION,
      config: redactConfig(config),
      tools,
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
