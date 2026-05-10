/**
 * Shared retry-once-on-transient-failure policy for the JXA and OmniJS
 * script runners (#816 + #890).
 *
 * Both runners apply the same policy: when a read-only script fails with a
 * transient signal (timeout or a known transport-error code), wait
 * `delayMs` and try once more. The list of read-only scripts and the
 * transient-error signatures are transport-specific and live in each
 * runner; the *policy* — enabled flag and backoff duration — is shared so
 * a single env-var pair (`OMNIFOCUS_TRANSIENT_RETRY_ENABLED`,
 * `OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS`) controls both transports.
 *
 * @see src/adapter/jxa/scriptRunner.ts — JXA half (#816)
 * @see src/adapter/omnijs/scriptRunner.ts — OmniJS half (#890)
 */

/** Runtime knobs controlling whether and how long the retry waits. */
export interface RetryPolicy {
  enabled: boolean;
  delayMs: number;
}

/**
 * Module-level default policy, sourced from env vars at process start.
 * `configureRetryPolicy` overrides this once at server boot from the
 * parsed `Config`; tests bypass via per-call `RunScriptOptions.retry`.
 */
let defaultRetryPolicy: RetryPolicy = {
  enabled: process.env.OMNIFOCUS_TRANSIENT_RETRY_ENABLED !== "0",
  delayMs: Number(process.env.OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS ?? 100),
};

/**
 * Replace the process-wide retry defaults. Called once from server
 * startup (`startServer()` in `mcpServer.ts`) with the validated config;
 * subsequent calls are a no-op for tests that just want to read the
 * current state.
 */
export function configureRetryPolicy(policy: Partial<RetryPolicy>): void {
  defaultRetryPolicy = { ...defaultRetryPolicy, ...policy };
}

/**
 * Resolve the effective policy for a single call: per-call overrides
 * win, then the module-level defaults fill in the rest.
 */
export function resolveRetryPolicy(override?: Partial<RetryPolicy>): RetryPolicy {
  return { ...defaultRetryPolicy, ...(override ?? {}) };
}
