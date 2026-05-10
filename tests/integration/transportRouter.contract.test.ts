/**
 * M1 integration suite — `TransportRouter` against a live OmniFocus.
 *
 * Mounts the same `runAdapterContract` harness used by the unit tier's
 * `InMemoryAdapter` driver, but wired to a real `TransportRouter`
 * (`JxaTransport` + `OmniJsTransport`). Exercises the full adapter contract
 * end-to-end through osascript and OmniJS.
 *
 * Gated on `OMNIFOCUS_INTEGRATION=1`. When the env var is absent the suite
 * is skipped with a clear message — it will never hang.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * Requirements:
 *   - OmniFocus must be running (the adapter raises `OmniFocusNotRunning` otherwise)
 *   - macOS Automation permission must be granted for `osascript`
 *
 * **Fixture cleanup (#881):** the harness's `sandbox` mode creates one
 * fixture folder before any test runs, transparently routes top-level
 * project/folder creates inside it, and bulk-deletes the folder once all
 * tests finish — replacing the previous per-test cleanup loop that did
 * 50–200 osascript round-trips per run. Inbox tasks and tags fall back to
 * parallel bulk-delete since they have no folder home.
 *
 * @see tests/contract/adapter.contract.ts — the harness under mount
 * @see DESIGN.md §19 — testing strategy tiers
 */

import { describe, test } from "vitest";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../../src/adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../../src/adapter/router.js";
import { runAdapterContract } from "../contract/adapter.contract.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

if (!INTEGRATION) {
  describe("TransportRouter integration contract", () => {
    test.skip("skipped — set OMNIFOCUS_INTEGRATION=1 and ensure OmniFocus is running to execute", () => {});
  });
} else {
  // Shared transport — the JXA / OmniJS transports are stateless; only the
  // OF database has state, and the sandbox-mode harness manages that.
  const router = TransportRouter.fromTransports(new JxaTransport(), new OmniJsTransport());

  runAdapterContract("TransportRouter (live OmniFocus)", {
    createAdapter: () => router,
    sandbox: { prefix: "mcp-fixture" },
    // Cleanup deletes entities through osascript; the bulk teardown lands
    // a single recursive folder delete (cascades projects + contained
    // tasks) and parallel sweeps for inbox tasks + tags. 90s is generous
    // headroom — typical teardown is ≤ 5s.
    hookTimeoutMs: 90_000,
  });
}
