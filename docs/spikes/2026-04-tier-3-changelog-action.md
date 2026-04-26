# Spike — Tier 3 Claude-enhanced CHANGELOG action

**Date:** 2026-04-26
**Issue:** [#432](https://github.com/torsday/omnifocus-mcp/issues/432)
**Outcome:** **Don't build it.** Manual `/release-notes` polish stays the canonical pattern.

## Question

After release-please landed (#427), every release follows a two-layer pattern:

1. release-please writes the *floor* — mechanical CHANGELOG entries grouped by Conventional Commit type.
2. The maintainer optionally polishes via `/release-notes` to rewrite the auto-bullets as user-facing narrative — the *ceiling*.

The spike's question: would automating step 2 (a "Tier 3" GitHub Action calling the Anthropic API on Release PR open / update, committing polished CHANGELOG into the PR) pull its weight against the existing manual flow?

## Premise revision

The original ticket asked for ≥3 release-please-driven releases of observation data before deciding. That gate was a placeholder for "don't decide blind." After v1.0.1 — the first release under the new flow — the maintainer asked to make the call now. The ≥3-release threshold gives more data points but doesn't change the structural tradeoffs, which are knowable today. Spike is run with one polished release of empirical data plus a clear-eyed read of the structural constraints.

## Data point: v1.0.1 polish (2026-04-26)

| Dimension | Observation |
|---|---|
| Auto-draft accuracy | Correct. Five `docs:` commits grouped under `### Documentation` with one-line summaries linking commit SHAs and PR numbers. No factual errors. |
| Polish time | ~10 minutes including discovery (read commit bodies, draft prose, validate links, run `extract-changelog-section.sh`, commit + push) |
| Quality delta | Substantial. Polish replaced terse bullets like *"post-1.0 audit — refresh stale 'in preparation' framing"* with multi-sentence entries explaining context, technical detail, and impact. The polished `[1.0.1]` block matches the verbose v1.0.0 block's prose style; auto-draft did not. |
| Effort *worth* it for this release? | Yes — five user-visible doc improvements warranted the investment. Released artifact's GitHub Release body reads as engineering work, not a commit log. |
| Counterfactual: skip polish | Auto-draft would have shipped. Technically accurate, much terser. Acceptable for chore-only releases; mediocre for releases with `feat:` / `fix:` / `docs:` entries. |

## Structural tradeoffs

### Option A — Don't automate (status quo, manual `/release-notes`)

**Pros:**

- Zero operational surface beyond what already exists. `/release-notes` lives in `~/.claude/skills/`; the maintainer invokes it during the release ritual via `/release` (which already documents this step).
- The polish happens with the maintainer's full context — they read what's about to ship and either accept the auto-draft, polish, or skip the polish entirely. Skip-the-polish is a valid choice (chore-only releases) that automation can't decide for you.
- No new repo secret. No external API call from CI infrastructure. No new failure mode (API down ≠ release blocked).
- No per-release cost. (Tier 3's per-run API spend is small per absolute number — pennies — but it's recurring.)

**Cons:**

- Requires a Claude Code session at release time. Mild friction for solo maintainer; significant friction if the release machine is different from the dev machine, or if the maintainer is delegating releases.
- Consistency depends on the maintainer remembering to polish. The local `/release` skill documents it but a hurried release could ship unpolished.

### Option B — Tier 3 GitHub Action

**Pros:**

- Polish happens automatically; maintainer reviews + edits the auto-polish before merge.
- Consistent prose quality across releases regardless of who's running them.
- Easier handoff to a future maintainer (no Claude Code skill setup required).

**Cons:**

- New repo secret (`ANTHROPIC_API_KEY`). Adds rotation burden + leak surface.
- Per-run cost (~$0.05–0.20 per release at current API pricing for the relevant context size). Small in absolute terms; non-zero monthly even on a low-cadence repo.
- New failure mode: API outage or rate limit during a release attempt produces an empty / partial CHANGELOG draft. The Release PR might merge with sub-par notes if the maintainer doesn't notice the auto-polish was missing.
- Less human review of prose. Auto-polish committed by the action is one extra layer of "did I really read this?" — easy to rubber-stamp.
- Workflow complexity. Token rotation, prompt versioning, model upgrades all become Release Engineering concerns.

### Option C — Local `pnpm changelog:polish` script

**Pros:**

- Same model output as `/release-notes` but inline with the rest of `pnpm` commands. Composable into existing release ritual.
- API key stays local (env var or 1Password); no GitHub Actions secret.
- Same human-review property as A — maintainer reads + approves before commit.

**Cons:**

- Still requires a local API key, just not in CI.
- Duplicates `/release-notes`'s logic in a project-specific script. Drift risk (skill improves; script doesn't, or vice versa).
- Doesn't solve the "remembering to polish" concern any better than A.

## Decision

**Option A. Don't automate.**

Three reasons:

1. **The manual flow is fast.** ~10 min including discovery for a five-entry release. At ~6 releases/year on a solo project (informed estimate; this project has ~1/week velocity in early phase, will slow), that's ~1 hour/year of polish work. Automation that costs operational surface to save 1 hour/year is the wrong trade.
2. **The skip-the-polish decision can't be automated.** Tier 3 would polish every Release PR. Half the time that's wasted compute (chore-only releases need no polish). The maintainer's read of "is this user-facing?" is a judgment call the action can't make.
3. **Solo maintainer with strong existing skill.** The biggest argument for Tier 3 is "future maintainers won't know to polish" — but contributing is closed (per #437); there are no future maintainers to onboard. If the contributing stance flips later, revisit this decision then.

The strongest counter-argument is "you'll forget to polish on a hurried release." Mitigation: `/release` skill explicitly prompts polish-vs-skip and provides the decision tree. The next maintainer to inherit this project will read the skill before cutting a release; if they want automation at that point, they can revisit this spike.

## Actions

- Close #432 with this spike note as the resolution.
- No code changes. Manual flow stays the canonical pattern.
- No follow-up issues. If the manual flow becomes painful (e.g., release cadence increases 5×, contributing stance flips, polish quality regresses), open a new issue citing this spike note.

## References

- [#432](https://github.com/torsday/omnifocus-mcp/issues/432) — the spike issue
- [`~/.claude/skills/release-notes/SKILL.md`](https://github.com/torsday/llm_prompts) — the manual polish skill
- `~/.claude/skills/release/SKILL.md` — the release skill that invokes polish
- [v1.0.1 CHANGELOG entry](../../CHANGELOG.md#101-2026-04-26) — empirical example of polished output
