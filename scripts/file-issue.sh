#!/usr/bin/env bash
# =============================================================================
# file-issue.sh — atomic "create issue + wire it into project #4" command.
# =============================================================================
# One command, hard to get wrong. Creates the GitHub issue with the full label
# set + milestone, adds it to project #4, sets the Status field, populates
# Phase/Priority/Size/Risk from the labels, and verifies all wiring before
# returning. Exits nonzero on any missing step so the caller can't proceed
# under the illusion that the issue is fully tracked.
#
# Required flags:
#   --title       "<issue title>"                 — verb-first imperative
#   --body-file   <path>                          — markdown body (use heredoc from caller)
#   --type        feature|bug|chore|refactor|perf|docs|test|infra|spike|epic
#   --priority    P0|P1|P2|P3
#   --size        XS|S|M|L|XL
#   --phase       M0|M1|M2|M3|M4|M5|v1
#   --domain      "<comma-separated list>"        — e.g. "task,tag"
#   --model       opus|sonnet
#
# Optional flags:
#   --risk        high|medium                     — omit for low/none
#   --milestone   "<exact milestone title>"       — derived from --phase if absent
#   --blocked                                     — if present, Status=Backlog; else Up Next
#   --modifier    "<comma-separated list>"        — orthogonal labels; any of:
#                                                   security|breaking-change|regression|
#                                                   tech-debt|flaky|needs-repro
#
# Exit codes:
#   0   — issue created, added to project, all fields set, verification passed
#   2   — invalid / missing arguments
#   3   — `gh issue create` failed
#   4   — `gh project item-add` failed
#   5   — field-set mutation failed
#   6   — post-create verification failed (issue not on project, or a field missing)
#
# Example:
#   ./scripts/file-issue.sh \
#     --title "feat(tags): implement create_tag tool" \
#     --body-file /tmp/body.md \
#     --type feature --priority P1 --size M --phase M1 \
#     --domain tag --model opus
# =============================================================================
set -euo pipefail

# Project/field/option IDs live in scripts/_project-constants.sh (single source of truth)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_project-constants.sh
source "$SCRIPT_DIR/_project-constants.sh"

# ── Argument parsing ────────────────────────────────────────────────────────

TITLE=""
BODY_FILE=""
TYPE=""
PRIORITY=""
SIZE=""
PHASE=""
DOMAIN=""
MODEL=""
RISK=""
MILESTONE=""
BLOCKED=false
MODIFIER=""

die() { echo "file-issue.sh: $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --title)      TITLE="$2"; shift 2 ;;
    --body-file)  BODY_FILE="$2"; shift 2 ;;
    --type)       TYPE="$2"; shift 2 ;;
    --priority)   PRIORITY="$2"; shift 2 ;;
    --size)       SIZE="$2"; shift 2 ;;
    --phase)      PHASE="$2"; shift 2 ;;
    --domain)     DOMAIN="$2"; shift 2 ;;
    --model)      MODEL="$2"; shift 2 ;;
    --risk)       RISK="$2"; shift 2 ;;
    --milestone)  MILESTONE="$2"; shift 2 ;;
    --blocked)    BLOCKED=true; shift ;;
    --modifier)   MODIFIER="$2"; shift 2 ;;
    -h|--help)    sed -n '3,40p' "$0"; exit 0 ;;
    *)            die "unknown flag: $1" ;;
  esac
done

# Required
[ -n "$TITLE" ]      || die "--title required"
[ -n "$BODY_FILE" ]  || die "--body-file required"
[ -f "$BODY_FILE" ]  || die "--body-file path does not exist: $BODY_FILE"
[ -n "$TYPE" ]       || die "--type required"
[ -n "$PRIORITY" ]   || die "--priority required"
[ -n "$SIZE" ]       || die "--size required"
[ -n "$PHASE" ]      || die "--phase required"
[ -n "$DOMAIN" ]     || die "--domain required (at least one)"
[ -n "$MODEL" ]      || die "--model required (opus|sonnet)"

# Enumerations — fail fast on typos rather than producing a half-wired issue
case "$TYPE"     in feature|bug|chore|refactor|perf|docs|test|infra|spike|epic) ;; *) die "--type invalid: $TYPE" ;; esac
case "$PRIORITY" in P0|P1|P2|P3) ;;                          *) die "--priority invalid: $PRIORITY" ;; esac
case "$SIZE"     in XS|S|M|L|XL) ;;                          *) die "--size invalid: $SIZE" ;; esac
case "$PHASE"    in M0|M1|M2|M3|M4|M5|v1) ;;                 *) die "--phase invalid: $PHASE" ;; esac
case "$MODEL"    in opus|sonnet) ;;                          *) die "--model invalid: $MODEL" ;; esac
if [ -n "$RISK" ]; then
  case "$RISK" in high|medium) ;; *) die "--risk invalid: $RISK (use high|medium or omit)" ;; esac
