---
description: Project-local override for the global `/issue` skill — supplies omnifocus-mcp's project board, label vocabulary, and field IDs.
---

This is a **thin override** for the global `/issue` skill (`~/.claude/skills/issue/SKILL.md`). Follow that skill's protocol; the values below replace its defaults where this project differs.

> [!IMPORTANT]
> **Use `scripts/file-issue.sh` — never `gh issue create` directly.** Raw `gh issue create` skips project-board membership, the Status field, and the `model:` label, producing issues that silently fall outside the Up Next queue. The script is the atomic filer the global skill expects; it validates flags, runs every wiring step, and verifies by re-reading the project item before exiting 0.

---

## The one command

```bash
./scripts/file-issue.sh \
  --title "<verb-first imperative>" \
  --body-file /tmp/issue-body.md \
  --type feature \                  # feature|bug|chore|refactor|perf|docs|test|infra|spike|epic
  --priority P1 \
  --size M \
  --phase M1 \
  --domain "tag,task" \
  --model opus \
  [--risk medium] \
  [--milestone "M1 Core surface"]  # derived from --phase if omitted \
  [--blocked]                       # only if Dependencies lists a blocker \
  [--modifier "tech-debt,security"] # orthogonal; any of: security, breaking-change,
                                    # regression, tech-debt, flaky, needs-repro
```

Capture the URL from stdout. Then run the global skill's post-return checklist (substituting the project values below).

---

## Project-local values

| What                | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| Owner               | `torsday`                                                 |
| Project number      | `4` (`torsday/omnifocus-mcp v1`)                          |
| Project node ID     | `PVT_kwHOAARNgc4BVGvQ`                                    |
| Status field naming | Status options were renamed: Ready→**Up Next**, Todo→**Backlog**. Six options total: `Backlog` · `Up Next` · `In Progress` · `In Review` · `On Hold` · `Done`. New issues land in `Up Next` unblocked, `Backlog` blocked. |

### Phase → Milestone mapping

`M0` foundation · `M1` core · `M2` metadata · `M3` advanced · `M4` long-tail · `M5` polish

`scripts/file-issue.sh` derives the milestone from `--phase` automatically; pass `--milestone` only to override.

### Domain vocabulary (project-specific — `--domain` accepts comma-separated)

`task` · `project` · `tag` · `folder` · `perspective` · `forecast` · `review` · `search` · `note` · `attachment` · `repetition` · `batch` · `export` · `sync` · `transport` · `observability` · `security` · `lifecycle` · `config` · `resources`

### Model labels — pick exactly one

| Value    | When                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opus`   | Sustained reasoning, judgment calls, ambiguous requirements, central design, ADRs, security-adjacent changes, error taxonomy, complex algorithms, large refactors, spikes, SPI work, tool descriptions |
| `sonnet` | Well-spec'd execution, CRUD, mapping layers, handler patterns following a template, validation gates, mechanical tests, infra/CI scripts, docs, small bug fixes                             |

`/next` and `/ship-next` filter the Up Next queue by active model so parallel Opus + Sonnet loop threads don't collide.

---

## Pre-return checklist (project-specific queries)

Re-run these even if `file-issue.sh` exited 0:

```bash
# Exactly one model label
gh issue view <N> --repo torsday/omnifocus-mcp --json labels \
  | jq '[.labels[] | select(.name|startswith("model: "))] | length'
# → 1

# On project #4
gh api graphql -f query='query{user(login:"torsday"){projectV2(number:4){items(first:100){nodes{content{...on Issue{number}}}}}}}' \
  | jq '.data.user.projectV2.items.nodes[] | .content.number' | grep -w <N>
# → <N>
```

If any check fails, stop and fix before reporting.

---

## Bulk / migration work

`scripts/populate-project.sh` re-runs label-driven field population across every issue in the repo (idempotent). Use it after adding a new Status/Phase/Priority/Size option, or to repair drift — **not** for single-issue filing. Single-issue filing always goes through `scripts/file-issue.sh`.

---

For the body template, classifier definitions (Type / Priority / Size), title style, "When NOT to file", and the general protocol — see the global skill: `~/.claude/skills/issue/SKILL.md`.
