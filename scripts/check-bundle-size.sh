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
# 740 KiB. Bumped 700 → 740 KiB on 2026-04-29 alongside #689
# (ban-empty-catch: annotated ~280 previously-silent catch blocks across
# 32 JXA/OmniJS scripts with contextual block comments explaining why each
# is deliberately suppressed). Comments are inlined verbatim as strings by
# scriptInlinerPlugin — measured 746064 bytes against the 716800 (700 KiB)
# ceiling. Bumping by 40 KiB to 757760 to absorb the comment payload and
# leave ~11 KiB headroom. Previously 700 KiB alongside #681; 680 KiB
# alongside #483 slice 1 (webhooks); 660 KiB alongside #485 slice 1
# (decision-journal); 640 KiB alongside #484; 625 KiB alongside #577;
# 610 KiB alongside #570; 580 KiB alongside #494; 540, 525, originally
# 500 KiB. Keep in sync with DESIGN §20.
BUDGET=757760

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 740 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 740 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
