/**
 * `aliasedEnum` — build a Zod enum that accepts a small, documented set of
 * natural-language aliases at the boundary, normalising them to the
 * canonical value before the constraint check.
 *
 * Implements lever 3 of `docs/nl-quality-standards.md` — "forgiving aliases
 * at the boundary." The mapping is unambiguous and stable: every alias
 * resolves to exactly one canonical value, never two. Fuzzy phrasings
 * (where the right answer depends on context) stay type-errors.
 *
 * # Usage
 *
 * ```typescript
 * status: aliasedEnum(
 *   ["active", "on-hold", "done", "dropped"] as const,
 *   { paused: "on-hold", completed: "done", cancelled: "dropped" },
 *   "Restrict to projects with this status.",
 * ).optional();
 * ```
 *
 * The describe string the helper emits already lists the accepted aliases
 * — appending the per-field caller text to the canonical-and-aliases line
 * keeps the whole shape consistent across tools.
 *
 * # Why preprocess
 *
 * `z.preprocess(fn, schema)` runs `fn` *before* schema validation, so the
 * canonical-form string reaches the enum check. Compare to `z.transform`,
 * which runs *after* — too late to satisfy `z.enum`. Lowercasing happens
 * inside the preprocessor so aliases match regardless of the agent's
 * casing.
 *
 * # Why a helper instead of inlined preprocess
 *
 * The preprocess + describe pattern repeats > 3 times across this
 * codebase (4 status fields, 1 completion-criterion field, more on the
 * way as new tools land). A helper keeps the shape consistent and the
 * describe rendering uniform; agents reading the schemas see the same
 * "Accepts: …" suffix in every aliased enum.
 *
 * @see docs/nl-quality-standards.md §3 — forgiving aliases
 * @see #573 — adoption issue
 */

import { z } from "zod";

/**
 * Build a Zod schema that accepts canonical enum values *plus* a documented
 * alias map, returning the canonical form. Non-string inputs pass through to
 * the enum check unchanged (and fail there with a normal Zod error).
 *
 * @param canonical - the canonical values; must be a non-empty tuple.
 * @param aliases - alias → canonical map. Aliases are matched
 *   case-insensitively. Every value must be a member of `canonical`.
 * @param describe - the per-field description. The helper appends the
 *   accepted-aliases sentence so the agent sees them in the schema.
 */
export function aliasedEnum<const T extends readonly [string, ...string[]]>(
  canonical: T,
  aliases: Readonly<Record<string, T[number]>>,
  describe: string,
): z.ZodType<T[number]> {
  // Build a lower-cased copy once so each invocation doesn't re-walk the
  // map. Validate at construction time that every alias points at a real
  // canonical value — catches typos before they ship.
  const normalised: Record<string, T[number]> = {};
  for (const [k, v] of Object.entries(aliases)) {
    if (!canonical.includes(v)) {
      // TypeError because this is a programmer-error precondition (a typo in
      // the alias map), not a runtime user error. lint-custom forbids bare
      // `Error` outside src/errors/; TypeError is the intended escape hatch
      // for build-time invariants.
      throw new TypeError(
        `aliasedEnum: alias '${k}' points at '${v}' which is not in canonical set ${JSON.stringify(canonical)}`,
      );
    }
    normalised[k.toLowerCase()] = v;
  }

  const aliasList = Object.entries(aliases)
    .map(([k, v]) => `'${k}' → ${v}`)
    .join(", ");
  const fullDescribe = aliasList ? `${describe} Accepts: ${aliasList}.` : describe;

  return z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      return normalised[v.toLowerCase()] ?? v;
    }, z.enum(canonical))
    .describe(fullDescribe) as unknown as z.ZodType<T[number]>;
}
