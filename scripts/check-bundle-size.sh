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
# 580 KiB. Bumped 540 → 580 KiB on 2026-04-28 alongside #494 because the
# *_describe preview-tool surface (PR #522) adds ~24 new tools whose code
# overran the prior 540 KiB ceiling. The tree-shaking / code-splitting
# investigation tracked at #578 remains the long-term answer; this is a
# one-step bump to land #494 without blocking on that work.
# Previously 540 KiB (525 → 540 on 2026-04-27 alongside #482); originally
# 500 KiB. Keep in sync with DESIGN §20.
BUDGET=593920

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 580 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 580 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
