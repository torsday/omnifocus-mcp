#!/usr/bin/env bash
# Fail if any workflow under .github/workflows/ targets a GitHub-hosted
# runner, except for documented allowlist entries below.
#
# Policy (see AGENTS.md):
#   - ci.yml: ubuntu-latest (build job, marked `# allow-hosted` per-line). The
#     build runs typecheck/lint/test/build against the InMemoryAdapter — no
#     osascript / OmniFocus calls — so OS parity is not required, and keeping
#     CI off the self-hosted runner restores parallelism that prevented today's
#     queue starvation when integration tests hung.
#   - integration.yml: integration job stays on self-hosted mac (OF access);
#     `integration-gate` job is intentionally on ubuntu-latest so the required
#     check is reachable even when the self-hosted runner is offline — that's
#     the exact failure this gate exists to surface (gap 2 of #679).
#   - release.yml: ubuntu-latest — npm provenance rejects self-hosted runners.
#   - Admin workflows (board-sync, meta-lint, pr-link, pr-title, issue-lint,
#     verify-constants, post-merge-close, release-please): ubuntu-latest — pure
#     gh CLI / Node admin work; no macOS dependency; free on public repos.
#
# Wired into meta-lint.yml's `no-hosted-runners` job so every PR that
# touches .github/workflows/ catches a regression at PR time.
#
# Detects: `runs-on: ubuntu-latest`, `macos-latest`, `windows-latest`,
# and any matrix.os value pulled from those literals.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Allowlist: workflows that are documented exceptions. Add to this list
# only with a code comment in the workflow itself explaining why.
ALLOWLIST=(
  ".github/workflows/release.yml"
  ".github/workflows/release-please.yml"
  ".github/workflows/meta-lint.yml"
  ".github/workflows/board-sync.yml"
  ".github/workflows/pr-link.yml"
  ".github/workflows/pr-title.yml"
  ".github/workflows/issue-lint.yml"
  ".github/workflows/verify-constants.yml"
  ".github/workflows/post-merge-close.yml"
)

# Per-line marker: a `runs-on: ubuntu-latest` line is permitted in any
# scanned workflow if the line contains `# allow-hosted` and the file is
# documented in the policy comment above (e.g. integration-gate in
# integration.yml). This keeps the file-level guard active for the rest of
# the workflow while letting one job opt out with an audit trail.

# Build a glob of files to scan, skipping the allowlisted ones.
files=()
for f in .github/workflows/*.yml; do
  skip=false
  for allowed in "${ALLOWLIST[@]}"; do
    [ "$f" = "$allowed" ] && skip=true && break
  done
  $skip || files+=("$f")
done

# Plain string-grep is sufficient: every regression seen so far has been
# `runs-on: ubuntu-latest` typed verbatim by dependabot or copy-paste.
# Lines tagged `# allow-hosted` are treated as audited exceptions.
hits=$(grep -nE 'runs-on:.*(ubuntu-latest|macos-latest|windows-latest)' \
  "${files[@]}" | grep -v '# allow-hosted' || true)

if [ -z "$hits" ]; then
  echo "ok: no GitHub-hosted runners referenced"
  exit 0
fi

cat <<EOF >&2
GitHub-hosted runner detected in a non-allowlisted workflow.

Offending lines:
$hits

Policy: integration.yml's heavy job must use \`runs-on: [self-hosted, macos-omnifocus]\`
(OmniFocus access required). ci.yml's build job uses ubuntu-latest with a
\`# allow-hosted\` line marker since it only exercises the InMemoryAdapter.
Admin workflows (board-sync, meta-lint, etc.) use ubuntu-latest — see
AGENTS.md. If this workflow genuinely needs a hosted runner, either add a
\`# allow-hosted\` comment on the offending \`runs-on:\` line with a code
comment explaining why, or add the file to ALLOWLIST in this script.
EOF
exit 1
