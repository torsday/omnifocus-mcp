/**
 * Token-count heuristic for the benchmark suite (#771).
 *
 * The suite needs a token estimate alongside byte counts so optimization
 * PRs in #770 can reason in the same units the LLM bills in. We cannot
 * pull Anthropic's tokenizer at suite-time (no network in CI; the tokenizer
 * is also not on npm under a stable, dependency-light handle), and pinning
 * a heavyweight BPE library here for an estimate is out of proportion to
 * the signal needed.
 *
 * Choice: a documented byte-divisor heuristic, `bytes / TOKEN_DIVISOR`.
 * For the JSON payloads this suite measures (mostly ASCII keys, IDs,
 * short names, ISO dates), the empirical bytes-per-token for Claude
 * tokenizers sits in roughly the 3.5–4.5 range — `4` is the well-known
 * rule-of-thumb that lands inside that band and matches what tools like
 * `tiktoken`'s cl100k report on similar JSON shapes.
 *
 * The absolute number is less important than the *stability* of the
 * conversion: every workflow uses the same divisor, so token deltas track
 * byte deltas linearly and the snapshot's tolerance band catches both.
 *
 * If a future ticket pulls in Anthropic's official tokenizer or a small
 * BPE library, swap the implementation here and re-baseline once. Callers
 * only see {@link estimateTokens}.
 */

/** Bytes per token. ASCII-JSON heuristic; see file docblock. */
export const TOKEN_DIVISOR = 4;

/** Estimated token count for a UTF-8 byte length. Rounds half-up. */
export function estimateTokens(bytes: number): number {
  return Math.round(bytes / TOKEN_DIVISOR);
}
