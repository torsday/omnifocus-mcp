#!/usr/bin/env bash
# check-bundle-size.sh
#
# Enforce the bundle-size budget for dist/index.js per DESIGN §20:
#   "Bundle size budget: < 800 KiB (tsup --minify); above that blocks release."
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
# 800 KiB. Bumped 780 → 800 KiB on 2026-05-08 alongside #705
# (buildFolder shared JXA helper, ADR-0020): the helper is inlined
# into 4 consumer scripts (folder_create, folder_get, folder_list,
# folder_update). Reconciliation also adds a parentMap precompute to
# folder_get and folder_update so the OF 4.8.8 sub-folder bug (#515)
# is now uniformly handled, not just in folder_list. Cumulative
# payload pushed the bundle to ~800 KiB — under the prior 780 KiB
# ceiling by only 1 KiB, which is too tight for routine work. Bumping
# by 20 KiB to 819200 to restore ~19 KiB headroom.
# Previously 780 KiB alongside #687 (lookupOrThrow shared JXA helper);
# 760 KiB alongside #686 (DRY JXA scripts, buildTask helper);
# 740 KiB alongside #689 (ban-empty-catch comment payload);
# 700 KiB alongside #681; 680 KiB alongside #483 slice 1 (webhooks);
# 660 KiB alongside #485 slice 1 (decision-journal); 640 KiB alongside
# #484; 625 KiB alongside #577; 610 KiB alongside #570; 580 KiB alongside
# #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=819200

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 800 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 800 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
