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
# 680 KiB. Bumped 660 → 680 KiB on 2026-04-29 alongside #483 slice 1
# (webhooks: registry + register/list/delete tools + types + capability
# resource integration + env-flag wiring per ADR-0016). The slice 1 surface
# measured ~4.5 KiB over the 660 KiB ceiling; bumping by 20 KiB to leave
# headroom for slice 2's cache-refresh diff observer and slice 3's HTTPS
# delivery + retry / circuit-breaker code. Previously 660 KiB alongside
# #485 slice 1 (decision-journal); 640 KiB alongside the final slice of
# #484 (omnifocus://agenda); 625 KiB alongside #577 (perspective CRUD
# slice B/C); 610 KiB alongside #570 (Example: sweep); 580 KiB alongside
# #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=696320

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 680 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 680 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