fi
if [ -n "$MODIFIER" ]; then
  IFS=',' read -r -a MODIFIERS <<< "$MODIFIER"
  for m in "${MODIFIERS[@]}"; do
    m_trim="$(echo "$m" | sed 's/^ *//;s/ *$//')"
    [ -z "$m_trim" ] && continue
    case "$m_trim" in
      security|breaking-change|regression|tech-debt|flaky|needs-repro) ;;
      *) die "--modifier invalid: $m_trim (allowed: security|breaking-change|regression|tech-debt|flaky|needs-repro)" ;;
    esac
  done
fi

# ── Derive label set + milestone ────────────────────────────────────────────

phase_label_for() {
  case "$1" in
    M0) echo "phase: M0 foundation" ;;
    M1) echo "phase: M1 core" ;;
    M2) echo "phase: M2 metadata" ;;
    M3) echo "phase: M3 advanced" ;;
    M4) echo "phase: M4 long-tail" ;;
    M5) echo "phase: M5 polish" ;;
    v1) echo "phase: v1" ;;
  esac
}

milestone_for() {
  case "$1" in
    M0) echo "M0 Foundation" ;;
    M1) echo "M1 Core surface" ;;
    M2) echo "M2 Metadata" ;;
    M3) echo "M3 Advanced" ;;
    M4) echo "M4 Long tail" ;;
    M5) echo "M5 Polish" ;;
    v1) echo "v1 maintenance" ;;
  esac
}

priority_label_for() {
  case "$1" in
    P0) echo "P0 · critical" ;;
    P1) echo "P1 · high" ;;
    P2) echo "P2 · medium" ;;
    P3) echo "P3 · low" ;;
  esac
}

LABELS="type: $TYPE,$(priority_label_for "$PRIORITY"),size: $SIZE,$(phase_label_for "$PHASE"),model: $MODEL"
# Domain(s) — can be comma-separated list
IFS=',' read -r -a DOMAINS <<< "$DOMAIN"
for d in "${DOMAINS[@]}"; do
  d_trim="$(echo "$d" | sed 's/^ *//;s/ *$//')"
  [ -n "$d_trim" ] && LABELS="$LABELS,domain: $d_trim"
done
if [ -n "$RISK" ]; then
  LABELS="$LABELS,risk: $RISK"
fi
# Modifier labels — orthogonal; any number, validated above.
if [ -n "$MODIFIER" ]; then
  for m in "${MODIFIERS[@]}"; do
    m_trim="$(echo "$m" | sed 's/^ *//;s/ *$//')"
    [ -n "$m_trim" ] && LABELS="$LABELS,$m_trim"
  done
fi
if [ -z "$MILESTONE" ]; then
  MILESTONE="$(milestone_for "$PHASE")"
fi

# ── Create issue ────────────────────────────────────────────────────────────

echo "==> Creating issue: $TITLE" >&2
ISSUE_URL="$(gh issue create \
  --repo "$REPO" \
  --title "$TITLE" \
  --body-file "$BODY_FILE" \
  --label "$LABELS" \
  --milestone "$MILESTONE" 2>&1)" || { echo "$ISSUE_URL" >&2; exit 3; }

# gh prints extra lines — keep only the URL
ISSUE_URL="$(echo "$ISSUE_URL" | grep -Eo 'https://github.com/[^ ]+/issues/[0-9]+' | head -1)"
[ -n "$ISSUE_URL" ] || { echo "couldn't parse issue URL from gh output" >&2; exit 3; }
ISSUE_NUM="${ISSUE_URL##*/}"
echo "    → #$ISSUE_NUM ($ISSUE_URL)" >&2

# ── Add to project ──────────────────────────────────────────────────────────

echo "==> Adding to project #$PROJECT_NUM" >&2
ITEM_ID="$(gh project item-add "$PROJECT_NUM" --owner "$OWNER" --url "$ISSUE_URL" --format json \
  | jq -r '.id')" || exit 4
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] || { echo "failed to add to project" >&2; exit 4; }

# ── Set field values ────────────────────────────────────────────────────────

