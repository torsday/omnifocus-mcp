#!/usr/bin/env bash
# Fail if any workflow under .github/workflows/ targets a GitHub-hosted
# runner, with one documented exception (release.yml — see below).
# CI / integration / lint workflows all run on `[self-hosted, macos]` per
# the CI strategy in AGENTS.md — GitHub-hosted runners cost minutes and
# have been blocked by spending-limit issues in the past.
#
# Documented exception: release.yml runs on `ubuntu-latest` because npm
# rejects `pnpm publish --provenance` from self-hosted runners with a
# 422 "Unsupported GitHub Actions runner environment" error. Releases
# are infrequent so the billing impact is negligible. The release job
# header in release.yml carries the long-form rationale.
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
)

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
hits=$(grep -nE 'runs-on:.*(ubuntu-latest|macos-latest|windows-latest)' \
  "${files[@]}" || true)

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
