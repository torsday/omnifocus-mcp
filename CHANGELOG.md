# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

## [1.1.0](https://github.com/torsday/omnifocus-mcp/compare/v1.0.2...v1.1.0) (2026-04-28)


### Added

* **app:** add app_window_new and app_window_new_tab ([#527](https://github.com/torsday/omnifocus-mcp/issues/527)) ([#558](https://github.com/torsday/omnifocus-mcp/issues/558)) ([15227bc](https://github.com/torsday/omnifocus-mcp/commit/15227bc33b610a165170294bca88d70ae0f1cb38))
* **database:** add database_undo / database_redo for agent error recovery ([#544](https://github.com/torsday/omnifocus-mcp/issues/544)) ([10d460d](https://github.com/torsday/omnifocus-mcp/commit/10d460d3b56fc9afa674b6ced0499ed9a59bee5b))
* **dates:** wire deferDateFloating/dueDateFloating through all date-bearing tools ([#514](https://github.com/torsday/omnifocus-mcp/issues/514)) ([d34eefb](https://github.com/torsday/omnifocus-mcp/commit/d34eefb1b2aef2822ce66ef33f5d2f27d310961e)), closes [#462](https://github.com/torsday/omnifocus-mcp/issues/462)
* **envelope:** add hints[] array to ok responses (ADR-0015) ([6aca020](https://github.com/torsday/omnifocus-mcp/commit/6aca02042e25490560d2fb7206b354641330ebe3))
* **envelope:** add humanReadableSummary to every write-tool response ([d82d069](https://github.com/torsday/omnifocus-mcp/commit/d82d06922c6f3962726d15e219d9a8ace693da34))
* **forecast:** add forecast_pack — time-budget reconciliation ([4bb7890](https://github.com/torsday/omnifocus-mcp/commit/4bb7890ff5e3870d4f7d26f812c76a94f1bd68f4)), closes [#473](https://github.com/torsday/omnifocus-mcp/issues/473)
* **forecast:** expose forecast-tag preference (get + set) ([4531611](https://github.com/torsday/omnifocus-mcp/commit/4531611418fe90fdbfbaea52f4b93760d53ff0d6)), closes [#465](https://github.com/torsday/omnifocus-mcp/issues/465)
* **nl-quality:** forgiving aliases for status / completion-criterion enums ([2e7e6ba](https://github.com/torsday/omnifocus-mcp/commit/2e7e6ba15f74e90fdf9ba7bfd478054aa71169c0)), closes [#573](https://github.com/torsday/omnifocus-mcp/issues/573)
* **nl-quality:** pair name with id in forecast_get_tag / forecast_set_tag ([bdbd87a](https://github.com/torsday/omnifocus-mcp/commit/bdbd87af80221ff27fc52332524be8937c7ba5a0)), closes [#599](https://github.com/torsday/omnifocus-mcp/issues/599)
* **nl-quality:** pair name with id in note_append / note_set / note_set_html ([#606](https://github.com/torsday/omnifocus-mcp/issues/606) slice 2) ([22313d9](https://github.com/torsday/omnifocus-mcp/commit/22313d99bb844102213dce0d6646b1da5f9cc970))
* **nl-quality:** pair name with id in project-batch responses ([#592](https://github.com/torsday/omnifocus-mcp/issues/592) Group B) ([d367fbb](https://github.com/torsday/omnifocus-mcp/commit/d367fbbc26c7c07e02b18fed425a0efcacb4a26a))
* **nl-quality:** pair name with id in project-verb responses ([#585](https://github.com/torsday/omnifocus-mcp/issues/585) slice) ([aa94f22](https://github.com/torsday/omnifocus-mcp/commit/aa94f22cc8a6bee70afb4689129545da64d549c3))
* **nl-quality:** pair name with id in remaining task-batch verbs ([#597](https://github.com/torsday/omnifocus-mcp/issues/597)) ([20d8336](https://github.com/torsday/omnifocus-mcp/commit/20d8336b65e97896d471220edef2449fad7bda84))
* **nl-quality:** pair name with id in task creates/convert/duplicate ([#590](https://github.com/torsday/omnifocus-mcp/issues/590) Group A) ([aba0b35](https://github.com/torsday/omnifocus-mcp/commit/aba0b35bfdf41106857c36a2ad4d594d41d8eff6))
* **nl-quality:** pair name with id in task-batch lifecycle responses ([978899d](https://github.com/torsday/omnifocus-mcp/commit/978899d6b45644a0f510cb68e124ea6e34c07793)), closes [#594](https://github.com/torsday/omnifocus-mcp/issues/594)
* **nl-quality:** pair name with id in task-verb responses ([#572](https://github.com/torsday/omnifocus-mcp/issues/572) slice) ([5272054](https://github.com/torsday/omnifocus-mcp/commit/5272054c0445f60ee628c0e444baac715bcb27cf))
* **nl-quality:** pair owner name with id in attachment_add / attachment_remove ([27f5efc](https://github.com/torsday/omnifocus-mcp/commit/27f5efca3326e8f39fa7a7c01e7b92baa2fe2c53))
* **nl-quality:** wire zodToActionable at handlers with refined input schemas ([e93f781](https://github.com/torsday/omnifocus-mcp/commit/e93f7817a40991ac6b88a645e426a3798dc01f17)), closes [#575](https://github.com/torsday/omnifocus-mcp/issues/575)
* **perspective:** add perspective_get and perspective_delete ([0c31f7d](https://github.com/torsday/omnifocus-mcp/commit/0c31f7d7eea3e74f4e9e931b0546ef903eda1348))
* **project:** project_template_instantiate (parameter substitution + relative-date shifting) ([f83f427](https://github.com/torsday/omnifocus-mcp/commit/f83f42705b49562e77a39477afc81661abf7bbe7))
* **project:** project_template_save + project_template_list (first slice of [#472](https://github.com/torsday/omnifocus-mcp/issues/472)) ([590f1a1](https://github.com/torsday/omnifocus-mcp/commit/590f1a12dcda8b6cac9d84dffdd30dcf326e5154))
* **prompts:** add inbox-triage prompt + task_batch_assign tool ([#539](https://github.com/torsday/omnifocus-mcp/issues/539)) ([26ef26d](https://github.com/torsday/omnifocus-mcp/commit/26ef26dd425395182c0e66f9e75e66800cd7d21e))
* **repetition:** add repetition_from_prose deterministic helper ([#535](https://github.com/torsday/omnifocus-mcp/issues/535)) ([f9abf49](https://github.com/torsday/omnifocus-mcp/commit/f9abf492a10e1c450b5ea5d56ea7caf5b6d8358a))
* **resources:** add omnifocus://intents — eighty tools, eight verbs ([#530](https://github.com/torsday/omnifocus-mcp/issues/530)) ([ed6a78d](https://github.com/torsday/omnifocus-mcp/commit/ed6a78d7897902f4a241ca1f50983d38e6b849f2))
* **resources:** add omnifocus://project-health stalled-project triage ([#534](https://github.com/torsday/omnifocus-mcp/issues/534)) ([d6ec05b](https://github.com/torsday/omnifocus-mcp/commit/d6ec05b644e7cae0242ce3f3d6b7fd785fa649ee))
* **resources:** add omnifocus://recent-activity session-priming resource ([#505](https://github.com/torsday/omnifocus-mcp/issues/505)) ([88c2607](https://github.com/torsday/omnifocus-mcp/commit/88c26071c0539e182d22c0c3cc95671c86d33e6d))
* **resources:** add omnifocus://retrospective range resource ([9642a0b](https://github.com/torsday/omnifocus-mcp/commit/9642a0bf44a5eecb6de23b08c3befda920343fe0)), closes [#474](https://github.com/torsday/omnifocus-mcp/issues/474)
* **resources:** add omnifocus://stats database statistics resource ([#533](https://github.com/torsday/omnifocus-mcp/issues/533)) ([2c8fe97](https://github.com/torsday/omnifocus-mcp/commit/2c8fe97c445601ded73857598fefab01b814b5ad))
* **resources:** add omnifocus://taxonomy-audit collision detector ([#509](https://github.com/torsday/omnifocus-mcp/issues/509)) ([8afc6b3](https://github.com/torsday/omnifocus-mcp/commit/8afc6b33012ae2353a747b109d754c5f5b376523)), closes [#470](https://github.com/torsday/omnifocus-mcp/issues/470)
* **resources:** add velocity + burndown analytics resources ([#513](https://github.com/torsday/omnifocus-mcp/issues/513)) ([27c0ed2](https://github.com/torsday/omnifocus-mcp/commit/27c0ed2b9f0c79980cb57d58219b40f7dc04e94d))
* **review:** add project_set_next_review_date ([d8ca689](https://github.com/torsday/omnifocus-mcp/commit/d8ca689d17b49f5b0eb47518a7a437508726e36d)), closes [#467](https://github.com/torsday/omnifocus-mcp/issues/467)
* **task:** add task_convert_to_project via Database.convertTasksToProjects ([ea7542a](https://github.com/torsday/omnifocus-mcp/commit/ea7542ade50924c38bdb164ee23d448e45305706))
* **task:** add task_extract_from_image vision capture tool ([#486](https://github.com/torsday/omnifocus-mcp/issues/486)) ([540a63a](https://github.com/torsday/omnifocus-mcp/commit/540a63aa56166faa0952cf5f5f67cec0ced216dc))
* **task:** add task_extract_from_note prose-to-tasks extractor ([#536](https://github.com/torsday/omnifocus-mcp/issues/536)) ([a2fed5b](https://github.com/torsday/omnifocus-mcp/commit/a2fed5b6a5c486689286383293fcf61d0c3ce22d))
* **task:** add task_find_similar lexical-similarity helper ([#543](https://github.com/torsday/omnifocus-mcp/issues/543)) ([41a645b](https://github.com/torsday/omnifocus-mcp/commit/41a645b72e960ca818d20c238db99c68a8208c5a))
* **task:** add task_reclassify with mandatory dry-run ([#545](https://github.com/torsday/omnifocus-mcp/issues/545)) ([7a2da90](https://github.com/torsday/omnifocus-mcp/commit/7a2da90c392cbb158ed2c98f175c56c214b9231f))
* **task:** add task_set_alarms / task_clear_alarms tools ([#461](https://github.com/torsday/omnifocus-mcp/issues/461)) ([#552](https://github.com/torsday/omnifocus-mcp/issues/552)) ([6920343](https://github.com/torsday/omnifocus-mcp/commit/69203436ac4d808db6a18c6b82b641dea6662b06))
* **task:** waiting-on tracking via fenced note metadata ([3a8c6e7](https://github.com/torsday/omnifocus-mcp/commit/3a8c6e7b7751d2247cf550133af60d3d7609732c))
* **task:** wire task_convert_to_project through adapter + router layers ([e37993e](https://github.com/torsday/omnifocus-mcp/commit/e37993ed25c3fd4bd5492b4cb9a500fb2366a081))
* **tools:** add *_describe preview tools for every write operation ([a12fc0c](https://github.com/torsday/omnifocus-mcp/commit/a12fc0cb5cbb80a4419ff1b6c5e8c3680352e843)), closes [#494](https://github.com/torsday/omnifocus-mcp/issues/494)
* **transport:** expose front-window perspective + focus controls ([40bd197](https://github.com/torsday/omnifocus-mcp/commit/40bd19704d008d53e1440a042a327fb9ec752ded)), closes [#466](https://github.com/torsday/omnifocus-mcp/issues/466)


### Fixed

* **domain/ids:** accept dotted IDs from repeating-task instances ([83e9060](https://github.com/torsday/omnifocus-mcp/commit/83e906014966b128896ca36715c500bede157a6c)), closes [#497](https://github.com/torsday/omnifocus-mcp/issues/497)
* **export:** partitionTasksByParent treats project-rooted tasks as roots ([#503](https://github.com/torsday/omnifocus-mcp/issues/503)) ([7ac8ce2](https://github.com/torsday/omnifocus-mcp/commit/7ac8ce22b89ae688ebf6e49b85aee08de3fdf3ca)), closes [#499](https://github.com/torsday/omnifocus-mcp/issues/499)
* **jxa:** guard creationDate/modificationDate against can't-get-object errors ([a518f36](https://github.com/torsday/omnifocus-mcp/commit/a518f36c02f02e6bcffdf506235cf5e57aaa4aca)), closes [#498](https://github.com/torsday/omnifocus-mcp/issues/498)
* **jxa:** tag_list/folder_list filter checks treat null as no-filter ([9c1d601](https://github.com/torsday/omnifocus-mcp/commit/9c1d6014de33ef028ba729183d9d8b2302902813)), closes [#515](https://github.com/torsday/omnifocus-mcp/issues/515)
* **lint:** use ProjectIdCtor.of() instead of ID cast in convertTaskToProject ([a50c06d](https://github.com/torsday/omnifocus-mcp/commit/a50c06d4f162757912e1e82f38593a5a8c3d61ad))
* **nl-quality:** add Example: lines to waitingOn descriptions ([16b926c](https://github.com/torsday/omnifocus-mcp/commit/16b926c2f54e5af5fb76ad46c0342e134638c1e4))
* **nl-quality:** move audit to docs/validation, drop tool-count prose ([31335c4](https://github.com/torsday/omnifocus-mcp/commit/31335c4b699f0887bcaa5226e9723c510925000e))
* **task:** trim task_extract_from_image strings to fit bundle budget ([35a2592](https://github.com/torsday/omnifocus-mcp/commit/35a2592d24e955912666386088a6fb3427bb73f8))
* **tools:** import order + describe tool snapshots ([35f822d](https://github.com/torsday/omnifocus-mcp/commit/35f822d5cb28dcdc9657209472f59d7cf4b5540a))


### Performance

* **forecast_get:** push every bucket filter into whose() — ~50x speedup ([#529](https://github.com/torsday/omnifocus-mcp/issues/529)) ([b3416b7](https://github.com/torsday/omnifocus-mcp/commit/b3416b77bcb0d52bed1542cffb566411c9db0525)), closes [#500](https://github.com/torsday/omnifocus-mcp/issues/500)


### Changed

* **test:** replace magic-number toHaveLength with named-resource checks ([d13ab9a](https://github.com/torsday/omnifocus-mcp/commit/d13ab9ad5d53aeb2c3d12831c3cf013144f74173)), closes [#512](https://github.com/torsday/omnifocus-mcp/issues/512)


### Documentation

* **adr:** 0018 calendar bridge — EventKit only, Swift-binary subprocess ([b83d440](https://github.com/torsday/omnifocus-mcp/commit/b83d440882dd108bf9c4f1c04ec28e7b0430956a))
* **adr:** add ADR-0015 — NL-excellence response envelope ([#524](https://github.com/torsday/omnifocus-mcp/issues/524)) ([e0d5b1d](https://github.com/torsday/omnifocus-mcp/commit/e0d5b1d11c229eb4775ce2ab2bc5e5c50f42b69e))
* **adr:** add ADR-0017 — mutation testing as release gate ([#528](https://github.com/torsday/omnifocus-mcp/issues/528)) ([e8ec2ac](https://github.com/torsday/omnifocus-mcp/commit/e8ec2acf3f4c748dc476b98dca611ccc235cd054))
* **clients:** add OpenCode and Pi setup guides ([#559](https://github.com/torsday/omnifocus-mcp/issues/559)) ([#560](https://github.com/torsday/omnifocus-mcp/issues/560)) ([29022d0](https://github.com/torsday/omnifocus-mcp/commit/29022d01896471d95419caa4271f6322eec73bb2))
* **contributing:** note that the dev MCP doesn't hot-reload from dist ([0bee39f](https://github.com/torsday/omnifocus-mcp/commit/0bee39f10ebcb8334668bd8282ec358a83d192cf))
* **design:** drop tool-count from bundle-budget rationale ([d812671](https://github.com/torsday/omnifocus-mcp/commit/d812671f10261c77c4e9605956d6d18805a56069))
* **perspective:** drop stale "mutations not supported" comment ([d66e09b](https://github.com/torsday/omnifocus-mcp/commit/d66e09b3d74f19b50c7df2a44287e167f51b3662))
* **readme:** genericize version-specific references ([dbde992](https://github.com/torsday/omnifocus-mcp/commit/dbde9923f436cd2473204bd11cebe185199a6fb3))
* regenerate tools.md to include task_convert_to_project ([2f48911](https://github.com/torsday/omnifocus-mcp/commit/2f489116d807083c81a504abfbe3acd8c10bebfa))
* **spike:** bundle-size strategy — measure, evaluate, recommend ([fe00c76](https://github.com/torsday/omnifocus-mcp/commit/fe00c769b309b723615c7146c75e1fadba3b9240)), closes [#578](https://github.com/torsday/omnifocus-mcp/issues/578)
* **spike:** reword tool-count phrasings to satisfy meta-lint ([d0d768b](https://github.com/torsday/omnifocus-mcp/commit/d0d768b9e2ad238e9590334f81eb3bb622217f6f))
* stop restating tool counts in living docs — defer to omnifocus://capabilities ([dce3ad0](https://github.com/torsday/omnifocus-mcp/commit/dce3ad042b5168312cd43b0aa6e9a1d481a0dfaf)), closes [#478](https://github.com/torsday/omnifocus-mcp/issues/478)

## [1.0.2](https://github.com/torsday/omnifocus-mcp/compare/v1.0.1...v1.0.2) (2026-04-26)

**Summary** — One contributor-facing fix and one architectural-decision spike note; otherwise an internal-infrastructure release validating the post-v1.0.1 release flow under the new release-please + OIDC + PAT identity. **Bytes on the wire are identical to v1.0.1**: the published bundle, tool surface, tool descriptions, and runtime behaviour are unchanged. Consumers running `npx -y @torsday/omnifocus-mcp` see no difference. Internal-only commits (CI hygiene, release-please workflow tuning, comment-block cleanups) are intentionally hidden from this CHANGELOG by `release-please-config.json` and are not enumerated below.

### Fixed

- **`scripts/seed-integration-db.js` runs under ESM** — `package.json` declares `"type": "module"`, so every `.js` file is interpreted as ESM by Node. The seed script was the lone holdout still using CommonJS `require()` and threw `ReferenceError: require is not defined in ES module scope` at the first line of execution. One-line conversion: `const { spawnSync } = require("node:child_process")` → `import { spawnSync } from "node:child_process"`. Affects only contributors running `pnpm test:integration` locally or the `integration.yml` workflow on `mac-local`; the published package's runtime is unchanged. ([#448](https://github.com/torsday/omnifocus-mcp/issues/448))


### Documentation

- **Tier-3 CHANGELOG-action spike resolved — don't automate** — `docs/spikes/2026-04-tier-3-changelog-action.md` records the decision: stick with the existing manual `/release-notes` polish flow rather than building a GitHub Action that auto-polishes the Release PR via the Anthropic API. Three structural reasons in the note: ~10 min/release × ~6 releases/year is roughly 1 hour/year of polish work — automation that adds operational surface (new repo secret, rotation burden, API outage as a release-block failure mode) to save 1 hour/year is the wrong trade; the skip-the-polish decision (chore-only releases need no polish) requires maintainer judgment that an action can't make; and with a Closed contributing stance there are no future maintainers to onboard. Empirical anchor: v1.0.1's polish — the first release under release-please — showed substantial quality delta from auto-draft to polished prose at acceptable manual cost. ([#432](https://github.com/torsday/omnifocus-mcp/issues/432))

## [1.0.1](https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...v1.0.1) (2026-04-26)

**Summary** — Documentation polish pass. The README, SPEC, DESIGN, and `docs/project-views.md` are now aligned with the post-v1.0.0 reality of the project (public, shipped, npm-published) rather than the pre-1.0 framing they carried at v1.0.0's tag. Quick Start is restructured so every supported MCP client — not only Claude Desktop — gets equal-footing setup instructions; a new agent-readable Security & trust section surfaces the existing threat-model guarantees with file-level enforcement references. No behavioural or API changes: bytes on the wire, tool surface, and tool descriptions are identical to v1.0.0.

### Fixed

- **PR-title lint allows periods inside the subject** — the bash port of [`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request)'s `subjectPattern` in `pr-title.yml` was stricter than the original. `[^.]*` in the middle banned every period, so release-please's auto-PRs with version numbers in the title (e.g. `chore(main): release 1.0.1`) failed lint. The middle is now `.*`; only the trailing character is constrained to non-period and non-space. Behaviour matches the original action. ([6170320](https://github.com/torsday/omnifocus-mcp/commit/6170320ea72bfb0e71444d1685e29a02d47eec3d))

### Documentation

- **README — agent-agnostic Quick Start with per-client matrix** — Quick Start step 2 leads with the universal `command + args + env` shape, then surfaces a per-client matrix as expandable `<details>` blocks (alphabetical: Claude Code, Claude Desktop, Cline, Codex, Cursor, Windsurf, Generic). Each block names the file path and serialization (JSON vs TOML). Previous flow led with Claude Desktop and treated other clients as a "any MCP client uses the same shape" footnote — the new flow makes finding your client a one-line scan of the `<summary>` headers. New `docs/clients/codex.md` mirrors the structure of the existing `claude-code.md` / `claude-desktop.md` / `generic-stdio.md` guides (prerequisites, install, config snippet, verification, Automation permission, env vars, troubleshooting). The setup-guide table at the bottom of the README now includes Codex and is alphabetised. ([#433](https://github.com/torsday/omnifocus-mcp/issues/433))

- **README — Security & trust section** — new top-level section between Quick Start and Example interactions (~70 lines, well inside the 60–100-line target). Every guarantee links to enforcement code or file evidence: the no-network-import lint rule (`src/linting/customRules.ts` Rule 4), the `installStdoutGuard()` contract test (`src/server/stdoutGuard.test.ts`), the prod dependency list (`package.json` — six packages, no analytics SDK, no `postinstall`/`preinstall` lifecycle scripts), `redactConfig` (`src/config/env.ts`), and `assertAttachmentPath` (`src/attachment/assertAttachmentPath.ts`). Three "verify it yourself" recipes — source audit, Sigstore attestation via `npm view dist.attestations`, and tarball file-count via `npm view dist.tarball | tar -tzvf -`; the recipe's expected file count was verified against the actually-published v1.0.0 artifact (5 files: `LICENSE`, `dist/index.js`, `package.json`, `CHANGELOG.md`, `README.md`). The opt-in `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` escape hatch is enumerated by name with audit-log behaviour and ADR-0004 cited. ([#422](https://github.com/torsday/omnifocus-mcp/issues/422))

- **README + SPEC + DESIGN — refreshed post-1.0 framing** — README "Status and roadmap" lead replaced "v1.0.0 is in preparation for npm release" with shipped-state framing that links the [npm package](https://www.npmjs.com/package/@torsday/omnifocus-mcp), the [Project board](https://github.com/users/torsday/projects/4), and the `[Unreleased]` CHANGELOG section. SPEC.md front-matter changed from `Status: Draft — assumptions flagged for review` to `Status: v1.0 — locked` with the explicit note that future scope changes route through ADRs, not edits to that file. DESIGN.md front-matter from `Status: v1 Draft — design-complete, implementation-ready` to `Status: v1.0 — implemented and shipped 2026-04-25`. `docs/project-views.md` status enum updated from the old six-state list (`Ready · Todo · In Progress · In Review · Blocked · Done`) to the canonical current six (`Backlog · Up Next · In Progress · In Review · On Hold · Done`); the frozen pre-1.0 issue count was removed. ([#425](https://github.com/torsday/omnifocus-mcp/issues/425))

- **README — CI status badge** — adds a status badge for the `main` branch's CI workflow at the top of the README. A glance at the repo's GitHub page now shows whether `main`'s last run is green without clicking through to the Actions tab. ([#438](https://github.com/torsday/omnifocus-mcp/pull/438))

- **`docs/runner-setup-macos-omnifocus.md` — new self-hosted runner setup guide** — step-by-step setup for the `macos-omnifocus` runner that hosts the integration test workflow, including how to launch OmniFocus on user-session start (LaunchAgent) so tag-pushed integration runs don't fail with the "OmniFocus is not running" preflight error. Pairs with the integration-fixture seed step landed in #426. ([#443](https://github.com/torsday/omnifocus-mcp/pull/443))

## [Unreleased]

### Added

- **`perspective_get` — read a custom perspective's full configuration** — returns `{ id, name, aggregation, rules, iconColor }` for a custom perspective by identifier. Surfaces the structured rule tree (`archivedFilterRules`) so agents can introspect what a perspective filters on without evaluating it. Routes via OmniJS — JXA exposes only `id`/`name`/`class` on perspective specifiers. Built-in perspective ids are rejected with a typed validation error since they have no rule tree. Custom perspectives require OmniFocus Pro. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **`perspective_delete` — delete a custom perspective by id** — removes a custom perspective via OmniJS `deleteObject` (JXA cannot delete custom perspectives). Built-in perspectives are rejected with a typed validation error. The tool invalidates the `perspective:*` cache scope so subsequent `perspective_list` reads return fresh state. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **Waiting-on tracking — synthetic dependencies via note fence** — new `task_set_waiting_on` and `task_clear_waiting_on` tools tag a task with the configured `@waiting` tag (created if absent; name configurable via `OMNIFOCUS_WAITING_TAG_NAME`, default `waiting`) and write/strip a fenced YAML metadata block (` ```waiting-on … ``` `) at the top of the task note. The fence preserves any existing user prose. `task_get` and `task_get_many` parse the fence and surface a structured `waitingOn: { whom, what?, since, followUpAfter? }` field on the response. New `omnifocus://waiting-on` resource aggregates every active task with a fence, sorted by `daysOverdue` descending (whole days past `followUpAfter`; `null` when unset or still in the future). Designed to systematize follow-ups OmniFocus has refused to model for a decade. ([#482](https://github.com/torsday/omnifocus-mcp/issues/482))
- **Project templates — first slice (`save` + `list`)** — new `project_template_save` captures a project's task tree as TaskPaper into a new project under the configured `Templates` folder (env `OMNIFOCUS_TEMPLATES_FOLDER_NAME`, default `Templates`). Metadata (template name, parameter names, capturedAt) sits in a fenced `project-template` YAML block at the top of the template-project's note; the TaskPaper body sits below. The Templates folder is created lazily on first save. `project_template_list` enumerates every parseable template under that folder (sorted by capturedAt desc, name tiebreak). Duplicate template names within the folder are rejected with a typed `TemplateExists` error. Convention documented in DESIGN.md §30. `project_template_instantiate` (parameter substitution + relative-date shifting) and `project_template_delete` are intentionally out of scope this cycle and filed as follow-ups. ([#472](https://github.com/torsday/omnifocus-mcp/issues/472))
- **`project_template_instantiate` — spawn a project from a saved template** — resolves a template by name within the configured Templates folder, validates that every recorded parameter has a value supplied (reports every missing name in one `MissingTemplateParameter` error), substitutes `{{name}}` placeholders, and shifts every `@due`/`@defer` date by the delta between the template's earliest `@due` and the supplied `dueDate`. Pre-creates the target project (optional `targetFolderId`, default library root) and hands the modified TaskPaper to the existing `importTaskPaper` flow. Returns `{ projectId, taskCount, importWarnings }`. Templates without an `@due` to anchor on instantiate as-is when `dueDate` is supplied (no error — there's nothing to shift). DESIGN §30 expanded with the substitution + anchor rules. ([#587](https://github.com/torsday/omnifocus-mcp/issues/587))

### Documentation

- **ADR-0018 — Calendar bridge: EventKit only, Swift-binary subprocess** — formalises the architecture that unblocks [#484](https://github.com/torsday/omnifocus-mcp/issues/484) (calendar + agenda resources). Decisions: EventKit is the sole calendar substrate (third-party APIs handled by separate MCP servers, composed at the agent layer); access via a tiny Swift binary subprocess bundled in `dist/` (rejecting JXA/Calendar.app shim and direct Node FFI for documented reasons); read-only; permission UX mirrors the existing OF Automation prompt. Status: Accepted. ([#603](https://github.com/torsday/omnifocus-mcp/issues/603))

---

## [1.0.0] — 2026-04-25

**Summary** — First public release of `@torsday/omnifocus-mcp`. Ships the full MCP surface for OmniFocus on macOS: 80 typed tools, 10 read-only resources, and 4 workflow prompts. Every tool returns the uniform `{ data, meta } | { error, meta }` envelope per ADR-0013, with typed errors carrying `suggestion` and `remediationClass`. Mutation tools support optimistic concurrency (`expectedModifiedAt`), dry-run preview, and idempotency keys. A live database watcher drives targeted cache invalidation.

**Install**

```jsonc
// Claude Desktop or Claude Code MCP config
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp@1.0.0"]
    }
  }
}
```

Verify with `npx -y @torsday/omnifocus-mcp@1.0.0 --version`.

**Compatibility** — Node 24+ • macOS 12+ (Monterey, Ventura, Sonoma, Sequoia) • OmniFocus 4.x • MCP protocol 2024-11-05

### Tool surface (80 tools)

Full catalog with parameter tables and example responses: [`docs/tools.md`](./docs/tools.md).

- **Tasks** — list, get, get-many, search (cursor-paginated; optional keyword plus `available` / `dueBefore` / `dueAfter` / tag / project filters), create, update, complete, uncomplete, drop, undrop, delete (requires `confirm: true`), move, reorder, duplicate, batch create / update / complete / delete / drop
- **Projects** — list, get, get-many, create, update, delete, move, set-status, review-set
- **Tags** — list, get, get-many, create, update, delete
- **Folders** — list, get, create, update, delete
- **Perspectives** — list, evaluate (seven built-ins; OmniFocus Pro custom perspectives via OmniJS)
- **Forecast** — get (`date` + `days` ergonomic interface, or raw `from`/`to` range; multi-day responses include `byDate[]`)
- **Review** — list-due, mark-reviewed
- **Notes** — get, set, append
- **Attachments** — list, add, get, remove (path-validated against `OMNIFOCUS_ATTACHMENT_PATHS`)
- **Sync** — status, force-sync
- **OPML / TaskPaper** — `import_opml`, `export_opml`, `import_taskpaper`, `export_taskpaper`
- **Internal** — status, set-config
- **Escape hatch (opt-in via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`)** — `run_jxa_script`, `run_omnijs_script`; every invocation audit-logged

### Resources & prompts

- **10 read-only MCP resources** at `omnifocus://snapshot`, `omnifocus://inbox`, `omnifocus://project/{id}`, `omnifocus://tag/{id}`, … — agents can pass `_links` URIs from any tool response directly to `resources/read`. The snapshot payload includes `lastSyncAt` and `inFlight` so agents can detect stale data without a separate `sync_status` round-trip.
- **4 workflow prompts** — `daily-review`, `weekly-review`, `capture-meeting`, `project-planning`

### Mutation safety

- **`idempotency_key`** on every mutation — first call executes and caches the full envelope; retries within TTL replay verbatim with `meta.idempotentReplay = true`; concurrent calls coalesce onto a single in-flight promise. LRU+TTL store with env-tunable capacity (`OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES`, default 1024) and TTL (`OMNIFOCUS_IDEMPOTENCY_TTL_MS`, default 600 000).
- **`expectedModifiedAt`** — ISO-8601 optimistic concurrency guard. Rejects stale writes with `OF_CONFLICT` before touching OmniFocus.
- **`dry_run`** — returns a preview envelope with `meta.dryRun = true`; performs no mutation and no cache invalidation.
- **`confirm: true` on `task_delete` / `task_batch_delete`** — schemas require explicit confirmation before any adapter call runs, closing a class of accidental-permanent-deletion bugs.

### Performance & reliability

- **30s LRU read cache** invalidated on every mutation (ADR-0006) with thundering-herd coalescing on concurrent reads of the same key
- **Live database watcher** — native Swift `FSEventStream` binary streams change events for every `.ofocus` write; targeted `cache.invalidate` per changed object plus per-object `omnifocus://` resource notifications instead of a blanket clear
- **Per-tool sliding-window rate limiter** — default 120 calls / 60s, surfaced via `meta.rateLimit` on every response
- **Dual-threshold loop detector** — warns with `WARN_LOOP_DETECTED` at ≥5 identical calls / 60s; errors with `OF_LOOP_DETECTED` at ≥10
- **Circuit breaker** around the JXA and OmniJS transports — sustained failures fast-fail with `OF_CIRCUIT_OPEN`; closes again on a successful half-open probe
- **`ReadPool` + `WriteQueue`** concurrency primitives per ADR-0009 — bounded-concurrency reads (`OMNIFOCUS_READ_POOL_SIZE`, default 2); single-slot serial writes with soft-cap backpressure (`OMNIFOCUS_WRITE_QUEUE_CAP`, default 50) that throws `OF_QUEUE_FULL` when saturated
- **OmniFocus version gate** — lazy single-flight detection caches `{ version, edition }` on first probe; tools requiring Pro or a minimum version throw a typed `FeatureRequires*` error before any adapter call

### Type system & contracts

- **Branded ID types** (`TaskId`, `ProjectId`, `FolderId`, `TagId`) prevent cross-kind ID confusion (ADR-0008)
- **ISO-8601 with offset** date strings at all adapter boundaries (ADR-0007)
- **Uniform response envelope** — `{ data, meta }` on success, `{ error, meta }` on failure (ADR-0013)
- **`ResponseMeta`** carries `correlationId`, `durationMs`, `cacheHit`, `transport`, `ofVersion`, `syncPending`, `warnings`, `rateLimit`; plus optional `dryRun` and `idempotentReplay`
- **Typed error hierarchy** — `NotFound`, `ValidationError`, `PermissionDenied`, `OmniFocusNotRunning`, `Timeout`, `RateLimited`, `CircuitOpen`, `LoopDetected`, `Conflict`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`, `QueueFull`, `TransportUnavailable` — each with `code`, `suggestion`, and `remediationClass`
- **Structured warning codes** — `WARN_IDS_NOT_FOUND`, `WARN_RESULT_TRUNCATED`, `WARN_SYNC_PENDING`, `WARN_DEPRECATED_FIELD`, `WARN_DRY_RUN`, `WARN_LOOP_DETECTED`
- **Cursor pagination** with `filterHash` validation — swapping filters mid-sequence fails loud
- **`_links` navigation hints** on `Task` and `Project` — `omnifocus://noun/id` URIs for self, related project, parent, tags, and folder

### Security

- **Attachment path validator** — allowlist via `OMNIFOCUS_ATTACHMENT_PATHS` (default `$HOME`), symlink-escape protection, hard-deny on `/System`, `/Library`, `/private/System`, `/private/Library`
- **Raw-script tools opt-in only** — `run_jxa_script` and `run_omnijs_script` register only when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; every invocation emits an audit log event with the full script body (ADR-0004)
- **No network I/O** — enforced by a lint rule that forbids `http`, `https`, `node-fetch`, `axios`, `undici` imports
- **Stdout guard** — stray writes to stdout raise an error (MCP uses stdio; any byte corrupts the protocol)
- **No-metadata-interpolation custom lint rule** — user content (task names, notes, tag names) cannot appear in protocol metadata fields (`suggestion`, `error.message`, `meta.warnings`)
- **Config secrets redacted** from the `server.started` structured log event

See [`SECURITY.md`](./SECURITY.md) for the full security policy and reporting channel.

### Developer experience

- Generated tool catalog at [`docs/tools.md`](./docs/tools.md) — parameter tables, example calls, example responses; kept in sync via the `pnpm docs:check` CI gate
- Permission Denied troubleshooting runbook at [`docs/troubleshooting.md`](./docs/troubleshooting.md) covering macOS 12–15
- Property-based tests (fast-check) for cursor codec, `RepetitionRule` schema, transport-text parser
- Snapshot tests lock every tool description; a custom lint rule enforces the four-section description shape (what / when-not / returns / side-effects)
- E2E harness spawns the bundled server and speaks MCP over stdio
- Adapter contract test harness — every `OmniFocusAdapter` implementation must satisfy a parameterised suite (CRUD + filter semantics + typed errors)
- Transport chaos harness covers every DESIGN §19 failure mode (OmniFocus not running, automation permission denied, hard timeout, malformed JSON, `osascript` ENOENT, empty stdout, unclassified script error)

### Breaking changes

None. This is the initial release.

---

[Unreleased]: https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/torsday/omnifocus-mcp/releases/tag/v1.0.0
