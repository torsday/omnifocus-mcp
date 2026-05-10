#!/usr/bin/env bash
# verify-migrations-doc.sh — enforce that PRs labelled `breaking-change`
# update docs/migrations.md.
#
# Usage (CI — runs only when PR_LABELS is set):
#   PR_LABELS="breaking-change,type: perf" \
#   CHANGED_FILES="src/tools/task/list.ts docs/migrations.md" \
#     bash scripts/verify-migrations-doc.sh
#
# Usage (local — checks the working tree diff against main):
#   bash scripts/verify-migrations-doc.sh
#
# Exit codes:
#   0 — OK (not a breaking-change PR, or migrations.md was updated)
#   1 — PR is labelled breaking-change but docs/migrations.md was not touched

set -euo pipefail

MIGRATIONS_DOC="docs/migrations.md"

# ---------------------------------------------------------------------------
# 1. Detect whether this is a breaking-change PR
# ---------------------------------------------------------------------------

is_breaking=0

if [ -n "${PR_LABELS:-}" ]; then
  # CI path: PR_LABELS is a comma-separated list supplied by the workflow.
  if echo "$PR_LABELS" | grep -q "breaking-change"; then
    is_breaking=1
  fi
else
  # Local path: inspect the GITHUB_EVENT_PATH payload if present, otherwise
  # fall back to checking whether the current branch has any commit message
  # or PR label indication.  When run locally without GH context we skip.
  if [ -n "${GITHUB_EVENT_PATH:-}" ] && command -v jq >/dev/null 2>&1; then
    if jq -r '.pull_request.labels[].name' "$GITHUB_EVENT_PATH" 2>/dev/null \
        | grep -q "breaking-change"; then
      is_breaking=1
    fi
  fi
fi

if [ "$is_breaking" -eq 0 ]; then
  echo "verify-migrations-doc: not a breaking-change PR — skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Check whether docs/migrations.md was modified
# ---------------------------------------------------------------------------

migrations_touched=0

if [ -n "${CHANGED_FILES:-}" ]; then
  # CI path: CHANGED_FILES is a space-separated list.
  if echo "$CHANGED_FILES" | tr ' ' '\n' | grep -q "^${MIGRATIONS_DOC}$"; then
    migrations_touched=1
  fi
else
  # Local path: compare against the merge-base with main.
  base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
  if [ -n "$base" ]; then
    if git diff --name-only "$base" HEAD | grep -q "^${MIGRATIONS_DOC}$"; then
      migrations_touched=1
    fi
  fi
fi

if [ "$migrations_touched" -eq 0 ]; then
  echo "::error file=${MIGRATIONS_DOC}::This PR is labelled 'breaking-change' but docs/migrations.md was not updated." >&2
  echo "Every breaking change must document what changed, why, and how to migrate." >&2
  echo "Add a section to docs/migrations.md before merging." >&2
  exit 1
fi

echo "verify-migrations-doc: docs/migrations.md updated — OK."
