#!/usr/bin/env bash
# check-bundle-size.sh
#
# Enforce the bundle-size budget for dist/index.js per DESIGN §20:
#   "Bundle size budget: < 580 KiB (tsup --minify); above that blocks release."
#
# This script is the single source of truth for the budget value. CI, the
# release workflow, and the /release skill all call it so the threshold
# only ever has to change in one place.
#
# Usage (run after `pnpm build`):
#   ./scripts/check-bundle-size.sh
#
# Exits 0 when the bundle fits the budget, exits 1 with a clear diagnostic
# (and an annotation that GitHub Actions surfaces as an error) when it
# doesn't. Exits 1 if dist/index.js is missing — callers must build first.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BUNDLE="dist/index.js"
# 625 KiB. Bumped 610 → 625 KiB on 2026-04-28 alongside #577 because the
# perspective_create + perspective_update pair (slices B/C of the
# custom-perspective CRUD work) added ~12 KiB: two OmniJS scripts inlined
# verbatim, an input rule schema with refinements, and two tools whose
# descriptions document the patch semantics. Previously 610 KiB on
# 2026-04-28 alongside #570 (Example: sweep, ~7 KiB of strings); 580 KiB
# alongside #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=640000

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 625 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 625 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
