/**
 * Percentile helpers for the latency benchmark (#941).
 *
 * Uses the nearest-rank method on a copy of the input — small N (typical
 * workflow has tens-to-hundreds of samples), so the cost of allocating a
 * fresh sorted array per call is negligible and keeps the inputs immutable.
 */

/**
 * Nearest-rank percentile. `p` is in [0, 1]. Returns `0` for an empty input
 * so callers don't have to guard at every site.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  if (samples.length === 1) return sorted[0]!;
  // Nearest-rank: ceil(p * N), clamped to [1, N], then 0-indexed.
  const rank = Math.max(1, Math.min(sorted.length, Math.ceil(p * sorted.length)));
  return sorted[rank - 1]!;
}

export function max(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let m = samples[0]!;
  for (let i = 1; i < samples.length; i += 1) {
    const v = samples[i]!;
    if (v > m) m = v;
  }
  return m;
}