set_field() {
  local field_id="$1" option_id="$2" label="$3"
  gh project item-edit \
    --id "$ITEM_ID" \
    --field-id "$field_id" \
    --project-id "$PROJECT_ID" \
    --single-select-option-id "$option_id" >/dev/null || {
      echo "failed to set $label" >&2; exit 5;
    }
}

STATUS_OPT="$STATUS_UP_NEXT"
STATUS_NAME="Up Next"
if [ "$BLOCKED" = true ]; then
  STATUS_OPT="$STATUS_BACKLOG"
  STATUS_NAME="Backlog"
fi

echo "==> Setting Status=$STATUS_NAME" >&2
set_field "$F_STATUS" "$STATUS_OPT" "Status"

case "$PHASE" in
  M0) PHASE_OPT="$O_PHASE_M0" ;;
  M1) PHASE_OPT="$O_PHASE_M1" ;;
  M2) PHASE_OPT="$O_PHASE_M2" ;;
  M3) PHASE_OPT="$O_PHASE_M3" ;;
  M4) PHASE_OPT="$O_PHASE_M4" ;;
  M5) PHASE_OPT="$O_PHASE_M5" ;;
  v1) PHASE_OPT="$O_PHASE_V1" ;;
esac
case "$PRIORITY" in
  P0) PRI_OPT="$O_P0" ;;
  P1) PRI_OPT="$O_P1" ;;
  P2) PRI_OPT="$O_P2" ;;
  P3) PRI_OPT="$O_P3" ;;
esac
case "$SIZE" in
  XS) SIZE_OPT="$O_SIZE_XS" ;;
  S)  SIZE_OPT="$O_SIZE_S" ;;
  M)  SIZE_OPT="$O_SIZE_M" ;;
  L)  SIZE_OPT="$O_SIZE_L" ;;
  XL) SIZE_OPT="$O_SIZE_XL" ;;
esac

echo "==> Setting Phase=$PHASE, Priority=$PRIORITY, Size=$SIZE" >&2
set_field "$F_PHASE"    "$PHASE_OPT" "Phase"
set_field "$F_PRIORITY" "$PRI_OPT"   "Priority"
set_field "$F_SIZE"     "$SIZE_OPT"  "Size"

if [ -n "$RISK" ]; then
  case "$RISK" in
    high)   RISK_OPT="$O_RISK_HIGH" ;;
    medium) RISK_OPT="$O_RISK_MED" ;;
  esac
  echo "==> Setting Risk=$RISK" >&2
  set_field "$F_RISK" "$RISK_OPT" "Risk"
fi

# ── Verify ──────────────────────────────────────────────────────────────────
# Re-read the item from the project and assert every required field is set.
# This is the guardrail that turns a silent partial failure into a loud exit 6.

echo "==> Verifying wiring" >&2

# 1) Issue carries exactly one model: label
MODEL_LABEL_COUNT="$(gh issue view "$ISSUE_NUM" --repo "$REPO" --json labels \
  | jq '[.labels[] | select(.name | startswith("model: "))] | length')"
if [ "$MODEL_LABEL_COUNT" != "1" ]; then
  echo "VERIFY FAIL: issue #$ISSUE_NUM has $MODEL_LABEL_COUNT model: labels (expected 1)" >&2
  exit 6
fi

# 2) Item is on project with Status, Phase, Priority, Size populated
VERIFY_JSON="$(gh api graphql -f query='
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item {
        content { ... on Issue { number } }
        fieldValues(first: 20) {
          nodes {
            ... on ProjectV2ItemFieldSingleSelectValue {
              field { ... on ProjectV2SingleSelectField { name } }
              name
            }
          }
        }
      }
    }
  }' -f id="$ITEM_ID")"

missing=()
for field in Status Phase Priority Size; do
  value="$(echo "$VERIFY_JSON" | jq -r --arg f "$field" \
    '[.data.node.fieldValues.nodes[] | select(.field.name == $f)][0].name // empty')"
  if [ -z "$value" ]; then
    missing+=("$field")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "VERIFY FAIL: issue #$ISSUE_NUM is on project #$PROJECT_NUM but missing fields: ${missing[*]}" >&2
  exit 6
fi

echo "    ✓ model: label (exactly 1)" >&2
echo "    ✓ on project #$PROJECT_NUM" >&2
echo "    ✓ Status, Phase, Priority, Size all populated" >&2
echo "" >&2
echo "Filed #$ISSUE_NUM → $ISSUE_URL" >&2

# stdout = issue URL, so the caller can capture it
echo "$ISSUE_URL"
