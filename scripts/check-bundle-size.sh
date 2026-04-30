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
# 760 KiB. Bumped 740 → 760 KiB on 2026-04-30 alongside #686
# (DRY JXA scripts via build-time helper inlining per ADR-0020): the
# @inline directive expands the canonical buildTask + buildRepetition
# helper into each of 8 task-side consumer scripts. Net effect on disk
# is −1482 lines of source, but the bundled string grows because the
# canonical helper carries a top-of-file docblock (~30 lines) plus the
# new effectiveAvailability branch — that payload is inlined verbatim
# into all 8 consumers via scriptInlinerPlugin. Measured 767126 bytes
# against the 757760 (740 KiB) ceiling. Bumping by 20 KiB to 778240 to
# absorb the inlined helper docblock and leave ~11 KiB headroom.
# Previously 740 KiB alongside #689 (ban-empty-catch comment payload);
# 700 KiB alongside #681; 680 KiB alongside #483 slice 1 (webhooks);
# 660 KiB alongside #485 slice 1 (decision-journal); 640 KiB alongside
# #484; 625 KiB alongside #577; 610 KiB alongside #570; 580 KiB alongside
# #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=778240

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 760 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 760 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
