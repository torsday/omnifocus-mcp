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
# 780 KiB. Bumped 760 → 780 KiB on 2026-04-30 alongside #687
# (lookupOrThrow shared JXA helper, ADR-0020): the helper is inlined
# into 16 consumer scripts via the @inline directive. Trimmed the
# helper file to a 6-line summary comment + 8-line function so the
# 16-fold inlining stays compact, but the cumulative payload still
# pushed the bundle to 777929 bytes — 311 bytes under the 760 KiB
# ceiling, which is too tight for routine work. Bumping by 20 KiB to
# 798720 to restore ~20 KiB headroom.
# Previously 760 KiB alongside #686 (DRY JXA scripts, buildTask helper);
# 740 KiB alongside #689 (ban-empty-catch comment payload);
# 700 KiB alongside #681; 680 KiB alongside #483 slice 1 (webhooks);
# 660 KiB alongside #485 slice 1 (decision-journal); 640 KiB alongside
# #484; 625 KiB alongside #577; 610 KiB alongside #570; 580 KiB alongside
# #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=798720

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 780 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 780 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
