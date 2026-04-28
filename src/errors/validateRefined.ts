/**
 * `validateRefined` — handler-boundary validation against a refined Zod schema,
 * surfacing structured `failures[]` via `zodToActionable`.
 *
 * # Why this helper exists
 *
 * Most tools register their **base** ZodObject (`schema.shape`) with the MCP
 * SDK, because the SDK needs `.shape` for individual-field descriptors and
 * `ZodEffects` from `.refine()` doesn't expose it. The SDK validates the
 * base shape against the agent's input *before* the handler runs.
 *
 * That leaves a gap: any `.refine()` chained on the **exported** schema
 * (cross-field rules — XOR constraints, date ordering, owner-required
 * unions) silently does not run. The agent gets a green call, the handler
 * proceeds with malformed input, and the eventual error is downstream and
 * confusing.
 *
 * `validateRefined` closes that gap at the handler boundary. The first
 * thing the handler does is re-parse against the refined schema; on
 * failure it throws a `ValidationError` whose `details.failures` carries
 * the actionable rows from `zodToActionable` (per
 * `docs/nl-quality-standards.md` §5).
 *
 * # Usage
 *
 * ```typescript
 * export async function handleTaskCreate(input: TaskCreateToolInput, ctx) {
 *   const validated = validateRefined(taskCreateInputSchema, input);
 *   // …rest of handler uses `validated` (or `input` — they're the same shape)
 * }
 * ```
 *
 * The helper preserves the input's shape (it returns the parsed value, which
 * is structurally equal to a successful base-shape validation), so existing
 * handler code continues to work without further changes.
 *
 * # Why not catch the SDK's ZodError directly
 *
 * The SDK's pre-handler validation surfaces errors before the handler ever
 * runs; we can't intercept those without forking the SDK. This helper
 * targets the *post*-SDK refinement layer — the constraints `.shape` can't
 * express. Augmenting the SDK's error rewriting is tracked separately
 * (see #565 integration tests).
 *
 * @see src/errors/zodToActionable.ts — the structured-failures helper
 * @see docs/nl-quality-standards.md §5 — fail-with-help errors
 * @see #575 — adoption issue
 */

import type { ZodError, ZodTypeAny } from "zod";
import { ValidationError } from "./index.js";
import { zodToActionable } from "./zodToActionable.js";

/**
 * Parse `input` against `schema`. On success, return the parsed value. On
 * failure, throw a `ValidationError` whose `details.failures` is the
 * structured `ActionableValidation[]` agents iterate.
 *
 * @param schema - the refined Zod schema (`base.refine(...).refine(...)`)
 * @param input - the raw input from the SDK (already conforming to the base
 *   shape, but may violate refinements)
 * @param message - error message; defaults to a generic frame referencing
 *   the rubric. Pass a tool-specific message when one is helpful.
 * @throws ValidationError - on any refinement failure
 */
export function validateRefined<S extends ZodTypeAny>(
  schema: S,
  input: unknown,
  message = "Cross-field validation failed",
): import("zod").infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const failures = zodToActionable(result.error as ZodError, input);
  throw new ValidationError(message, { details: { failures } });
}
