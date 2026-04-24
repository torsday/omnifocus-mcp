#!/usr/bin/env bash
# shellcheck disable=SC2034
# ^ vars here are consumed by sourcing scripts; shellcheck can't see that.
# =============================================================================
# _project-constants.sh — single source of truth for project #4 IDs
# =============================================================================
# Sourced by scripts/file-issue.sh, scripts/populate-project.sh,
# scripts/set-ready-status.sh, scripts/verify-constants.sh, and by
# .github/workflows/board-sync.yml (via a checkout + source step). The leading
# underscore marks this as a library, not a script you'd invoke directly.
#
# Drift check: scripts/verify-constants.sh re-queries the GraphQL API and
# diffs the live project against the values below. Run it in CI to catch
# silent drift when someone renames a field/option in the Projects UI.
#
# To rediscover IDs after a project recreation:
#
#   gh api graphql -f query='query {
#     user(login: "torsday") {
#       projectV2(number: 4) {
#         id
#         fields(first: 20) {
#           nodes {
#             ... on ProjectV2SingleSelectField {
#               id name options { id name }
#             }
#           }
#         }
#       }
#     }
#   }'
# =============================================================================

# Owner / repo / project
OWNER="torsday"
REPO="torsday/omnifocus-mcp"
PROJECT_NUM=4
PROJECT_ID="PVT_kwHOAARNgc4BVGvQ"

# Field IDs
F_STATUS="PVTSSF_lAHOAARNgc4BVGvQzhQkx-E"
F_PHASE="PVTSSF_lAHOAARNgc4BVGvQzhQkyDM"
F_PRIORITY="PVTSSF_lAHOAARNgc4BVGvQzhQkyEM"
F_SIZE="PVTSSF_lAHOAARNgc4BVGvQzhQkyEQ"
F_RISK="PVTSSF_lAHOAARNgc4BVGvQzhQkyEU"

# Status option IDs
STATUS_BACKLOG="1e5b9208"
STATUS_UP_NEXT="19ebdd2c"
STATUS_IN_PROGRESS="381a1e62"
STATUS_IN_REVIEW="04079029"
STATUS_ON_HOLD="8baabea1"
STATUS_DONE="c2f7c066"

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
