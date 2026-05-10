#!/usr/bin/env bash
# =============================================================================
# board-mutate.sh — single-item Project v2 field mutation with round-trip verify
# =============================================================================
# Replaces ~30 lines of inline `gh api graphql` boilerplate at every skill
# call-site with: `scripts/board-mutate.sh <verb> <ITEM_ID> <value>`.
#
# Every mutation is followed by a re-read of the field, per the round-trip
# invariant in ~/.claude/skills/shared/status-transition.md ("the round-trip
# is the only proof"). A 200 OK without persistence exits 7.
#
# Usage: scripts/board-mutate.sh <verb> <ITEM_ID> <value>
#        scripts/board-mutate.sh --help
#
# Verbs (canonical lower-case-with-hyphens; values accepted case-insensitively):
#   flip-status      <ITEM_ID> {backlog|up-next|in-progress|in-review|on-hold|done}
#   set-priority     <ITEM_ID> {P0|P1|P2|P3}
#   set-size         <ITEM_ID> {XS|S|M|L|XL}
#   set-phase        <ITEM_ID> {M0|M1|M2|M3|M4|M5}
#   set-risk         <ITEM_ID> {low|medium|high}
#   set-model-queue  <ITEM_ID> {sonnet-low|opus-med|opus-high|opus-1m-max
#                              |in-progress|in-review|on-hold|done}
#
# Exit codes:
#   0  success
#   2  invalid usage / missing args
#   3  scripts/_project-constants.sh not found (or missing required vars)
#   4  unknown verb
#   5  unknown value for verb (or value's option ID not configured locally)
#   6  mutation API call failed
#   7  round-trip verification failed — API claimed success, value did not persist
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Help / usage
# ---------------------------------------------------------------------------
usage() {
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$#" -ne 3 ]; then
  echo "usage: $(basename "$0") <verb> <ITEM_ID> <value>" >&2
  echo "       $(basename "$0") --help" >&2
  exit 2
fi

VERB="$1"
ITEM_ID="$2"
RAW_VALUE="$3"

# ---------------------------------------------------------------------------
# Constants — sourced from scripts/_project-constants.sh (gitignored, local)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSTANTS_FILE="$SCRIPT_DIR/_project-constants.sh"

if [ ! -f "$CONSTANTS_FILE" ]; then
  echo "FATAL: $CONSTANTS_FILE not found." >&2
  echo "       Copy $CONSTANTS_FILE.example and fill in your project IDs." >&2
  exit 3
fi
# shellcheck source=./_project-constants.sh
source "$CONSTANTS_FILE"

# Required for any verb
for v in PROJECT_ID; do
  if [ -z "${!v:-}" ] || [[ "${!v}" == YOUR_* ]]; then
    echo "FATAL: $v is unset or unfilled in $CONSTANTS_FILE" >&2
    exit 3
  fi
done

# ---------------------------------------------------------------------------
# Verb → field-id variable + value → option-id variable
# ---------------------------------------------------------------------------
# normalize value: lower-case, replace spaces with hyphens
norm() { echo "$1" | tr '[:upper:] ' '[:lower:]-'; }

# Resolve the field-id variable name + value-id variable name for a verb+value.
# Echo two fields: "<FIELD_VAR> <OPT_VAR>". Exits 4 on unknown verb, 5 on
# unknown value (the "value not in the verb's vocabulary" case — the second
# variable-existence check below handles "value valid but option ID not set").
resolve() {
  local verb="$1" value
  value="$(norm "$2")"

  case "$verb" in
    flip-status)
      local field_var="F_STATUS"
      case "$value" in
        backlog)      echo "$field_var STATUS_BACKLOG" ;;
        up-next)      echo "$field_var STATUS_UP_NEXT" ;;
        in-progress)  echo "$field_var STATUS_IN_PROGRESS" ;;
        in-review)    echo "$field_var STATUS_IN_REVIEW" ;;
        on-hold)      echo "$field_var STATUS_ON_HOLD" ;;
        done)         echo "$field_var STATUS_DONE" ;;
        *) return 5 ;;
      esac ;;
    set-priority)
      local field_var="F_PRIORITY"
      case "$value" in
        p0) echo "$field_var O_P0" ;;
        p1) echo "$field_var O_P1" ;;
        p2) echo "$field_var O_P2" ;;
        p3) echo "$field_var O_P3" ;;
        *) return 5 ;;
      esac ;;
    set-size)
      local field_var="F_SIZE"
      case "$value" in
        xs) echo "$field_var O_SIZE_XS" ;;
        s)  echo "$field_var O_SIZE_S" ;;
        m)  echo "$field_var O_SIZE_M" ;;
        l)  echo "$field_var O_SIZE_L" ;;
        xl) echo "$field_var O_SIZE_XL" ;;
        *) return 5 ;;
      esac ;;
    set-phase)
      local field_var="F_PHASE"
      case "$value" in
        m0) echo "$field_var O_PHASE_M0" ;;
        m1) echo "$field_var O_PHASE_M1" ;;
        m2) echo "$field_var O_PHASE_M2" ;;
        m3) echo "$field_var O_PHASE_M3" ;;
        m4) echo "$field_var O_PHASE_M4" ;;
        m5) echo "$field_var O_PHASE_M5" ;;
        *) return 5 ;;
      esac ;;
    set-risk)
      local field_var="F_RISK"
      case "$value" in
        low)            echo "$field_var O_RISK_LOW" ;;
        medium|med)     echo "$field_var O_RISK_MED" ;;
        high)           echo "$field_var O_RISK_HIGH" ;;
        *) return 5 ;;
      esac ;;
    set-model-queue)
      local field_var="F_MODEL_QUEUE"
      case "$value" in
        sonnet-low)   echo "$field_var O_MQ_SONNET_LOW" ;;
        opus-med)     echo "$field_var O_MQ_OPUS_MED" ;;
        opus-high)    echo "$field_var O_MQ_OPUS_HIGH" ;;
        opus-1m-max)  echo "$field_var O_MQ_OPUS_1M_MAX" ;;
        in-progress)  echo "$field_var O_MQ_IN_PROGRESS" ;;
        in-review)    echo "$field_var O_MQ_IN_REVIEW" ;;
        on-hold)      echo "$field_var O_MQ_ON_HOLD" ;;
        done)         echo "$field_var O_MQ_DONE" ;;
        *) return 5 ;;
      esac ;;
    *)
      return 4 ;;
  esac
}

