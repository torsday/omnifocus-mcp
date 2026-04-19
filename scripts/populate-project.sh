#!/usr/bin/env bash
# =============================================================================
# populate-project.sh — add all issues to the v1 project and set field values
# =============================================================================
# Assumes:
#   - Issues 1..91 already exist in torsday/omnifocus-mcp
#   - Project number 4 ("omnifocus-mcp v1") exists under torsday
#   - Custom fields Phase, Priority, Size, Risk already created
# Labels on each issue drive the field values.
# =============================================================================
set -euo pipefail

OWNER="torsday"
PROJECT_NUM=4

# Field IDs (discovered once via `gh project field-list`)
F_PHASE="PVTSSF_lAHOAARNgc4BVGvQzhQkyDM"
F_PRIORITY="PVTSSF_lAHOAARNgc4BVGvQzhQkyEM"
F_SIZE="PVTSSF_lAHOAARNgc4BVGvQzhQkyEQ"
F_RISK="PVTSSF_lAHOAARNgc4BVGvQzhQkyEU"

# Phase option IDs
O_PHASE_M0="d3ea64bc"
O_PHASE_M1="7604af38"
O_PHASE_M2="14583f99"
O_PHASE_M3="659e0f86"
O_PHASE_M4="43383303"
O_PHASE_M5="e39db280"

# Priority option IDs
O_P0="a7ac64ac"
O_P1="2bcd66d3"
O_P2="d28a8726"
O_P3="11749026"

# Size option IDs
O_SIZE_XS="c038b672"
O_SIZE_S="4a9932c9"
O_SIZE_M="987fabe1"
O_SIZE_L="0b17ef74"
O_SIZE_XL="438cc739"

# Risk option IDs
O_RISK_HIGH="62767387"
O_RISK_MED="1e89155b"
O_RISK_LOW="3f572490"

# Project ID (for item-edit commands)
PROJECT_ID="PVT_kwHOAARNgc4BVGvQ"

# Fetch all issues with labels in a single call
echo "Fetching all issues with labels..." >&2
ISSUES_JSON=$(gh issue list --repo torsday/omnifocus-mcp --state all --limit 200 --json number,url,labels)

# Process each issue
echo "$ISSUES_JSON" | jq -c '.[]' | while read -r issue; do
  number=$(echo "$issue" | jq -r '.number')
  url=$(echo "$issue" | jq -r '.url')
  labels=$(echo "$issue" | jq -r '.labels[].name')

  # Add to project; capture item ID
  item_id=$(gh project item-add "$PROJECT_NUM" --owner "$OWNER" --url "$url" --format json | jq -r '.id')

  # Map labels to field option IDs
  phase=""
  priority=""
  size=""
  risk=""

  while IFS= read -r label; do
    case "$label" in
      "phase: M0 foundation") phase="$O_PHASE_M0" ;;
      "phase: M1 core")        phase="$O_PHASE_M1" ;;
      "phase: M2 metadata")    phase="$O_PHASE_M2" ;;
      "phase: M3 advanced")    phase="$O_PHASE_M3" ;;
      "phase: M4 long-tail")   phase="$O_PHASE_M4" ;;
      "phase: M5 polish")      phase="$O_PHASE_M5" ;;
      "P0 · critical")         priority="$O_P0" ;;
      "P1 · high")             priority="$O_P1" ;;
      "P2 · medium")           priority="$O_P2" ;;
      "P3 · low")              priority="$O_P3" ;;
      "size: XS")              size="$O_SIZE_XS" ;;
      "size: S")               size="$O_SIZE_S" ;;
      "size: M")               size="$O_SIZE_M" ;;
      "size: L")               size="$O_SIZE_L" ;;
      "size: XL")              size="$O_SIZE_XL" ;;
      "risk: high")            risk="$O_RISK_HIGH" ;;
      "risk: medium")          risk="$O_RISK_MED" ;;
      "risk: low")             risk="$O_RISK_LOW" ;;
    esac
  done <<< "$labels"

  # Set fields (one call each; skip if no match)
  if [ -n "$phase" ]; then
    gh project item-edit --id "$item_id" --field-id "$F_PHASE" --project-id "$PROJECT_ID" --single-select-option-id "$phase" >/dev/null
  fi
  if [ -n "$priority" ]; then
    gh project item-edit --id "$item_id" --field-id "$F_PRIORITY" --project-id "$PROJECT_ID" --single-select-option-id "$priority" >/dev/null
  fi
  if [ -n "$size" ]; then
    gh project item-edit --id "$item_id" --field-id "$F_SIZE" --project-id "$PROJECT_ID" --single-select-option-id "$size" >/dev/null
  fi
  if [ -n "$risk" ]; then
    gh project item-edit --id "$item_id" --field-id "$F_RISK" --project-id "$PROJECT_ID" --single-select-option-id "$risk" >/dev/null
  fi

  echo "  #$number populated" >&2
done

echo "" >&2
echo "done. All issues added to project and fields populated." >&2
