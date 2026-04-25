# Performance Benchmark Setup

The perf suite (`tests/perf/spec-targets.perf.test.ts`) validates the p95 targets from SPEC §9.

## Running the benchmarks

```bash
# Minimal run (auto-creates a 50-task fixture project)
OMNIFOCUS_PERF=1 pnpm test:perf

# More trials for tighter statistics
OMNIFOCUS_PERF=1 PERF_TRIALS=20 pnpm test:perf
```

Requirements:
- OmniFocus must be running
- macOS Automation permission must be granted for `osascript`

## How it works

Each benchmark:
1. Runs `N+1` trials (default `N=10`, override with `PERF_TRIALS`)
2. Discards the first result (JXA cold-start warmup)
3. Computes p50 / p95 / p99
4. Fails if p95 > target × 1.2 (20% headroom for measurement noise)

## SPEC targets

| Benchmark            | Target p95  |
|----------------------|-------------|
| `task_list` (project)| < 1000ms    |
| `task_get` by ID     | < 400ms     |
| `task_update` single | < 600ms     |
| `project_list`       | < 1000ms    |
| `task_list` (cached) | < 50ms      |

## Seeding a large fixture database

The perf suite auto-creates a 50-task project (`perf-bench-fixture`) in `beforeAll`
and cleans it up in `afterAll`. For more realistic results against a 5k-task database,
seed your local OmniFocus manually:

```bash
# Create 100 projects with 50 tasks each (5000 tasks total)
# Using the omnifocus-mcp MCP server:
for i in $(seq 1 100); do
  PROJECT_ID=$(echo '{"name":"perf-seed-'$i'"}' | pnpm -s exec ts-node -e "...")
  for j in $(seq 1 50); do
    # create task in project
  done
done
```

Or use the OmniFocus scripting interface to bulk-seed data. The benchmarks
are meaningful with any database ≥ 500 tasks in scope.

## Interpreting results

Sample output:
```
  ✅ task_list (project scope)   p50=  45ms  p95=  89ms  p99= 120ms  target=1000ms
  ✅ task_get by ID              p50=  38ms  p95=  72ms  p99=  95ms  target=400ms
  ✅ task_update (single)        p50= 120ms  p95= 210ms  p99= 280ms  target=600ms
  ✅ project_list                p50=  55ms  p95= 110ms  p99= 150ms  target=1000ms
  ❌ task_list (cached)          p50=  65ms  p95=  85ms  p99=  95ms  target=50ms
```

A ❌ means p95 exceeded target × 1.2. Investigate cache wiring if the cached-read
benchmark fails — the 30s LRU cache should serve repeated identical queries in < 5ms.
