/**
 * Typed error hierarchy for omnifocus-mcp.
 *
 * Every throw in the server is one of these classes; generic `Error` is
 * forbidden by lint rule (issue #5). Classes are grouped by remediation
 * class so an agent reading an error knows, at a glance, whether to retry,
 * wait, fix input, or stop and ask the user — see DESIGN §6.7.
 *
 * The `code` field is part of the public stability contract (ADR-0011);
 * removing or renaming a code is a breaking change. New codes are additive.
 *
 * @see DESIGN.md §6.7 — error taxonomy
 * @see DESIGN.md §12 — response envelope
 * @see docs/adr/0013-tool-response-envelope.md — error envelope shape
 */

// ---------------------------------------------------------------------------
// Public contract — error codes
// ---------------------------------------------------------------------------

/** Stable identifier surfaced to clients in `error.code`. Public contract. */
export type ErrorCode =
  // Environment — retry pointless; user action required
  | "OF_NOT_RUNNING"
  | "OF_PERMISSION_DENIED"
  | "OF_FEATURE_REQUIRES_PRO"
  | "OF_FEATURE_REQUIRES_VERSION"
  | "OF_WINDOW_UNAVAILABLE"
  | "OF_CALENDAR_PERMISSION_DENIED"
  | "OF_CALENDAR_BRIDGE_UNAVAILABLE"
  // Input — agent should fix the input before retrying
  | "OF_VALIDATION"
  | "OF_NOT_FOUND"
  | "OF_CONFLICT"
  // Transient — agent may retry after waiting
  | "OF_TIMEOUT"
  | "OF_RATE_LIMITED"
  | "OF_QUEUE_FULL"
  | "OF_CIRCUIT_OPEN"
  // Infrastructure — usually transient but not the agent's to fix
  | "OF_TRANSPORT_UNAVAILABLE"
  | "OF_SCRIPT_ERROR"
  // Lifecycle — stop and reconnect
  | "OF_SHUTTING_DOWN"
  // Protocol guard — stray write to stdout (MCP transport channel)
  | "OF_STRAY_STDOUT"
  // Agent loop guard — same tool+args called too many times in a window
  | "OF_LOOP_DETECTED";

/**
 * Machine-readable remediation class. Agents switch on this to decide what
 * to do next without parsing `message` or `suggestion` text.
 *
 * | Class          | Agent action                                              |
 * | -------------- | --------------------------------------------------------- |
 * | environment    | Stop; user must act (launch OF, grant permission)         |
 * | input          | Fix the input and retry                                   |
 * | transient      | Wait `details.retryAfterMs` ms then retry                 |
 * | infrastructure | Retry once; if still failing, surface to user             |
 * | lifecycle      | Reconnect to a fresh server instance                      |
 */
export type RemediationClass =
  | "environment"
  | "input"
  | "transient"
  | "infrastructure"
  | "lifecycle";

/** Constructor options shared by every concrete error. */
export interface ErrorOptions {
  /** Human-readable next step for the agent or operator. Overrides class default. */
  suggestion?: string;
  /** Per-error-code structured payload (e.g. `{ resource, id }` for NotFound). */
  details?: Record<string, unknown>;
  /** Underlying cause for chaining; surfaced via `Error.cause`. */
  cause?: unknown;
  /** Overrides the subclass default remediation class. Rarely needed. */
  remediationClass?: RemediationClass;
}

/** Wire shape produced by `toJSON()` and consumed by the response envelope. */
export interface SerializedError {
  name: string;
  code: ErrorCode;
  message: string;
  /** Machine-readable remediation class — agents switch on this to decide next action. */
  remediationClass?: RemediationClass;
  suggestion?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base for every error this server throws. Carries a stable `code`, an
 * optional `suggestion` for the agent's next action, and structured
 * `details` for the per-code payload.
 *
 * Always thrown via a concrete subclass — do not instantiate directly.
 */
export class OmniFocusError extends Error {
  public readonly code: ErrorCode;
  public readonly remediationClass?: RemediationClass;
  public readonly suggestion?: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    if (options.remediationClass !== undefined) this.remediationClass = options.remediationClass;
    if (options.suggestion !== undefined) this.suggestion = options.suggestion;
    if (options.details !== undefined) this.details = options.details;
  }

