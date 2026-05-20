/**
 * Flaky-test quarantine helper (#958).
 *
 * Tests with confirmed flake history are wrapped in {@link quarantineTest}
 * instead of vitest's `test`. The wrapper makes them invisible to the
 * main `pnpm test:integration` run (skipped via `test.skipIf`) and only
 * visible to the dedicated `pnpm test:integration:quarantine` script,
 * which runs the whole suite with `OMNIFOCUS_QUARANTINE=1` and tolerates
 * non-zero exit codes (informational-only).
 *
 * The main integration check stays green when the reliable suite passes
 * — quarantined-but-still-broken tests no longer pollute the gate
 * signal. Quarantine is a triage tool, not a fix: every entry should
 * carry an inline reference to the issue tracking its repair, and the
 * test should graduate back to plain `test()` once the underlying
 * problem is gone.
 *
 * The `[quarantine]` suffix appended to the test name makes the
 * quarantine status visible in vitest reporter output without needing
 * to inspect the source — a reviewer scanning a CI log can immediately
 * tell which failures are gating vs. informational.
 *
 * @see #958 — this issue
 * @see #914 — integration-flake umbrella (parent)
 * @see docs/design/testing-and-ci.md — full process for moving in/out
 */

import { test } from "vitest";

/** True when running under the dedicated quarantine script. */
const QUARANTINE_MODE = process.env.OMNIFOCUS_QUARANTINE === "1";
/** True when running the live-OmniFocus integration mount. */
const INTEGRATION_MODE = process.env.OMNIFOCUS_INTEGRATION === "1";

/**
 * Register a test that's currently flaky against the **live OmniFocus**
 * integration mount. Identical signature to vitest's
 * `test(name, fn, timeout)` so it's a drop-in replacement.
 *
 * The quarantine targets the integration tier specifically — the same
 * contract harness is also mounted against `InMemoryAdapter` in the
 * unit tier, which is deterministic and has no flake history. Skipping
 * everywhere would lose unit-tier coverage of the underlying contract
 * method for free.
 *
 * Behavior:
 * - **Unit tier** (no `OMNIFOCUS_INTEGRATION`): always runs. The
 *   InMemoryAdapter has no runner-pollution / cold-start / sync-timing
 *   confound, so the test exercises the contract reliably here.
 * - **Integration tier, normal run** (`OMNIFOCUS_INTEGRATION=1`,
 *   no `OMNIFOCUS_QUARANTINE`): **skipped**. The main
 *   `pnpm test:integration` script can stay green when the reliable
 *   suite passes.
 * - **Integration tier, quarantine run** (`OMNIFOCUS_INTEGRATION=1`,
 *   `OMNIFOCUS_QUARANTINE=1`): runs. The wrapping
 *   `pnpm test:integration:quarantine` script tolerates non-zero exit
 *   so a real failure here is informational, not gating.
 */
export function quarantineTest(
  name: string,
  fn: () => void | Promise<void>,
  timeout?: number,
): void {
  const suffixed = `${name} [quarantine]`;
  // Integration tier under the normal script — quarantined out.
  if (INTEGRATION_MODE && !QUARANTINE_MODE) {
    test.skip(suffixed, fn, timeout);
    return;
  }
  // Unit tier OR explicit quarantine run — execute the test.
  test(suffixed, fn, timeout);
}
