/**
 * `omnifocus_doctor` MCP tool — self-diagnostic for setup verification (#838).
 *
 * Runs a small set of probes and returns a structured report so a new user
 * (or an agent diagnosing a misbehaving session) can see exactly which
 * component is broken without scraping logs. Composes with the reliability
 * triad shipped earlier in the v1 cycle:
 *
 *   - #816 retry-once on transient JXA errors
 *   - #835 transport-level circuit breaker
 *   - #817 OFBusy classifier (modal / sync block detection)
 *
 * The probes deliberately reuse the typed-error surface those features
 * already produce — `OmniFocusNotRunning`, `PermissionDenied`, `Timeout`,
 * `OFBusy`, `CircuitOpen` each carry their own `suggestion`, so the
 * doctor's remediation text is the error class's own actionable message.
 *
 * Read-only and idempotent. Cheap — a single `getLastSync()` call covers
 * the running / TCC / responsiveness checks via its error classification.
 *
 * @see DESIGN.md §6.3 — lifecycle layer
 * @see src/tools/observability/internalStatus.ts — sibling health probe (server-side metrics)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import {
  CircuitOpen,
  OFBusy,
  OmniFocusError,
  OmniFocusNotRunning,
  PermissionDenied,
  Timeout,
  TransportUnavailable,
} from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const OMNIFOCUS_DOCTOR_DESCRIPTION =
  "Self-diagnostic for omnifocus-mcp setup. Probes server health and the live OmniFocus connection. " +
  "Do NOT call as a substitute for the tool that actually does the work — only use to triage why another tool is failing; prefer internal_status when you already know setup is fine and only want server metrics. " +
  "Returns { summary: 'ok' | 'degraded' | 'failed', checks: [{ name, status: 'pass' | 'warn' | 'fail', details, remediation }] }. summary is the worst status across all checks; surface each check's remediation back to the user verbatim. " +
  "No side effects; will NOT launch OmniFocus (use app_launch for that). " +
  "Example: omnifocus_doctor()";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const omnifocusDoctorInputSchema = z.object({});
export type OmnifocusDoctorInput = z.infer<typeof omnifocusDoctorInputSchema>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail";
export type DoctorSummary = "ok" | "degraded" | "failed";

export interface DoctorCheck {
  /** Stable machine-readable name. */
  name: string;
  /** Overall outcome of this check. */
  status: CheckStatus;
  /** Free-form structured payload — present even when status=pass for visibility. */
  details: Record<string, unknown>;
  /** Actionable next step for the user. `null` when no action is needed. */
  remediation: string | null;
}

