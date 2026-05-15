#!/usr/bin/env bash
# =============================================================================
# verify-constants.sh — catch drift between _project-constants.sh and live
# =============================================================================
# Queries the GraphQL API for project #4's field + single-select option IDs
# and compares each to the constants checked into _project-constants.sh.
# Exits nonzero on any mismatch so CI can block merges that leave the scripts
# pointing at stale IDs (e.g. after someone renames a Status option in the UI
# and GitHub silently mints a new ID).
#
# Safe to run read-only. Uses gh auth.
#
# Example:
#   ./scripts/verify-constants.sh
#   ./scripts/verify-constants.sh --json   # machine-readable report
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_project-constants.sh
source "$SCRIPT_DIR/_project-constants.sh"

JSON_OUT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_OUT=1; shift ;;
    -h|--help) sed -n '3,18p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

echo "==> Fetching live project state for $OWNER/projects/$PROJECT_NUM" >&2
LIVE="$(gh api graphql -f query='
  query($o:String!,$n:Int!) {
    user(login:$o) {
      projectV2(number:$n) {
        id
        fields(first: 30) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id name options { id name }
            }
          }
        }
      }
    }
  }
' -F o="$OWNER" -F n="$PROJECT_NUM")"

# Single source of truth for expected IDs: pair the constant var name with the
# path in the live payload. Paths are resolved via jq below.
#
# expected[i] = "<VAR_NAME>=<FIELD_NAME>[::<OPTION_NAME>]"
expected=(
  "PROJECT_ID=.data.user.projectV2.id"
  "F_STATUS=Status"
  "F_PHASE=Phase"
  "F_PRIORITY=Priority"
  "F_SIZE=Size"
  "F_RISK=Risk"
  "F_MODEL_QUEUE=Model Queue"
  "STATUS_BACKLOG=Status::Backlog"
  "STATUS_UP_NEXT=Status::Up Next"
  "STATUS_IN_PROGRESS=Status::In Progress"
  "STATUS_IN_REVIEW=Status::In Review"
  "STATUS_ON_HOLD=Status::On Hold"
  "STATUS_DONE=Status::Done"
  "O_PHASE_M0=Phase::M0 Foundation"
  "O_PHASE_M1=Phase::M1 Core surface"
  "O_PHASE_M2=Phase::M2 Metadata"
  "O_PHASE_M3=Phase::M3 Advanced"
  "O_PHASE_M4=Phase::M4 Long tail"
  "O_PHASE_M5=Phase::M5 Polish"
  "O_P0=Priority::P0 · critical"
  "O_P1=Priority::P1 · high"
  "O_P2=Priority::P2 · medium"
  "O_P3=Priority::P3 · low"
  "O_SIZE_XS=Size::XS"
  "O_SIZE_S=Size::S"
  "O_SIZE_M=Size::M"
  "O_SIZE_L=Size::L"
  "O_SIZE_XL=Size::XL"
  "O_RISK_HIGH=Risk::High"
  "O_RISK_MED=Risk::Medium"
  "O_RISK_LOW=Risk::Low"
  "O_MQ_SONNET_LOW=Model Queue::sonnet-low"
  "O_MQ_OPUS_MED=Model Queue::opus-med"
  "O_MQ_OPUS_HIGH=Model Queue::opus-high"
  "O_MQ_OPUS_1M_MAX=Model Queue::opus-1m-max"
  "O_MQ_IN_PROGRESS=Model Queue::In Progress"
  "O_MQ_IN_REVIEW=Model Queue::In Review"
  "O_MQ_ON_HOLD=Model Queue::On Hold"
  "O_MQ_DONE=Model Queue::Done"
)

# Resolve a "<field>" or "<field>::<option>" selector against the live payload.
resolve() {
  local sel="$1"
  if [ "$sel" = ".data.user.projectV2.id" ]; then
    echo "$LIVE" | jq -r '.data.user.projectV2.id'
    return
  fi
  local field="${sel%%::*}"
  if [ "$field" = "$sel" ]; then
    # Field ID lookup.
    echo "$LIVE" | jq -r --arg f "$field" '
      .data.user.projectV2.fields.nodes[] | select(.name == $f) | .id // empty'
  else
    # Option ID lookup.
    local opt="${sel#*::}"
    echo "$LIVE" | jq -r --arg f "$field" --arg o "$opt" '
      .data.user.projectV2.fields.nodes[]
      | select(.name == $f)
      | .options[]? | select(.name == $o) | .id // empty'
  fi
}

mismatches=0
report=""
for pair in "${expected[@]}"; do
  var="${pair%%=*}"
  selector="${pair#*=}"
  expected_val="${!var:-}"
  live_val="$(resolve "$selector")"
  if [ -z "$live_val" ]; then
    report+="✗ $var  selector='$selector'  LIVE MISSING (renamed or deleted)"$'\n'
    mismatches=$((mismatches + 1))
  elif [ "$live_val" != "$expected_val" ]; then
    report+="✗ $var  constants='$expected_val'  live='$live_val'"$'\n'
    mismatches=$((mismatches + 1))
  fi
done

if [ "$JSON_OUT" -eq 1 ]; then
  jq -n --argjson m "$mismatches" --arg r "$report" \
    '{mismatches: $m, report: $r}'
  [ "$mismatches" -eq 0 ] && exit 0 || exit 1
fi

if [ "$mismatches" -eq 0 ]; then
  echo "✓ _project-constants.sh matches live project state" >&2
  exit 0
fi

echo "" >&2
echo "⚠️  Found $mismatches drift(s) between _project-constants.sh and live project:" >&2
printf '%s' "$report" >&2
echo "" >&2
echo "Rediscover IDs via the GraphQL query in scripts/_project-constants.sh" >&2
exit 1
