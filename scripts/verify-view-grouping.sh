#!/usr/bin/env bash
# =============================================================================
# verify-view-grouping.sh — catch silent drift in project board view grouping
# =============================================================================
# GitHub Projects v2 view-grouping configuration is UI-only — there's no
# `updateProjectV2View` mutation, no audit log entry on change, and no constant
# we can pin to a value. The only way a misconfigured view shows up is when a
# human notices "the board doesn't look right" — by then it's been broken for
# unknown weeks.
#
# This script reads the live `verticalGroupByFields[0].name` for each board
# view we care about and compares against the expected field name. Run it on a
# weekly schedule (mirroring verify-constants.sh) to catch drift early.
#
# Why `Model Queue` for view #3: project-local override declares it
# (.claude/commands/groom.md), and the whole reason the view exists is to slice
# work by tier. Drift to `Status` makes view #3 a duplicate of view #2 KanBan,
# which is exactly the failure mode this script catches.
#
# Safe to run read-only. Uses gh auth.
#
# Example:
#   ./scripts/verify-view-grouping.sh
#
# To wire into CI, model on .github/workflows/verify-constants.yml:
#   - schedule + workflow_dispatch triggers (not PR — view drift is detected
#     out-of-band, not by code changes)
#   - PROJECT_TOKEN env var (GITHUB_TOKEN can't read user-owned Projects v2)
#   - skip gracefully on fork PRs
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_project-constants.sh
source "$SCRIPT_DIR/_project-constants.sh"

# Project locator — _project-constants.sh exports PROJECT_ID for GraphQL but
# not the owner/number that the human-facing fix-up URL needs. Hardcode here
# (this is a project-local script; the project is fixed at torsday/4).
OWNER="torsday"
PROJECT_NUMBER=4

# Expected view → grouping-field-name mapping. Add rows here as new views land.
EXPECTED=(
  "2:Status"        # KanBan — canonical lifecycle queue (/ship-next pulls from here)
  "3:Model Queue"   # ModelBan — tier-sliced view; drift back to Status makes it useless
)

mismatches=0
report=""

for pair in "${EXPECTED[@]}"; do
  view_num="${pair%%:*}"
  expected_field="${pair#*:}"

  actual=$(gh api graphql -f query='
    query($pid: ID!, $vn: Int!) {
      node(id: $pid) {
        ... on ProjectV2 {
          view(number: $vn) {
            name
            verticalGroupByFields(first: 5) {
              nodes { ... on ProjectV2SingleSelectField { name } }
            }
          }
        }
      }
    }' -f pid="$PROJECT_ID" -F vn="$view_num" \
    --jq '.data.node.view.verticalGroupByFields.nodes[0].name // "(none)"' 2>/dev/null) || actual="(query failed)"

  view_name=$(gh api graphql -f query='
    query($pid: ID!, $vn: Int!) {
      node(id: $pid) {
        ... on ProjectV2 { view(number: $vn) { name } }
      }
    }' -f pid="$PROJECT_ID" -F vn="$view_num" \
    --jq '.data.node.view.name // "(unknown)"' 2>/dev/null) || view_name="(unknown)"

  if [ "$actual" = "$expected_field" ]; then
    echo "✓ view #$view_num ($view_name) grouped by '$expected_field'"
  else
    mismatches=$((mismatches + 1))
    report+="  view #$view_num ($view_name): expected '$expected_field', got '$actual'\n"
  fi
done

if [ "$mismatches" -eq 0 ]; then
  echo ""
  echo "✓ all expected view groupings match live project state"
  exit 0
fi

echo "" >&2
echo "❌ Found $mismatches view-grouping drift(s):" >&2
printf '%b' "$report" >&2
echo "" >&2
echo "Fix in the GitHub UI:" >&2
echo "  https://github.com/users/$OWNER/projects/$PROJECT_NUMBER" >&2
echo "  Open the affected view → click 'Group by' at the top → select the expected field." >&2
echo "  View grouping is UI-only; no API mutation can fix this." >&2
exit 1
