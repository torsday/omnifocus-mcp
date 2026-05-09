# Token-cost benchmark suite (#771)

A measurement-only suite that records the bytes (and estimated tokens) an
LLM agent exchanges with this MCP server when running canonical
workflows. Every optimization PR under [#770](https://github.com/torsday/omnifocus-mcp/issues/770)
runs against this suite to prove non-zero improvement on at least one
workflow without regressing the others.

The suite is hermetic: it drives `InMemoryAdapter` directly, does not
touch JXA, and does not require OmniFocus to be running.

## What it measures

For each fixture workflow the suite records:

| Field | What it captures |
| --- | --- |
| `toolListBytes` | UTF-8 length of the simulated `tools/list` payload (every tool's `{name, description, inputSchema}`). Workflow-independent. |
| `totalRequestBytes` | Sum of UTF-8 lengths of every JSON-stringified tool input the workflow sends. |
| `totalResponseBytes` | Sum of UTF-8 lengths of every `toolResponse(envelope)` the workflow receives. Captures both `content[0].text` and `structuredContent` — what the wire delivers. |
| `totalRoundTripBytes` | `totalRequestBytes + totalResponseBytes`. |
| `totalTokens` | `(toolListBytes + totalRoundTripBytes) / TOKEN_DIVISOR`, rounded. |
| `byTool[<name>]` | Per-tool aggregate `{ calls, responseBytes }` — surfaces hotspots so an optimization PR can scope its change. |

### Why measure at the handler boundary, not the JSON-RPC wire?

The full `startServer()` boot installs signal handlers, opens stdio, and
starts the database watcher — none of which the benchmark needs.
Refactoring boot into an in-process variant was an explicit non-goal of
[#771](https://github.com/torsday/omnifocus-mcp/issues/771).
Measuring at the handler boundary captures everything that varies under
[#770](https://github.com/torsday/omnifocus-mcp/issues/770) optimizations
(tool descriptions, input schemas, response payloads). The JSON-RPC
framing adds a small constant per call (~30 B for
`{"jsonrpc":"2.0","id":N,"result":...}`); excluding it isolates the
optimizable surface.

### Token estimate

Tokens are estimated as `bytes / 4` (`TOKEN_DIVISOR` in
[`tokenizer.ts`](./tokenizer.ts)). For the JSON shapes this suite measures
— mostly ASCII keys, ULID/short-name IDs, ISO timestamps — Claude
tokenizers land empirically in the 3.5–4.5 bytes-per-token range, so 4
is a documented heuristic that puts token deltas in lockstep with byte
deltas. The absolute number is less important than the stability of the
conversion: the snapshot's tolerance band catches both metrics.

If a future ticket pulls in a real tokenizer, swap the implementation
behind `estimateTokens` and re-baseline once.

## Fixture workflows

| Workflow | What it exercises |
| --- | --- |
| `inbox-triage` | `tag_create` → `task_batch_create` (20 tasks with multi-KB notes) → `task_list` (inbox) → `task_batch_assign` (flag + tag + defer) → `task_batch_complete` (5) → `task_list` (post-triage). |
| `weekly-review` | Seeds 5 projects × 3 tasks with `nextReviewDate` in the past, then `review_list_due` → for each project: `task_list` + `project_mark_reviewed`. |
| `project-planning` | `project_create` → `tag_create` → `task_batch_create` (10 milestone tasks) → `task_batch_assign` (tag + defer) → `project_get` → `task_list` (post-planning). |

Notes are intentionally sized in the multi-KB range so downstream
truncation work ([#775](https://github.com/torsday/omnifocus-mcp/issues/775))
shows measurable effect against this baseline.

## Drift policy

The baseline at [`__snapshots__/baseline.json`](./__snapshots__/baseline.json)
is the contract. Each run rebuilds the counts and compares.

- **Drift `< 5%`** in any tracked field → passes silently. Absorbs
  fixture noise (cache mode, ID counter shifts under refactor, minor
  envelope additions).
- **Drift `≥ 5%`** in either direction → fails the run, prints the diff.
  Symmetric thresholds catch both regressions and improvements that
  forgot to re-baseline.

### How optimization PRs use this suite

A PR under #770 should:

1. Implement the optimization.
2. Run `pnpm bench:tokens` locally to see the diff.
3. Run `pnpm bench:tokens --update` to rewrite the baseline.
4. Include the baseline diff in the PR — the JSON change is the
   documentation that the optimization landed.
5. Confirm at least one workflow's `totalRoundTripBytes` dropped and no
   workflow regressed by ≥ 5%.

A PR that should **not** affect token cost (refactor, bug fix, new
unrelated feature) but trips drift is a real regression and must be
investigated before merge.

## Running

```bash
# Pretty-printed local run, compared to baseline (exits non-zero on drift)
pnpm bench:tokens

# Re-baseline (writes __snapshots__/baseline.json)
pnpm bench:tokens --update

# CI-style run via vitest (used by the GitHub Actions workflow)
pnpm test:bench:tokens
```

The vitest entry is gated on `OMNIFOCUS_BENCH=1` so it stays out of the
default `pnpm test` matrix.

## CI promotion path

The benchmark currently runs as a **non-required** check in
[`.github/workflows/token-cost-bench.yml`](../../../.github/workflows/token-cost-bench.yml).

Promote to required once:

1. The baseline has held for one week of unrelated PR traffic without
   spurious failures.
2. Re-baselining cadence under #770 stabilizes (a re-baseline per
   optimization PR is expected — too-frequent re-baselines outside #770
   suggest fixture flakiness).

Promotion is a one-line edit to the repo's branch protection settings;
no code change here.

## Adding a new fixture

1. Add `tests/benchmark/token-cost/workflows/<name>.ts` exporting an
   `async run<Name>(ctx: BenchToolContext): Promise<Bench>` that calls
   `bench.call(toolName, input, () => handle<Name>(input, derivedCtx))`
   for each tool invocation.
2. Wire it into [`run.test.ts`](./run.test.ts) and [`cli.ts`](./cli.ts).
3. Run `pnpm bench:tokens --update` to extend the baseline.
4. Document the new workflow in the table above.
