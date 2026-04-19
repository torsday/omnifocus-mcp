#!/usr/bin/env bash
# =============================================================================
# set-ready-status.sh — set Status=Ready on unblocked issues, Todo on the rest
# =============================================================================
# Run once after the Status field options have been regenerated (which clears
# existing values). Determines "ready" by parsing each issue's body for a
# "- Blocked by: #N" reference; issues without one are Ready.
# =============================================================================
set -euo pipefail

PROJECT_ID="PVT_kwHOAARNgc4BVGvQ"
F_STATUS="PVTSSF_lAHOAARNgc4BVGvQzhQkx-E"
O_READY="19ebdd2c"
O_TODO="1e5b9208"

# Unblocked issue numbers (computed from issue body parsing; see blockers.tsv)
READY_NUMBERS=(1 2 3 6 8 9 10 12 13 14 21 23 24 26 27 32 33 69 70 78 80 84 86 87 88)

is_ready() {
  local n="$1"
  for r in "${READY_NUMBERS[@]}"; do
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

count_ready=0
count_todo=0

while read -r item; do
  item_id=$(echo "$item" | jq -r '.id')
  number=$(echo "$item" | jq -r '.number')

  if is_ready "$number"; then
    option="$O_READY"
    label="Ready"
    ((count_ready++))
  else
    option="$O_TODO"
    label="Todo"
    ((count_todo++))
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
echo "done. Ready=$count_ready, Todo=$count_todo" >&2
