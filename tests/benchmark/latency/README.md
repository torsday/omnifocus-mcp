# Latency benchmark suite (#941)

A measurement-only suite that records the **wall-clock latency** an MCP
client would observe per call when running canonical workflows
against a real OmniFocus database. Sister to
[`tests/benchmark/token-cost/`](../token-cost/README.md): same workflows,
same baseline-and-drift discipline, different metric.

This is the perf scorecard for [#882](https://github.com/torsday/omnifocus-mcp/issues/882)-class
structural changes (e.g. persistent `osascript` REPL) — a PR that
claims "40% lower call latency" lands a measurable diff against this
baseline, or the claim has no proof.

## What it measures

Workflows execute through the **real** transport chain
(`JxaTransport` + `OmniJsTransport` routed by `TransportRouter`). Each
workflow runs in its own Node worker process so the first call to
each script genuinely pays the spawn-dominated cold cost — running
multiple workflows in one process would warm the runtime after the
first and bias every subsequent cold reading downward.

Per workflow, per script (e.g. `task_list`, `project_create`):

| Field | What it captures |
| --- | --- |
| `count` | Total invocations of this script in the workflow run. |
| `p50Ms` / `p95Ms` / `maxMs` | Wall-clock percentiles across **all** calls (cold + warm). |
| `coldP95Ms` | The first call to this script in the worker's process (spawn-dominated). |
| `warmP95Ms` | p95 of every call **after** the first. `null` when the script ran exactly once. |
| `spawnPctOfTotal` | `sum(spawnFloorMs * count) / sum(durationMs)` — how much of the workflow's wall time the calibrated osascript spawn floor explains. |

Wall-clock comes from `performance.now()` deltas in
`src/logging/transportCall.ts`; the spawn floor comes from the #939
calibration that already runs at boot.

## Fixture workflows

Reused **verbatim** from token-cost (the workflows are transport-
agnostic; only the harness differs):

- `inbox-triage`
- `weekly-review`
- `project-planning`
- `end-of-day-review`

`large-pagination` is intentionally excluded — it asserts exact page-
count invariants against its own 120-task seed that would either fail
or pollute the user's OF database when driven through real JXA.

## Side effects — read this before running

Unlike token-cost (hermetic `InMemoryAdapter`), the latency bench
drives **real** OmniFocus. Every workflow creates real entities (tags,
tasks, projects). The harness does **not** clean up after itself in
this initial cut (follow-up issue: automatic cleanup). For local
runs, expect debris with names like `Triage candidate NN — capture
from inbox`, `Q3 Migration — strategy phase`, the `@actionable` tag,
etc. CI uses the `mac-local` runner against a dedicated OmniFocus
profile, so debris stays out of anyone's working database.

## Running

```bash
# Drive each workflow through real JXA, compare against the checked-in baseline.
pnpm bench:latency

# Re-baseline (writes __snapshots__/baseline.json).
pnpm bench:latency --update

# CI-style via vitest, gated on OMNIFOCUS_LATENCY_BENCH=1.
pnpm test:bench:latency
```

The vitest entry is gated on `OMNIFOCUS_LATENCY_BENCH=1` so it stays
out of the default `pnpm test` matrix. Total wall-time is several
minutes per workflow at current `JxaTransport` cost; once #882 lands,
expect a measurable drop in `coldP95Ms`.

## Drift policy

Baseline at [`__snapshots__/baseline.json`](./__snapshots__/baseline.json)
is the contract. Each run rebuilds the rollup and compares.

- **Drift `< 15%`** in any tracked field → passes silently. Wider band
  than token-cost's 5% because wall-clock measurements on the
  `mac-local` runner are noisier than byte counts.
- **Drift `≥ 15%`** in either direction → fails the run, prints the
  diff. Symmetric thresholds catch both regressions and improvements
  that forgot to re-baseline.

`coldP95Ms` is intentionally **not** gated. Single-iteration cold runs
are too noisy to assert on; revisit once the multi-iteration follow-up
lands.

### How optimization PRs use this suite

A PR under #882 should:

1. Implement the optimization.
2. Run `pnpm bench:latency` locally on a `mac-local`-equivalent box.
3. Run `pnpm bench:latency --update` to rewrite the baseline.
4. Include the baseline diff in the PR — the JSON change is the
   documentation that the optimization landed.
5. Confirm a ≥30% drop in at least one workflow's `coldP95Ms` (per
   #882's structural claim) without regressing other workflows by ≥15%.

A PR that should **not** affect latency but trips drift is a real
regression and must be investigated before merge.

## CI promotion path

The benchmark currently runs as a **non-required** check at
[`.github/workflows/latency-bench.yml`](../../../.github/workflows/latency-bench.yml).

Promote to required once:

1. The baseline has held for one week of unrelated PR traffic without
   spurious failures.
2. Re-baselining cadence under #882-class work stabilizes.

Promotion is a one-line edit to the repo's branch protection settings;
no code change here.

## Adding a new fixture

1. Add the workflow under `tests/benchmark/token-cost/workflows/<name>.ts`
   (transport-agnostic, so both harnesses can drive it).
2. Wire it into both `tests/benchmark/token-cost/run.test.ts` /
   `cli.ts` **and** `tests/benchmark/latency/workflows.ts`.
3. Run `pnpm bench:latency --update` to extend the latency baseline,
   and `pnpm bench:tokens --update` for the token baseline.
4. Document the new fixture in this README and in token-cost's.