set +e
RESOLVED=$(resolve "$VERB" "$RAW_VALUE")
RC=$?
set -e

if [ "$RC" -eq 4 ]; then
  echo "FATAL: unknown verb '$VERB'. Run with --help for the verb surface." >&2
  exit 4
fi
if [ "$RC" -eq 5 ]; then
  echo "FATAL: unknown value '$RAW_VALUE' for verb '$VERB'. Run with --help." >&2
  exit 5
fi

FIELD_VAR=$(echo "$RESOLVED" | awk '{print $1}')
OPT_VAR=$(echo "$RESOLVED" | awk '{print $2}')

FIELD_ID="${!FIELD_VAR:-}"
OPT_ID="${!OPT_VAR:-}"

if [ -z "$FIELD_ID" ] || [[ "$FIELD_ID" == YOUR_* ]]; then
  echo "FATAL: $FIELD_VAR is unset in $CONSTANTS_FILE — cannot resolve verb '$VERB'." >&2
  exit 3
fi
if [ -z "$OPT_ID" ] || [[ "$OPT_ID" == YOUR_* ]]; then
  echo "FATAL: $OPT_VAR is unset in $CONSTANTS_FILE — value '$RAW_VALUE' has no option ID configured for this project." >&2
  exit 5
fi

# ---------------------------------------------------------------------------
# Mutate
# ---------------------------------------------------------------------------
if ! gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $p, itemId: $i, fieldId: $f,
    value: { singleSelectOptionId: $o }
  }) { projectV2Item { id } }
}' -f p="$PROJECT_ID" -f i="$ITEM_ID" -f f="$FIELD_ID" -f o="$OPT_ID" > /dev/null 2>&1; then
  echo "FATAL: mutation API call failed for item $ITEM_ID, field $FIELD_VAR, option $OPT_VAR." >&2
  exit 6
fi

# ---------------------------------------------------------------------------
# Round-trip verify — the only proof the mutation persisted
# ---------------------------------------------------------------------------
VERIFIED=$(gh api graphql -f query='query($id:ID!) {
  node(id: $id) { ... on ProjectV2Item { fieldValues(first: 20) { nodes {
    ... on ProjectV2ItemFieldSingleSelectValue {
      field { ... on ProjectV2SingleSelectField { id } } optionId
    } } } } }
}' -F id="$ITEM_ID" --jq ".data.node.fieldValues.nodes[] | select(.field.id==\"$FIELD_ID\") | .optionId" 2>/dev/null || echo "")

if [ "$VERIFIED" != "$OPT_ID" ]; then
  echo "FATAL: $VERB on item $ITEM_ID did not persist (got: '${VERIFIED:-<empty>}', want: $OPT_ID)." >&2
  exit 7
fi

echo "board: $VERB → $RAW_VALUE (item $ITEM_ID)"
