#!/usr/bin/env bash
# =============================================================================
# set-ready-status.sh — set Status=Up Next on unblocked issues, Backlog on the rest
# =============================================================================
# Run once after the Status field options have been regenerated (which clears
# existing values). Determines "unblocked" by parsing each issue's body for a
# "- Blocked by: #N" reference; issues without one go to Up Next.
#
# Status field naming history: the options were renamed Ready→"Up Next" and
# Todo→"Backlog" in a board cleanup; the option UUIDs below are unchanged.
# =============================================================================
set -euo pipefail

# Project/field/option IDs live in scripts/_project-constants.sh (single source of truth)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_project-constants.sh
source "$SCRIPT_DIR/_project-constants.sh"

# Local aliases for readability at call sites
O_UP_NEXT="$STATUS_UP_NEXT"   # formerly "Ready"
O_BACKLOG="$STATUS_BACKLOG"   # formerly "Todo"

# Unblocked issue numbers (computed from issue body parsing; see blockers.tsv)
UNBLOCKED_NUMBERS=(1 2 3 6 8 9 10 12 13 14 21 23 24 26 27 32 33 69 70 78 80 84 86 87 88)

is_unblocked() {
  local n="$1"
  for r in "${UNBLOCKED_NUMBERS[@]}"; do
    if [ "$r" -eq "$n" ]; then return 0; fi
  done
  return 1
}

echo "Fetching all project items..." >&2
# Paginate — GraphQL first caps at 100
items_json=$(gh api graphql -f query='
query {
  user(login: "torsday") {
    projectV2(number: 4) {
      items(first: 100) {
        nodes {
          id
          content {
            ... on Issue { number }
          }
        }
      }
    }
  }
}' | jq -c '.data.user.projectV2.items.nodes[] | {id, number: .content.number}')

count_up_next=0
count_backlog=0

while read -r item; do
  item_id=$(echo "$item" | jq -r '.id')
  number=$(echo "$item" | jq -r '.number')

  if is_unblocked "$number"; then
    option="$O_UP_NEXT"
    label="Up Next"
    ((count_up_next++))
  else
    option="$O_BACKLOG"
    label="Backlog"
    ((count_backlog++))
  fi

  gh api graphql -f query='
  mutation Set($p: ID!, $i: ID!, $f: ID!, $o: String!) {
    updateProjectV2ItemFieldValue(input: {projectId: $p, itemId: $i, fieldId: $f, value: {singleSelectOptionId: $o}}) {
      projectV2Item { id }
    }
  }' -f p="$PROJECT_ID" -f i="$item_id" -f f="$F_STATUS" -f o="$option" >/dev/null

  echo "  #$number → $label" >&2
done <<< "$items_json"

echo "" >&2
echo "done. Up Next=$count_up_next, Backlog=$count_backlog" >&2
