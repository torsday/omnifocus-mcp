/**
 * Optimistic-concurrency guard for omnifocus-mcp mutation tools.
 *
 * The pattern: a caller reads a resource, receives its `modifiedAt`, makes a
 * decision, and then mutates. If something else wrote to the resource in
 * between, the caller's decision is stale. `assertNotModifiedSince` is the
 * single seam services call before committing a mutation to enforce this.
 *
 * When `expected` is undefined the guard is a no-op — same convention as
 * `dryRunGuard` and `withIdempotencyKey` (opt-in behaviour, pass-through by
 * default). This lets tools accept an optional `expectedModifiedAt?: string`
 * input and route unconditionally through the guard.
 *
 * When `expected` is present, both timestamps are normalised via `Date.parse`
 * so equivalent-but-differently-formatted ISO-8601 values (`Z` vs `+00:00`,
 * millisecond precision) compare equal. Divergence throws `ConflictError`
 * with structured details the agent can inspect. A malformed ISO-8601 input
 * is the caller's bug, not a conflict — it surfaces as `ValidationError`.
 *
 * **Foundation only.** No tool surfaces consume this yet. Per-tool adoption
 * lands in follow-up PRs under #139.
 *
 * @see #139 — optimistic-concurrency rollout
 * @see src/errors/index.ts — ConflictError (OF_CONFLICT), ValidationError
 * @see DESIGN.md §11 — concurrency model
 */

import { ConflictError, ValidationError } from "../errors/index.js";

/**
 * Throw `ConflictError` when `observed !== expected` after ISO-8601 normalisation.
 *
 * @param expected — caller-supplied timestamp (optional; `undefined` disables the guard)
 * @param observed — adapter-supplied current `modifiedAt` for the resource
 * @param resource — short stable identifier, e.g. `"task:abc123"`; surfaced in error details
 *
 * @throws {ConflictError} when both parse successfully but to different instants
 * @throws {ValidationError} when either parses as `NaN`; the caller's input is malformed
 */
export function assertNotModifiedSince(
  expected: string | undefined,
  observed: string,
  resource: string,
): void {
  if (expected === undefined) return;

  const expectedMs = Date.parse(expected);
  if (Number.isNaN(expectedMs)) {
    throw new ValidationError(
      `expectedModifiedAt for ${resource} is not a valid ISO-8601 timestamp.`,
      { details: { resource, expected } },
    );
  }

  const observedMs = Date.parse(observed);
  if (Number.isNaN(observedMs)) {
    throw new ValidationError(
      `observed modifiedAt for ${resource} is not a valid ISO-8601 timestamp.`,
      { details: { resource, observed } },
    );
  }

  if (expectedMs !== observedMs) {
    throw new ConflictError(`${resource} was modified since expectedModifiedAt.`, {
      details: { resource, expected, observed },
    });
  }
}
