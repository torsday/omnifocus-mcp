#!/usr/bin/env bash
# check-bundle-size.sh
#
# Enforce the bundle-size budget for dist/index.js per DESIGN §20:
#   "Bundle size budget: < 540 KiB (tsup --minify); above that blocks release."
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
# 540 KiB. Bumped 525 → 540 KiB on 2026-04-27 alongside #482 because two
# tool-adding PRs (#523 perspective_get/delete and #482 waiting-on) merged
# inside the same review window and together overran the prior bump.
# Originally 500 KiB. Per DESIGN §20: do NOT bump again without a
# tree-shaking / code-splitting investigation — see follow-up tracker
# issue. Keep in sync with DESIGN §20.
BUDGET=552960

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 540 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 540 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
