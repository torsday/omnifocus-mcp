#!/usr/bin/env bash
# update-homebrew-formula.sh — update the omnifocus-mcp Homebrew formula in
# torsday/homebrew-tap after an npm publish.
#
# Usage (called from release.yml after `pnpm publish`):
#   bash scripts/update-homebrew-formula.sh <version>
#
# Required env:
#   HOMEBREW_TAP_TOKEN — GitHub PAT with contents:write on torsday/homebrew-tap
#
# Exits nonzero on any error so the release job fails loudly rather than
# silently shipping a stale formula.

set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
PKG="@torsday/omnifocus-mcp"
TARBALL_URL="https://registry.npmjs.org/${PKG}/-/omnifocus-mcp-${VERSION}.tgz"
FORMULA_PATH="Formula/omnifocus-mcp.rb"
TAP_REPO="torsday/homebrew-tap"

echo "==> Fetching tarball for ${PKG}@${VERSION}…"

# Retry up to 5 times — npm CDN occasionally takes a moment after publish.
for attempt in 1 2 3 4 5; do
  if curl -fsSL "$TARBALL_URL" -o /tmp/omnifocus-mcp.tgz 2>/dev/null; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "ERROR: tarball not available after 5 attempts: $TARBALL_URL" >&2
    exit 1
  fi
  echo "  attempt $attempt failed; waiting 15s…"
  sleep 15
done

SHA256=$(sha256sum /tmp/omnifocus-mcp.tgz | awk '{print $1}')
echo "    sha256: $SHA256"

echo "==> Fetching current formula from ${TAP_REPO}…"
CURRENT=$(gh api "repos/${TAP_REPO}/contents/${FORMULA_PATH}" \
  --header "Authorization: Bearer ${HOMEBREW_TAP_TOKEN}" \
  --jq '{sha: .sha, content: (.content | gsub("\n";"") | @base64d)}')
CURRENT_SHA=$(echo "$CURRENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")
CURRENT_CONTENT=$(echo "$CURRENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['content'])")

echo "==> Patching formula to version ${VERSION}…"
NEW_CONTENT=$(echo "$CURRENT_CONTENT" \
  | sed "s|omnifocus-mcp-[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.tgz|omnifocus-mcp-${VERSION}.tgz|g" \
  | sed "s|sha256 \"[a-f0-9]\{64\}\"|sha256 \"${SHA256}\"|g" \
  | sed "s|version \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"|version \"${VERSION}\"|g")

if [ "$NEW_CONTENT" = "$CURRENT_CONTENT" ]; then
  echo "WARNING: formula content unchanged — nothing to commit (already at ${VERSION}?)" >&2
  exit 0
fi

ENCODED=$(echo "$NEW_CONTENT" | base64 | tr -d '\n')

echo "==> Committing updated formula to ${TAP_REPO}…"
gh api "repos/${TAP_REPO}/contents/${FORMULA_PATH}" \
  --method PUT \
  --header "Authorization: Bearer ${HOMEBREW_TAP_TOKEN}" \
  -f message="chore: bump omnifocus-mcp to ${VERSION}" \
  -f content="$ENCODED" \
  -f sha="$CURRENT_SHA" \
  --jq '"committed: " + .commit.sha'

echo "==> Done — formula updated to ${VERSION}."
