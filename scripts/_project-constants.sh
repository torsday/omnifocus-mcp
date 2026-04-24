#!/usr/bin/env bash
# =============================================================================
# _project-constants.sh — single source of truth for project #4 IDs
# =============================================================================
# Sourced by scripts/file-issue.sh, scripts/populate-project.sh, and
# scripts/set-ready-status.sh. The leading underscore marks this as a library,
# not a script you'd invoke directly.
#
# Mirror of these values also appears in .github/workflows/board-sync.yml
# (as workflow env vars — GHA can't source shell files). If you change any ID
# here, search-and-replace across board-sync.yml too.
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
STATUS_ON_HOLD=""      # TODO: fill in if ever needed; not used by filer
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
