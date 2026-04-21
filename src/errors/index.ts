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
  // Input — agent should fix the input before retrying
  | "OF_VALIDATION"
  | "OF_NOT_FOUND"
  // Transient — agent may retry after waiting
  | "OF_TIMEOUT"
  | "OF_RATE_LIMITED"
  | "OF_QUEUE_FULL"
  | "OF_CIRCUIT_OPEN"
  // Infrastructure — usually transient but not the agent's to fix
  | "OF_TRANSPORT_UNAVAILABLE"
  | "OF_SCRIPT_ERROR"
  // Lifecycle — stop and reconnect
  | "OF_SHUTTING_DOWN";

/** Constructor options shared by every concrete error. */
export interface ErrorOptions {
  /** Human-readable next step for the agent or operator. Overrides class default. */
  suggestion?: string;
  /** Per-error-code structured payload (e.g. `{ resource, id }` for NotFound). */
  details?: Record<string, unknown>;
  /** Underlying cause for chaining; surfaced via `Error.cause`. */
  cause?: unknown;
}

/** Wire shape produced by `toJSON()` and consumed by the response envelope. */
export interface SerializedError {
  name: string;
  code: ErrorCode;
  message: string;
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
  public readonly suggestion?: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
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
      suggestion: "Launch OmniFocus and retry.",
      ...options,
    });
  }
}

/** Thrown when macOS Automation permission for OmniFocus has been denied. */
export class PermissionDenied extends OmniFocusError {
  constructor(options: ErrorOptions = {}) {
    super("OF_PERMISSION_DENIED", "Automation permission for OmniFocus is denied.", {
      suggestion:
        "Open System Settings → Privacy & Security → Automation; grant this terminal or client access to OmniFocus.",
      ...options,
    });
  }
}

/** Thrown when a feature requires OmniFocus Pro but Standard is installed. */
export class FeatureRequiresPro extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_FEATURE_REQUIRES_PRO", message, {
      suggestion: "This feature requires OmniFocus Pro. Upgrade or use a different tool.",
      ...options,
    });
  }
}

/** Thrown when a feature requires a newer OmniFocus version than the one running. */
export class FeatureRequiresOfVersion extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_FEATURE_REQUIRES_VERSION", message, {
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
      suggestion: "Fix the input and retry. See `details` for field-level reasons.",
      ...options,
    });
  }
}

/** Thrown when a referenced OmniFocus resource cannot be found. */
export class NotFound extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_NOT_FOUND", message, {
      suggestion:
        "Confirm the ID with the corresponding `*_list` tool. Use OmniFocus persistent IDs, not names.",
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
      suggestion: "Retry once. If repeated, OmniFocus may be wedged — relaunch it.",
      ...options,
    });
  }
}

/** Thrown when the per-tool rate limit window has been exceeded. */
export class RateLimited extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_RATE_LIMITED", message, {
      suggestion:
        "Wait before retrying. The default window is 60 seconds. See `details.retryAfterMs`.",
      ...options,
    });
  }
}

/** Thrown when the write queue's soft cap is exceeded. */
export class QueueFull extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_QUEUE_FULL", message, {
      suggestion: "The write queue is saturated. Wait for in-flight writes to drain, then retry.",
      ...options,
    });
  }
}

/** Thrown when a tool's circuit breaker is open after consecutive failures. */
export class CircuitOpen extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_CIRCUIT_OPEN", message, {
      suggestion:
        "This tool failed repeatedly and is rejecting calls fast. Investigate, then wait for the circuit to half-open (default 60 seconds).",
      ...options,
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
      suggestion:
        "The required transport is unreachable. Verify OmniFocus is running and responsive.",
      ...options,
    });
  }
}

/** Thrown when the underlying JXA or OmniJS script raised an error. */
export class ScriptError extends OmniFocusError {
  constructor(message: string, options: ErrorOptions = {}) {
    super("OF_SCRIPT_ERROR", message, {
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
      suggestion: "Reconnect to a fresh server instance.",
      ...options,
    });
  }
}