export interface DoctorReport {
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface OmnifocusDoctorContext {
  adapter: OmniFocusAdapter;
  /** `Date.now()` snapshot from server boot — used for the uptime check. */
  startedAt: number;
  /** Package version (`packageJson.version` at server-boot import). */
  serverVersion: string;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Compute the worst status across all checks.
 *
 *   any fail → "failed"
 *   else any warn → "degraded"
 *   else → "ok"
 */
function rollUp(checks: DoctorCheck[]): DoctorSummary {
  let worst: DoctorSummary = "ok";
  for (const c of checks) {
    if (c.status === "fail") return "failed";
    if (c.status === "warn") worst = "degraded";
  }
  return worst;
}

/** Run the server-info probe — never fails (it's pure host metadata). */
function checkServerInfo(ctx: OmnifocusDoctorContext): DoctorCheck {
  const uptimeMs = Date.now() - ctx.startedAt;
  return {
    name: "server_info",
    status: "pass",
    details: {
      serverVersion: ctx.serverVersion,
      uptimeMs,
      nodeVersion: process.version,
      platform: process.platform,
    },
    remediation: null,
  };
}

/**
 * Run the OmniFocus connectivity probe via `getLastSync()`.
 *
 * Success means: OmniFocus is running, Automation permission is granted,
 * and the adapter's JXA bridge is responsive. The single call covers
 * three acceptance-criteria checks because its error taxonomy already
 * separates the failure modes:
 *
 *   - {@link OmniFocusNotRunning} → app not launched
 *   - {@link PermissionDenied}    → TCC not granted
 *   - {@link OFBusy} (#817)       → modal or sync block — user-actionable
 *   - {@link CircuitOpen} (#835)  → sustained failures, breaker open
 *   - {@link Timeout}             → wedge (likely transient)
 *   - {@link TransportUnavailable}→ osascript binary missing
 *   - other errors                → fail with the message as remediation
 */
async function checkOmniFocusConnectivity(
  ctx: OmnifocusDoctorContext,
): Promise<{ ofRunning: DoctorCheck; automationPermission: DoctorCheck; sync: DoctorCheck }> {
  try {
    const sync = await ctx.adapter.getLastSync();
    return {
      ofRunning: {
        name: "of_running",
        status: "pass",
        details: { reachable: true },
        remediation: null,
      },
      automationPermission: {
        name: "automation_permission",
        status: "pass",
        details: { granted: true },
        remediation: null,
      },
      sync: {
        name: "sync_state",
        status: "pass",
        details: { lastSyncAt: sync.lastSyncAt, inFlight: sync.inFlight },
        remediation: null,
      },
    };
  } catch (err) {
    return classifyConnectivityError(err);
  }
}

/**
 * Map a thrown adapter error to the three connectivity checks. Each check
 * is reported individually so the caller can see "ran into OmniFocusNotRunning"
 * as a fail on `of_running` and `unknown` (rather than `pass`) on the
 * downstream checks — those weren't actually exercised.
 */
function classifyConnectivityError(err: unknown): {
  ofRunning: DoctorCheck;
  automationPermission: DoctorCheck;
  sync: DoctorCheck;
} {
  // Errors carrying a `suggestion` (every OmniFocusError does) — surface
  // that text as the remediation so the user gets identical guidance to
  // what the underlying tool would have returned.
  const remediation = err instanceof OmniFocusError ? (err.suggestion ?? null) : null;
  const code = err instanceof OmniFocusError ? err.code : "UNKNOWN";
  const message = err instanceof Error ? err.message : String(err);

  // Default "not exercised" downstream checks — overridden by the
  // specific branches below where we can be more precise.
  const skipped: DoctorCheck = {
    name: "",
    status: "warn",
    details: { skipped: true, reason: "blocked by upstream failure" },
    remediation: null,
  };

  if (err instanceof OmniFocusNotRunning) {
    return {
      ofRunning: {
        name: "of_running",
        status: "fail",
        details: { code, error: message },
        remediation,
      },
      automationPermission: { ...skipped, name: "automation_permission" },
      sync: { ...skipped, name: "sync_state" },
    };
  }

  if (err instanceof PermissionDenied) {
    return {
      ofRunning: {
        name: "of_running",
        status: "pass",
        details: { reachable: true, note: "process check via System Events" },
        remediation: null,
      },
      automationPermission: {
        name: "automation_permission",
        status: "fail",
        details: { code, error: message },
        remediation,
      },
      sync: { ...skipped, name: "sync_state" },
    };
  }

  if (err instanceof OFBusy) {
    return {
      ofRunning: {
        name: "of_running",
        status: "pass",
        details: { reachable: true },
        remediation: null,
      },
      automationPermission: {
        name: "automation_permission",
        status: "pass",
        details: { granted: true },
        remediation: null,
      },
      sync: {
        name: "sync_state",
        status: "warn",
        details: { code, error: message },
        remediation,
      },
    };
  }

  if (err instanceof CircuitOpen) {
    // Circuit-open means *recent* sustained failure — treat as fail on
    // the connectivity dimension; the operator should wait for the
    // breaker's recovery window before retrying.
    return {
      ofRunning: {
        name: "of_running",
        status: "fail",
        details: { code, error: message },
        remediation,
      },
      automationPermission: { ...skipped, name: "automation_permission" },
      sync: { ...skipped, name: "sync_state" },
    };
  }

  if (err instanceof Timeout) {
    return {
      ofRunning: {
        name: "of_running",
        status: "warn",
        details: { code, error: message, note: "OmniFocus may be wedged" },
        remediation,
      },
      automationPermission: { ...skipped, name: "automation_permission" },
      sync: { ...skipped, name: "sync_state" },
    };
  }

  if (err instanceof TransportUnavailable) {
    return {
      ofRunning: {
        name: "of_running",
        status: "fail",
        details: { code, error: message, note: "osascript binary not reachable" },
        remediation,
      },
      automationPermission: { ...skipped, name: "automation_permission" },
      sync: { ...skipped, name: "sync_state" },
    };
  }

  // Catch-all — unknown error class. Mark all three checks as fail with
  // the original error message so nothing is silently passing.
  const fail: DoctorCheck = {
    name: "",
    status: "fail",
    details: { code, error: message },
    remediation,
  };
  return {
    ofRunning: { ...fail, name: "of_running" },
    automationPermission: { ...fail, name: "automation_permission" },
    sync: { ...fail, name: "sync_state" },
  };
}

/**
 * Pure handler — callable directly in unit tests without an McpServer.
 */
export async function handleOmnifocusDoctor(
  _input: OmnifocusDoctorInput,
  ctx: OmnifocusDoctorContext,
): Promise<ReturnType<typeof ok<DoctorReport>>> {
  const serverInfo = checkServerInfo(ctx);
  const connectivity = await checkOmniFocusConnectivity(ctx);

  const checks: DoctorCheck[] = [
    serverInfo,
    connectivity.ofRunning,
    connectivity.automationPermission,
    connectivity.sync,
  ];

  return ok<DoctorReport>({ summary: rollUp(checks), checks }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerOmnifocusDoctorTool(server: McpServer, ctx: OmnifocusDoctorContext) {
  return server.registerTool(
    "omnifocus_doctor",
    {
      description: OMNIFOCUS_DOCTOR_DESCRIPTION,
      inputSchema: omnifocusDoctorInputSchema.shape,
    },
    async (args: OmnifocusDoctorInput) => {
      const envelope = await handleOmnifocusDoctor(args, ctx);
      return toolResponse(envelope);
    },
  );
}
