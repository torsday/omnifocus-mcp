# Token-cost benchmark coverage matrix

> Living inventory of which tool categories the `pnpm bench:tokens` suite
> exercises. The bench gates PRs on response-bytes drift (≥ 5%, per
> [#822](https://github.com/torsday/omnifocus-mcp/issues/822)); its
> usefulness as a gate depends on whether the workflows actually touch
> the categories where regressions can hide.
>
> Filed under [#831](https://github.com/torsday/omnifocus-mcp/issues/831).
> Source workflows: `tests/benchmark/token-cost/workflows/`.

## Categories

The audit groups tools by *bytes shape* — what determines a response's
byte size, and therefore what kind of regression a workflow can detect.

| Category               | Bytes driver                                                                                  | Representative tools                                              |
|------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| **Read by id**         | Fixed shape; one envelope per call                                                            | `task_get`, `project_get`, `task_get_many` (small N)              |
| **List filtered**      | N matched × per-row payload + filter overhead                                                 | `task_list`, `project_list`, `folder_list`, `tag_list`            |
| **List paginated**     | `limit` × per-row payload + cursor codec                                                      | `task_list { limit, cursor }`, `task_get_many` (large N pages)    |
| **Search**             | N matched × per-row payload + whose() pushdown shape                                          | `task_search`, `task_find_similar`                                |
| **Forecast**           | Day rollups × tasks-by-date dedup overhead                                                    | `forecast_get`, `forecast_pack`                                   |
| **Perspective**        | Per-perspective filter cost + result-set bytes                                                | `perspective_evaluate`, `perspective_list`                        |
| **Batch mutation**     | Per-item success/failure × array length                                                       | `task_batch_create`, `task_batch_assign`, `task_batch_complete`   |
| **Single mutation**    | Fixed envelope; ID + status                                                                   | `tag_create`, `project_create`, `task_update`                     |
| **Review-cycle**       | Project list + per-project task list per ritual                                               | `review_list_due`, `project_mark_reviewed`                        |

## Coverage by workflow

`✓` = at least one call against this category in the workflow's bench
calls. `—` = no calls in that workflow against this category. Categories
that no workflow exercises are listed in the gap section below.

| Category            | inbox-triage | project-planning | weekly-review | end-of-day-review | large-pagination |
|---------------------|:------------:|:----------------:|:-------------:|:-----------------:|:----------------:|
| Read by id          | —            | ✓ (`project_get`) | —             | —                 | —                |
| List filtered       | ✓ (`task_list`) | ✓ (`task_list`) | ✓ (`task_list`) | —              | —                |
| List paginated      | —            | —                | —             | —                 | ✓ (`task_list`, 3 pages) |
| Search              | —            | —                | —             | ✓ (`task_search`) | —                |
| Forecast            | —            | —                | —             | ✓ (`forecast_get`)| —                |
| Perspective         | —            | —                | —             | ✓ (`perspective_evaluate`) | —       |
| Batch mutation      | ✓ (`task_batch_*`) | ✓ (`task_batch_*`) | —        | —                 | —                |
| Single mutation     | ✓ (`tag_create`) | ✓ (`*_create`) | —             | —                 | —                |
| Review-cycle        | —            | —                | ✓ (`review_*`) | —                 | —                |

## Status as of this audit

After [#831](https://github.com/torsday/omnifocus-mcp/issues/831),
[#1029](https://github.com/torsday/omnifocus-mcp/issues/1029), and
[#1030](https://github.com/torsday/omnifocus-mcp/issues/1030):

- `end-of-day-review` covers **search**, **forecast**, **perspective**.
- `large-pagination` covers **list paginated** (3-page walk via
  `task_list { limit: 50, cursor }` against a 120-task fixture).
- A **5k-fixture smoke runner** seeds the bench's in-memory adapter
  with ≥ 5000 tasks / 50 projects / 20 tags, then runs each
  workflow once and prints per-workflow wall-time. Invoke via
  `pnpm bench:tokens --smoke-5k`. `large-pagination` is excluded
  from smoke mode (its 3-page assertion can't survive the seeded
  surface).

## 5k smoke runner — how to use

```bash
pnpm bench:tokens --smoke-5k
```

Output is per-workflow: `wall=<ms>` next to the byte counts. Use to
eyeball perf regressions at scale before a release. No CI gate yet
— wall-time noise on shared CI runners needs a stability study
first; tracked as a follow-up below.

### Deferred from #1030

- **CI auto-budget gate**: AC item 2 from #1030 (fail CI if any
  workflow exceeds 2× empty-fixture baseline) is intentionally
  deferred. A wall-time gate that triggers on CI flake would burn
  more cycles than it saves; the gate design needs a stability
  dataset before flipping. Tracked separately.

## How a new workflow earns its place

A workflow belongs in the bench when:

1. It exercises at least one category the existing workflows don't, or
2. It exercises a known-hot path (e.g. cache-fragmenting params, large
   pagination windows) where regressions have shipped historically.

Workflows that overlap existing coverage without a distinct shape add
test cost without adding gate sensitivity — keep the suite tight.

Each new workflow file lives under
`tests/benchmark/token-cost/workflows/<name>.ts` and is registered in
`tests/benchmark/token-cost/cli.ts`. Snapshot reset via
`pnpm bench:tokens --update`; CI re-runs against the committed baseline.
