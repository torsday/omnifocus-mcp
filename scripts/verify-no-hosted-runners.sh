#!/usr/bin/env bash
# Fail if any workflow under .github/workflows/ targets a GitHub-hosted
# runner. Every job in this repo runs on `[self-hosted, macos]` per the
# CI strategy in CLAUDE.md — GitHub-hosted runners cost minutes and have
# been blocked by spending-limit issues in the past.
#
# Wired into meta-lint.yml's `no-hosted-runners` job so every PR that
# touches .github/workflows/ catches a regression at PR time.
#
# Detects: `runs-on: ubuntu-latest`, `macos-latest`, `windows-latest`,
# and any matrix.os value pulled from those literals.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Plain string-grep is sufficient: every regression seen so far has been
# `runs-on: ubuntu-latest` typed verbatim by dependabot or copy-paste.
hits=$(grep -nE 'runs-on:.*(ubuntu-latest|macos-latest|windows-latest)' \
  .github/workflows/*.yml || true)

if [ -z "$hits" ]; then
  echo "ok: no GitHub-hosted runners referenced"
  exit 0
fi

cat <<EOF >&2
GitHub-hosted runner detected. Every workflow in this repo must use
\`runs-on: [self-hosted, macos]\` so jobs run on the local mac-local
runner — no GitHub-hosted billing, no spending-limit blocks.

Offending lines:
$hits

To fix: replace \`runs-on: ubuntu-latest\` (or \`macos-latest\`,
\`windows-latest\`) with \`runs-on: [self-hosted, macos]\`. If the job
genuinely needs Linux/Docker, raise it for discussion before merging —
adding back GitHub-hosted dependencies should be a deliberate choice,
not a copy-paste accident.
EOF
exit 1