  /** Wire serialization for the response envelope. */
  public toJSON(): SerializedError {
    const out: SerializedError = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.remediationClass !== undefined) out.remediationClass = this.remediationClass;
    if (this.suggestion !== undefined) out.suggestion = this.suggestion;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

/** Type guard for narrowing unknown caught values. */
export function isOmniFocusError(value: unknown): value is OmniFocusError {
  return value instanceof OmniFocusError;
}

// ---------------------------------------------------------------------------
// Environment — retry is pointless; user action required
// ---------------------------------------------------------------------------

/** Thrown when OmniFocus is not running and we need it to be. */
export class OmniFocusNotRunning extends OmniFocusError {
  constructor(options: ErrorOptions = {}) {
    super("OF_NOT_RUNNING", "OmniFocus is not running.", {
      remediationClass: "environment",
      suggestion: "Launch OmniFocus and retry.",
      ...options,
    });
  }
}

/** Thrown when macOS Automation permission for OmniFocus has been denied. */
export class PermissionDenied extends OmniFocusError {
  constructor(options: ErrorOptions = {}) {
    super("OF_PERMISSION_DENIED", "Automation permission for OmniFocus is denied.", {
      remediationClass: "environment",
      suggestion:
        "Open System Settings → Privacy & Security → Automation; grant this terminal or client access to OmniFocus. See docs/troubleshooting.md for step-by-step recovery.",
      ...options,
    });
  }
}

/** Thrown when macOS Calendar (TCC) access has not been granted. Mirrors `PermissionDenied` for the calendar bridge. */
export class CalendarPermissionDenied extends OmniFocusError {
  constructor(options: ErrorOptions = {}) {
    super("OF_CALENDAR_PERMISSION_DENIED", "Calendar access has not been granted.", {
      remediationClass: "environment",
      suggestion:
        "Open System Settings → Privacy & Security → Calendars; grant this terminal or client access. Or invoke the calendar-bridge `request-access` flow to trigger the macOS prompt.",
      ...options,
    });
  }
}

/** Thrown when the compiled calendar-bridge Swift binary is missing or fails to start. */
export class CalendarBridgeUnavailable extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_CALENDAR_BRIDGE_UNAVAILABLE", message, {
      remediationClass: "infrastructure",
      suggestion:
        "Run `pnpm build:calendar-bridge` to compile the Swift binary. The published npm tarball includes a prebuilt binary; if you're running from source, the binary is built on demand.",
      ...options,
    });
  }
}

/** Thrown when a feature requires OmniFocus Pro but Standard is installed. */
export class FeatureRequiresPro extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_FEATURE_REQUIRES_PRO", message, {
      remediationClass: "environment",
      suggestion: "This feature requires OmniFocus Pro. Upgrade or use a different tool.",
      ...options,
    });
  }
}

/** Thrown when a feature requires a newer OmniFocus version than the one running. */
export class FeatureRequiresOfVersion extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_FEATURE_REQUIRES_VERSION", message, {
      remediationClass: "environment",
      suggestion:
        "This feature requires a newer OmniFocus version. Update OmniFocus or use a different tool.",
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Input — agent should fix the input before retrying
// ---------------------------------------------------------------------------

/** Thrown when input fails validation (zod, schema constraint, business rule). */
export class ValidationError extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_VALIDATION", message, {
      remediationClass: "input",
      suggestion: "Fix the input and retry. See `details` for field-level reasons.",
      ...options,
    });
  }
}

/** Thrown when a referenced OmniFocus resource cannot be found. */
export class NotFound extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_NOT_FOUND", message, {
      remediationClass: "input",
      suggestion:
        "Confirm the ID with the corresponding `*_list` tool. Use OmniFocus persistent IDs, not names.",
      ...options,
    });
  }
}

/**
 * Thrown when an optimistic-concurrency assertion fails — the resource was
 * modified between the agent's read and its write. The agent should re-read
 * the resource, merge changes, and retry with the fresh `modifiedAt`.
 */
export class ConflictError extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_CONFLICT", message, {
      remediationClass: "input",
      suggestion:
        "The resource was modified since you read it. Re-read with the corresponding `*_get` tool, merge your changes, and retry with the fresh `modifiedAt` value.",
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Transient — agent may retry after waiting
// ---------------------------------------------------------------------------

/** Thrown when an OmniFocus call exceeded its hard timeout. */
export class Timeout extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_TIMEOUT", message, {
      remediationClass: "transient",
      suggestion: "Retry once. If repeated, OmniFocus may be wedged — relaunch it.",
      ...options,
    });
  }
}

