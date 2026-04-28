/**
 * Shared contracts for JXA and OmniJS script I/O.
 *
 * Scripts execute at the OS boundary (osascript / OmniJS runtime) where
 * TypeScript cannot enforce shapes at runtime. This module is the single
 * source of truth for every script's JSON output. Transport call sites import
 * named types here instead of repeating inline shapes inline, so a shape
 * change requires exactly one edit.
 *
 * The module also exports pure helper functions that work on these shapes —
 * `mapBatchScriptResult` and `isScriptError` — which are the only logic
 * that can be unit-tested independently of the OmniFocus runtime.
 *
 * @see src/adapter/jxa/JxaTransport.ts      — consumes batch types + helpers
 * @see src/adapter/omnijs/OmniJsTransport.ts — consumes OmniJS result types
 * @see src/scripts/contracts.test.ts         — unit tests for pure helpers
 */

import type { BatchOutcome } from "../domain/batch.js";
import type { Task } from "../domain/task.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Raw success/failure envelope returned by every batch JXA/OmniJS script.
 *
 * `succeeded[].value` is a raw un-branded ID string. The transport layer
 * lifts it to the correct branded domain type via `mapBatchScriptResult`.
 */
export interface RawBatchScriptResult {
  succeeded: Array<{ index: number; value: string }>;
  failed: Array<{ index: number; errorCode: string; message: string }>;
}

/**
 * Error envelope returned by OmniJS scripts that surface typed errors.
 *
 * `C` narrows the allowed error codes. Use the default `string` when the
 * script may return any code (e.g. a pass-through from the OmniFocus API).
 */
export interface ScriptErrorEnvelope<C extends string = string> {
  error: { code: C; message: string };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Type guard — narrows a script result to the `{ error }` branch.
 *
 * @example
 * ```ts
 * if (isScriptError(result)) {
 *   throw new NotFound(result.error.message, { ... });
 * }
 * // result is now the success branch
 * ```
 */
export function isScriptError<C extends string = string>(
  result: unknown,
): result is ScriptErrorEnvelope<C> {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as Record<string, unknown>).error === "object" &&
    (result as Record<string, unknown>).error !== null
  );
}

/**
 * Lifts a raw batch script result (string IDs) to a typed `BatchOutcome<T>`.
 *
 * Every batch script returns `{ succeeded: [{index, value: string}], failed: [...] }`.
 * This function maps the raw string values to the correct branded domain type
 * and returns a fully-typed `BatchOutcome<T>`, eliminating the repeated
 * `raw.succeeded.map(s => ({ index: s.index, value: SomeId.of(s.value) }))`
 * pattern at every call site.
 *
 * @param raw    Raw script output, verbatim from `runJxaScript` / `runOmniJsScript`.
 * @param liftId Converts the raw string value to the domain branded type.
 *
 * @example
 * ```ts
 * const outcome = mapBatchScriptResult(raw, TaskIdCtor.of);
 * ```
 */
export function mapBatchScriptResult<T>(
  raw: RawBatchScriptResult,
  liftId: (value: string) => T,
): BatchOutcome<T> {
  return {
    succeeded: raw.succeeded.map((s) => ({ index: s.index, value: liftId(s.value) })),
    failed: raw.failed,
  };
}

// ---------------------------------------------------------------------------
// OmniJS script result types
// ---------------------------------------------------------------------------

/** Result type for `task_move.js` and `task_reorder.js`. */
export type TaskMoveScriptResult = { id: string } | ScriptErrorEnvelope<"NOT_FOUND" | "VALIDATION">;

/** Result type for `task_batch_move.js`. */
export type TaskBatchMoveScriptResult = RawBatchScriptResult | ScriptErrorEnvelope;

/** Result type for `task_convert_to_project.js`. */
export type TaskConvertToProjectScriptResult =
  | { projectId: string }
  | ScriptErrorEnvelope<"NOT_FOUND" | "VALIDATION" | "CONVERSION_FAILED">;

/** Result type for `app_window_new.js` and `app_window_new_tab.js`. */
export type AppWindowNewScriptResult =
  | { perspectiveName: string | null; focusContainerIds: string[] }
  | ScriptErrorEnvelope<"WINDOW_UNAVAILABLE" | "WINDOW_OPEN_FAILED">;

/** Result type for `perspective_evaluate.js`. */
export type PerspectiveEvaluateScriptResult =
  | { tasks: Task[] }
  | ScriptErrorEnvelope<"FEATURE_REQUIRES_PRO" | "NOT_FOUND">;

/** Result type for `perspective_get.js`. */
export type PerspectiveGetScriptResult =
  | { perspective: import("../domain/perspective.js").PerspectiveDetail }
  | ScriptErrorEnvelope<"FEATURE_REQUIRES_PRO" | "NOT_FOUND">;

/** Result type for `perspective_delete.js`. */
export type PerspectiveDeleteScriptResult =
  | { id: string }
  | ScriptErrorEnvelope<"FEATURE_REQUIRES_PRO" | "NOT_FOUND" | "SCRIPT_ERROR">;

/** Result type for `perspective_create.js`. */
export type PerspectiveCreateScriptResult =
  | { id: string }
  | ScriptErrorEnvelope<"FEATURE_REQUIRES_PRO" | "VALIDATION_ERROR" | "SCRIPT_ERROR">;

// ---------------------------------------------------------------------------
// JXA script result types (complex shapes only; simple `{ task: Task }` etc.
// use domain types directly at the call site)
// ---------------------------------------------------------------------------

/** Result type for `task_duplicate.js`. */
export interface TaskDuplicateScriptResult {
  newId: string;
  descendantCount: number;
}

/** Result type for `changes_since.js`. */
export interface ChangesSinceScriptResult {
  tasks: Array<{ id: string; modificationDate: string }>;
  projects: Array<{ id: string; modificationDate: string }>;
}
