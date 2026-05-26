# Token cost — measurement and instrumentation

The omnifocus-mcp server includes two complementary token-cost measurement systems:

1. **Offline benchmark** (`tests/benchmark/token-cost/`, [#771](https://github.com/torsday/omnifocus-mcp/issues/771)) — runs a fixed set of canonical LLM workflows against the in-memory adapter and reports per-workflow byte/token counts. Catches regressions on known shapes; runs in CI on every PR that touches transport or response code.
2. **Live response telemetry** ([#778](https://github.com/torsday/omnifocus-mcp/issues/778)) — opt-in production instrumentation that records per-tool response wire-size aggregates (count, total, max, p50, p95). Catches the shape of *real* workloads, which the offline fixtures don't represent.

This document covers (2). For the benchmark, see `tests/benchmark/token-cost/README.md`.

## Why measure live response sizes?

The offline benchmark proves regressions on canonical workflows but doesn't see what production sessions actually invoke. A new tool can quietly become the dominant cost driver — e.g. an LLM that learns to prefer `task_full_text_search` over `task_list` will shift cost in ways no fixture predicts. Per-tool byte aggregates surface that drift before it becomes a budget incident.

## Configuration

Two environment variables, both opt-in (defaults are zero overhead):

| Variable                                     | Default | Effect                                                                                   |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE`       | `0`     | Sample rate, 0–1. `0` disables recording entirely. `1` records every successful call. Fractional values sample randomly at that rate. |
| `OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES`   | `51200` | p95 byte threshold. When a tool's p95 crosses above, a single `response.size.exceeded` warning fires. When p95 returns below, a `response.size.recovered` info event fires. |

Recommended production setting for ongoing observability: `OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE=0.1` (one call in ten) — enough signal to surface outliers, low enough overhead to be free in practice.

## Reading the data

Aggregates surface through the existing `internal_status` MCP tool, in the new `responseStats` field:

```json
{
  "responseStats": {
    "since": "2026-05-09T12:00:00.000Z",
    "sampleRate": 0.1,
    "thresholdBytes": 51200,
    "tools": {
      "task_list": {
        "count": 42,
        "total": 1048576,
        "max": 65536,
        "p50": 18000,
        "p95": 58000
      },
      "project_list": {
        "count": 12,
        "total": 24576,
        "max": 4096,
        "p50": 1800,
        "p95": 3500
      }
    }
  }
}
```

When sampling is disabled (`OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE=0`), `responseStats` is `null`.

### Field semantics

- **`count`** / **`total`** / **`max`** are *lifetime* aggregates: they accumulate across the whole process, never reset.
- **`p50`** / **`p95`** are computed against the most recent ~1024 samples per tool (a ring buffer). They reflect *recent* behaviour — the right semantics for "what's expensive right now?". Older samples roll out as new ones arrive.
- All byte counts are the wire size of the full SDK result — `JSON.stringify({ content, structuredContent })`. Both fields ship to the consumer (per [ADR-0013](./adr/0013-tool-response-envelope.md)). v1 duplicated the envelope JSON into `content[].text`; v2 ([ADR-0022](./adr/0022-envelope-text-content-duplication.md), [#883](https://github.com/torsday/omnifocus-mcp/issues/883)) replaces that with a small fixed placeholder by default — so on v2 the recorded byte counts approximate `structuredContent` plus a few-byte text marker. Set `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` to restore the v1 ~2× sizes. Errors are not recorded; they're SDK-shaped, not tool-shaped.

## Threshold events

When a tool's p95 crosses above `thresholdBytes`, a structured warning is emitted on stderr:

```json
{"level":"warn","event":"response.size.exceeded","tool":"task_list","p95Bytes":58000,"thresholdBytes":51200,"count":42,"msg":"tool response p95 above threshold"}
```

One event per crossing — operators see signal, not noise. When the tool's p95 returns below threshold (e.g. after a code change), a recovery event fires:

```json
{"level":"info","event":"response.size.recovered","tool":"task_list","p95Bytes":48000,"thresholdBytes":51200}
```

The default threshold (51200 bytes ≈ ~13k tokens) is the rough boundary at which a single response starts to dominate context for a typical workflow. Tune via `OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES` for your workload.

## When to act

- **A tool consistently above threshold:** consider whether its response shape can be trimmed (field projection per [#773](https://github.com/torsday/omnifocus-mcp/issues/773), default-value elision per [#774](https://github.com/torsday/omnifocus-mcp/issues/774), note truncation per [#775](https://github.com/torsday/omnifocus-mcp/issues/775)).
- **A tool's p95 ≫ p50:** suggests a long-tailed response distribution — typically because some inputs return bulk results and others return one item. Consider whether bulk reads should be paginated more aggressively.
- **`max` ≫ `p95`:** rare outliers; less actionable, but worth investigating if `max` exceeds the p95 by more than ~10×.

## Composition with other instruments

- The offline benchmark ([#771](https://github.com/torsday/omnifocus-mcp/issues/771)) gates PRs on canonical-workflow regressions; live telemetry surfaces production-only patterns the benchmark doesn't fixture.
- Per-tool invocation logging (`tool.invoked` / `tool.error`, [#283](https://github.com/torsday/omnifocus-mcp/issues/283)) emits one event per call with `durationMs`. Combined with response-byte telemetry, you can correlate slow tools with expensive responses.
- The `maxOutputBytes` cap ([#776](https://github.com/torsday/omnifocus-mcp/issues/776), planned) will measure post-truncation wire size — same metric, same aggregator.

## Default-valued field elision (#774)

Heavy read tools elide fields equal to their documented default to cut wire size on bulk reads. The full per-domain defaults table:

### Task

Omitted when at default; pass `verbose: true` to receive the full shape.

| Field | Default | Notes |
| --- | --- | --- |
| `flagged` | `false` | |
| `completed` | `false` | |
| `completedAt` | `null` | |
| `dropped` | `false` | |
| `droppedAt` | `null` | |
| `available` | `true` | Most active tasks are available; non-default = blocked or deferred. |
| `blocked` | `false` | |
| `sequential` | `false` | Parallel is the OF default. |
| `completedByChildren` | `false` | |
| `note` | `null` (also `""`) | |
| `noteHtml` | `null` (also `""`) | |
| `parentId` | `null` | |
| `tagIds` | `[]` | |
| `deferDate` | `null` | |
| `dueDate` | `null` | |
| `estimatedMinutes` | `null` | |
| `repetition` | `null` | |
| `projectId` | — | **Never elided** — null vs missing carries semantic weight (inbox vs unknown). |

### Project

| Field | Default |
| --- | --- |
| `flagged` | `false` |
| `completed` | `false` |
| `completedAt` | `null` |
| `dropped` | `false` |
| `droppedAt` | `null` |
| `note` | `null` (also `""`) |
| `noteHtml` | `null` (also `""`) |
| `folderId` | `null` |
| `tagIds` | `[]` |
| `status` | `"active"` |
| `completionCriterion` | `"parallel"` |
| `deferDate` | `null` |
| `dueDate` | `null` |
| `estimatedMinutes` | `null` |
| `reviewIntervalDays` | `null` |
| `nextReviewDate` | `null` |
| `lastReviewDate` | `null` |

### Tag

| Field | Default |
| --- | --- |
| `parentId` | `null` |
| `status` | `"active"` |
| `location` | `null` |
| `allowsNextAction` | `true` |

### Folder

| Field | Default |
| --- | --- |
| `parentId` | `null` |

The convention: an **absent** field means the default applies. A field present with `null` is "explicitly cleared" and is distinct from absent — for most response fields these are semantically equivalent and we elide both as the table indicates.

Tools that apply elision: `task_list`, `task_get`, `task_get_many`, `project_list`, `project_get`, `tag_list`, `tag_get`, `folder_list`, `folder_get`. Each accepts `verbose: true` to bypass elision and return the full shape — for debugging or for callers that haven't yet adopted the omission convention.

Inbox-triage benchmark: -27.3% on totalResponseBytes after default elision (on top of #775's note truncation savings).

## Related

- [DESIGN.md §21](../DESIGN.md) — observability contract
- [`docs/perf-setup.md`](perf-setup.md) — performance posture and configuration
- [#770](https://github.com/torsday/omnifocus-mcp/issues/770) — token-efficiency epic
- [#774](https://github.com/torsday/omnifocus-mcp/issues/774) — default-value elision