/** Thrown when the per-tool rate limit window has been exceeded. */
export class RateLimited extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_RATE_LIMITED", message, {
      remediationClass: "transient",
      suggestion: "Wait details.retryAfterMs milliseconds then retry.",
      ...options,
      details: { retryAfterMs: 60_000, ...options.details },
    });
  }
}

/** Thrown when the write queue's soft cap is exceeded. */
export class QueueFull extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_QUEUE_FULL", message, {
      remediationClass: "transient",
      suggestion: "The write queue is saturated. Wait for in-flight writes to drain, then retry.",
      ...options,
    });
  }
}

/** Thrown when a tool's circuit breaker is open after consecutive failures. */
export class CircuitOpen extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_CIRCUIT_OPEN", message, {
      remediationClass: "transient",
      suggestion:
        "This tool failed repeatedly and is rejecting calls fast. Wait details.retryAfterMs milliseconds for the circuit to half-open.",
      ...options,
      details: { retryAfterMs: 60_000, ...options.details },
    });
  }
}

// ---------------------------------------------------------------------------
// Infrastructure — usually transient but not the agent's to fix
// ---------------------------------------------------------------------------

/** Thrown when neither JXA nor OmniJS transport can serve the request. */
export class TransportUnavailable extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_TRANSPORT_UNAVAILABLE", message, {
      remediationClass: "infrastructure",
      suggestion:
        "The required transport is unreachable. Verify OmniFocus is running and responsive.",
      ...options,
    });
  }
}

/**
 * Thrown when the requested window operation cannot proceed because
 * OmniFocus has no front window (running headless / minimized to dock /
 * window closed). UI tools should surface this so an agent doesn't crash
 * and the user can be prompted to open or focus an OmniFocus window.
 *
 * @see #466
 */
export class WindowUnavailable extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_WINDOW_UNAVAILABLE", message, {
      remediationClass: "environment",
      suggestion:
        "OmniFocus has no front window. Ask the user to open an OmniFocus window (Cmd-N or click the Dock icon) and retry.",
      ...options,
    });
  }
}

/** Thrown when the underlying JXA or OmniJS script raised an error. */
export class ScriptError extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_SCRIPT_ERROR", message, {
      remediationClass: "infrastructure",
      suggestion:
        "The OmniFocus script failed. Inspect `details.transport` and `details.reason` for context.",
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — stop and reconnect
// ---------------------------------------------------------------------------

/** Thrown when the server has begun shutting down and rejects new work. */
export class ServerShuttingDown extends OmniFocusError {
  constructor(options: ErrorOptions = {}) {
    super("OF_SHUTTING_DOWN", "Server is shutting down; not accepting new requests.", {
      remediationClass: "lifecycle",
      suggestion: "Reconnect to a fresh server instance.",
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Agent loop guard
// ---------------------------------------------------------------------------

/**
 * Thrown when the same `(tool, args)` combination has been called too many
 * times within the detection window (DESIGN §6.11 — error threshold).
 *
 * The remediation class is `input` because the agent should change its
 * behaviour (act on the previous result, not repeat the same call) before
 * retrying.
 */
export class LoopDetected extends OmniFocusError {
  constructor(toolName: string, count: number, windowSeconds: number, options: ErrorOptions = {}) {
    super(
      "OF_LOOP_DETECTED",
      `Tool "${toolName}" has been called ${count} time(s) with identical arguments within ${windowSeconds}s. The agent appears to be stuck.`,
      {
        remediationClass: "input",
        suggestion:
          "Act on the result of the previous call before repeating this tool. If you need the same data again, verify the previous response was consumed.",
        details: { tool: toolName, count, windowSeconds },
        ...options,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Protocol guard
// ---------------------------------------------------------------------------

/**
 * Thrown when a stray byte is detected on stdout — which is the MCP transport
 * channel and must remain clean. Any write to stdout (from a console.log,
 * third-party library, etc.) corrupts the JSON-RPC framing.
 */
export class StrayStdout extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_STRAY_STDOUT", message, {
      remediationClass: "infrastructure",
      suggestion:
        "A process wrote to stdout, which corrupts the MCP transport. Check for console.log calls or third-party libraries that write to stdout. All logging must go to stderr.",
      ...options,
    });
  }
}
