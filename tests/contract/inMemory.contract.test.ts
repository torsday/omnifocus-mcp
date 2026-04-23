/**
 * Drives the shared `OmniFocusAdapter` contract harness against
 * `InMemoryAdapter`. Runs in the unit tier on every `pnpm test`.
 *
 * The integration tier (real OmniFocus) will mount the same suite from
 * `tests/integration/` under `OMNIFOCUS_INTEGRATION=1`. See `tests/README.md`.
 */

import { InMemoryAdapter } from "../../src/adapter/inMemory/InMemoryAdapter.js";
import { runAdapterContract } from "./adapter.contract.js";

runAdapterContract("InMemoryAdapter", {
  createAdapter: () => new InMemoryAdapter({ now: () => new Date("2026-04-21T12:00:00.000Z") }),
});
