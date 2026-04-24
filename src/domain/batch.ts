/**
 * Batch-operation result shape — best-effort execution with per-index outcomes.
 *
 * Per SPEC "bulk-creates 20 tasks": the validation phase is atomic (all-or-
 * nothing), but once the batch reaches the adapter the execution phase is
 * best-effort: each item succeeds or fails independently, and the caller gets
 * a per-index picture of what happened.
 *
 * The adapter returns this generic shape; the tool layer renames the
 * `succeeded` key to something operation-specific (`created` / `updated` /
 * `completed`) before emitting the tool envelope, but the structure is
 * unchanged.
 *
 * @see src/adapter/OmniFocusAdapter.ts — batchCreateTasks / batchUpdateTasks / batchCompleteTasks
 */

export interface BatchItemSuccess<T> {
  /** Zero-based index into the input array. */
  index: number;
  /** The value produced for this item — a `TaskId` for create, `void` for update/complete (undefined). */
  value: T;
}

export interface BatchItemFailure {
  /** Zero-based index into the input array. */
  index: number;
  /** Typed error code — matches the `code` on the adapter's thrown error taxonomy. */
  errorCode: string;
  /** Human-readable reason suitable for surfacing to the agent. */
  message: string;
}

/**
 * Per-index outcome of a best-effort batch. The arrays are disjoint and their
 * union covers every input index exactly once; a caller can iterate the
 * input by index and look it up in either bucket.
 */
export interface BatchOutcome<T> {
  succeeded: BatchItemSuccess<T>[];
  failed: BatchItemFailure[];
}
