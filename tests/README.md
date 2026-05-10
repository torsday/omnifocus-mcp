# tests/

Cross-cutting test suites. Unit tests that target a single module live next to their source (`src/**/*.test.ts`). Everything here is broader: multi-module, live-process, or data-only.

## Sub-directory index

| Dir | Purpose | Runner | Use when… |
|---|---|---|---|
| `benchmark/` | Token-cost benchmarks — counts response bytes per tool call | `pnpm bench:token-cost` | Verifying a change doesn't inflate token spend |
| `chaos/` | Transport fault injection — every DESIGN §19 failure mode via `ScriptSpawner` seam | `pnpm test` (unit tier) | Adding a new transport error path or retry behaviour |
| `contract/` | Adapter contract harness — one parameterised suite all `OmniFocusAdapter` implementations must pass | `pnpm test` / `pnpm test:integration` | Adding a new adapter or changing adapter semantics |
| `e2e/` | Full-stack MCP client — spawns the bundled server over stdio, speaks the SDK protocol | `pnpm test:e2e` | Verifying the tool contract end-to-end through the real transport stack |
| `fixtures/` | Data-only test assets (JSON readability probes, etc.) — no logic | N/A — imported by other suites | Adding stable input/output pairs for snapshot or readability tests |
| `integration/` | Live-OmniFocus tests — requires `OMNIFOCUS_INTEGRATION=1` and the macOS self-hosted runner | `pnpm test:integration` | Proving a JXA/OmniJS behaviour against real OmniFocus |
| `perf/` | SPEC §9 p95 latency targets — gated on `OMNIFOCUS_PERF=1` | `pnpm test:integration` with `OMNIFOCUS_PERF=1` | Checking a change doesn't regress p95 response time |
| `scripts/` | Unit tests for helpers in `scripts/` (NL-quality lint, etc.) | `pnpm test` (unit tier) | Adding or changing a `scripts/*.ts` helper |

## Key files

- `tests/e2e/E2EServer.ts` — spawns the server, provides `callTool` / `listTools` surface for suites
- `tests/e2e/smoke.test.ts` — canonical usage example for `E2EServer`
- `tests/contract/adapter.contract.ts` — exports `runAdapterContract(label, { createAdapter, cleanup })`
- `tests/contract/inMemory.contract.test.ts` — drives the contract suite against `InMemoryAdapter` (runs in the unit tier)
- `tests/benchmark/token-cost/README.md` — token-cost benchmark detail

## Invariants worth knowing

- **`tests/integration/`** runs against live OmniFocus on the `macos-omnifocus` self-hosted GitHub Actions runner. Failures there mean a real JXA/OmniJS bug shipped — see issue #679 for historical gap analysis.
- **`tests/e2e/`** spawns the server as an MCP client (per #80 / #256). Slower than unit tests but exercises the full stdio transport stack.
- **`tests/contract/`** defines the `TransportRouter` substitutability contract shared by JXA and OmniJS adapters.
- **`tests/fixtures/`** is data-only; files are marked `linguist-generated` in `.gitattributes` — don't edit them by hand.

## Running

```bash
pnpm test                              # unit tier — chaos, contract (in-memory), scripts
pnpm test:integration                  # integration + perf (requires OMNIFOCUS_INTEGRATION=1)
pnpm test:e2e                          # e2e suite (spawns server process)
pnpm bench:token-cost                  # token-cost benchmark
pnpm test tests/contract               # contract harness only
```

See `package.json` for full flag reference.
