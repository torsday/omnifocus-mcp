/**
 * Dry-run primitive for omnifocus-mcp mutation tools.
 *
 * Agents sometimes need to validate inputs and preview a mutation's shape
 * without committing — especially before destructive operations like
 * `task_delete` or bulk `task_batch_*`. Every mutation tool will eventually
 * accept an optional `dryRun: boolean`; this helper is the single seam they
 * route through.
 *
 * **Contract.** When `dryRun === true`:
 *   1. Caller-provided input validation has already run (zod + business rules).
 *   2. The live mutation (`fn`) is **not** invoked.
 *   3. `preview` constructs a would-be envelope from the validated inputs —
 *      `id`, `createdAt`, `modifiedAt`, and similar server-populated fields
 *      are `null` by convention; this helper does not police those shapes.
 *   4. The returned envelope is stamped with `meta.dryRun = true` and
 *      `meta.syncPending = false` (no local write has happened).
 *
 * When `dryRun` is `false` or `undefined`: `fn` runs verbatim and the helper
 * is a no-op. This mirrors `withIdempotencyKey`'s undefined-key passthrough
 * so both primitives compose cleanly.
 *
 * **Foundation only.** No tool surfaces consume this yet. Per-tool adoption
 * lands in follow-up PRs under #142 so each tool defines its own preview
 * constructor with the correct `null`-stubbed fields.
 *
 * @see #142 — dry-run rollout (tracks per-tool adoption)
 * @see src/server/idempotencyStore.ts — sibling primitive; compose in either order
 * @see DESIGN.md §31 — dry-run contract
 */

import type { ToolEnvelope } from "../envelope/index.js";

/**
 * Execute `fn` for live mutations, or `preview` when `dryRun` is true.
 *
 * The preview envelope is returned with `meta.dryRun = true` and
 * `meta.syncPending = false` layered over whatever the caller produced.
 * The caller's other meta fields (correlationId, durationMs, transport, etc.)
 * are preserved.
 *
 * Errors thrown by `preview` or `fn` propagate unchanged; errors *returned*
 * as `ToolError` envelopes from `preview` are passed through with the dry-run
 * marks applied (a validation failure discovered at preview time is still a
 * dry-run outcome).
 *
 * @param dryRun — caller's `dryRun` flag (may be undefined)
 * @param preview — sync or async constructor of a would-be envelope
 * @param fn — the live mutation
 */
export async function dryRunGuard<T>(
  dryRun: boolean | undefined,
  preview: () => ToolEnvelope<T> | Promise<ToolEnvelope<T>>,
  fn: () => Promise<ToolEnvelope<T>>,
): Promise<ToolEnvelope<T>> {
  if (dryRun !== true) return fn();
  const envelope = await preview();
  return markDryRun(envelope);
}

/**
 * Return a shallow clone of `envelope` with `meta.dryRun = true` and
 * `meta.syncPending = false`. Never mutates the input.
 *
 * Exported for tools that need to mark a preview constructed outside the
 * guard (e.g. when the preview path lives deep inside a tool-specific flow
 * that already owns the envelope).
 */
export function markDryRun<T>(envelope: ToolEnvelope<T>): ToolEnvelope<T> {
  return {
    ...envelope,
    meta: { ...envelope.meta, dryRun: true, syncPending: false },
  };
}
