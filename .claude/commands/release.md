---
description: Cut a release — version bump, CHANGELOG, git tag, npm publish, GitHub release. Specialized for this project's release flow.
---

Cut a release of `@torsday/omnifocus-mcp`. Follow the canonical release-notes protocol at `~/src/github.com/torsday/llm_prompts/release_notes.md` for the CHANGELOG and notes content, then execute the project-specific release loop below.

## Pre-flight (stop if any fails)

1. **Clean working tree:** `git status --porcelain` is empty
2. **On `main`:** `git branch --show-current` returns `main`
3. **Up-to-date with origin:** `git fetch && git status` shows no divergence
4. **All CI green:** `gh pr list --state open --search "is:pr is:open label:release-blocker"` is empty; main's last workflow run is green
5. **No open blockers in current milestone:** `gh issue list --milestone "<current>" --state open --label "P0 · critical"` is empty
6. **`pnpm audit`:** no high-severity findings

If any step fails, stop and report — do not force a release.

## Version decision

Semver rules per [ADR-0011](./docs/adr/0011-versioning-and-stability.md):

- **Major** — any breaking change: tool rename, required input field added, response envelope shape changed, error code removed/renamed, resource URI renamed, CLI args removed
- **Minor** — additive: new tool, new optional input field, new output field, new error code, new resource URI, new `meta` field
- **Patch** — bug fixes, performance, dependency bumps (non-breaking), doc updates

Check the `[Unreleased]` section of `CHANGELOG.md` and the PR titles since the last tag. If unclear, state your reasoning in the session report before proceeding.

## Sequence

```bash
# 1. Bump version in package.json (and tag in CHANGELOG.md [Unreleased] → the new version)
#    Use `npm version <major|minor|patch> --no-git-tag-version` to bump without auto-tagging.
npm version <major|minor|patch> --no-git-tag-version

# 2. Update CHANGELOG.md — move [Unreleased] content into a new ## [<version>] — <YYYY-MM-DD> section.
#    Follow release_notes.md standards. Include migration notes for any breaking change.

# 3. Run the full local gate
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 4. Commit the version bump + CHANGELOG
git add package.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore(release): v<version>

<one-line summary of what's in this release>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# 5. Tag and push
git tag -a v<version> -m "v<version>"
git push origin main
git push origin v<version>

# 6. Publish to npm (respects publishConfig.access = public in package.json)
pnpm publish

# 7. Create the GitHub release with notes
gh release create v<version> \
  --title "v<version>" \
  --notes "$(sed -n "/^## \[<version>\]/,/^## \[/p" CHANGELOG.md | head -n -1)"

# 8. Post-release checks
npm view @torsday/omnifocus-mcp version    # should print the new version
gh release view v<version>                 # should show the notes
```

## Project-specific content for the release notes

Always include these sections in the GitHub Release body and `CHANGELOG.md` entry:

- **Summary** — one paragraph, user-oriented; what they can now do that they couldn't before
- **Added / Changed / Fixed / Deprecated / Removed / Security** — standard Keep-a-Changelog categories; drop empty ones
- **Breaking** (only for majors) — migration steps per breaking change
- **Install / upgrade** — exact `npm`/`npx` commands for Claude Desktop and Claude Code config users
- **New env vars** (if any) — every one in the project's table at `DESIGN.md §22` that this release added or changed
- **Compatibility** — OmniFocus + macOS + Node.js versions tested

## Close the loop

- Move the `[Unreleased]` placeholder back to the top of `CHANGELOG.md` (the next release starts accumulating here)
- If this release closed a milestone (`M0`, `M1`, …), close the milestone on GitHub: `gh api /repos/torsday/omnifocus-mcp/milestones/<N> -X PATCH -f state=closed`
- Flip any remaining open issues in the closed milestone to the next milestone with reason comments

## Refuse if

- Pre-flight fails
- Version bump is ambiguous and you can't reason cleanly from CHANGELOG + PR log
- A breaking change is being sneaked into a minor — call it out explicitly

Ask the user to override before proceeding.
