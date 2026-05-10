#!/usr/bin/env bash
# check-bundle-size.sh
#
# Enforce the bundle-size budget for dist/index.js per DESIGN §20:
#   "Bundle size budget: < 850 KiB (tsup --minify); above that blocks release."
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
# 850 KiB. Bumped 824 → 850 KiB on 2026-05-10 alongside #907 after the
# eight-PR perf+input-validation merge wave (#864 length caps adding
# inputLimits.ts, #871 noteHtml drop, #866/#867/#872/#874/#876/#868) put
# the bundle at 840804 bytes — 1124 over the original 820 KiB cap and
# eating into the headroom from the 820 → 824 KiB bump that landed in
# #812 (cache byte-cap, ~1 KiB net). None of the eight individually
# broke the gate; the regression appeared once they combined on main,
# which turned every subsequent PR's `build (Node 24)` red. The bump
# restores ~30 KiB of headroom; the followup work to recover it via
# tree-shaking lives at #578 (investigation) and #827 (audit).
# Previously 824 KiB alongside #812 (cache byte-cap with size-aware
# eviction): adds the maxBytes config wiring, per-entry _measureBytes
# helper, and bytes/maxBytes stats surfacing through internal_status.
# Previously 820 KiB alongside #773 (fields[] field projection on heavy
# read tools): adds projection.ts helper (~3 KiB), per-domain field-name
# exports in task/project/tag domains (~1 KiB), and per-tool wiring across
# the read surface (~4 KiB). The feature enables 30–70% payload reduction
# for callers on bulk-triage workflows; the compile-time overhead is a
# one-time investment.
# See #578 (tree-shaking investigation) for the path to recover headroom
# without future flat bumps.
# Previously 800 KiB alongside #705 (buildFolder shared JXA helper);
# 780 KiB alongside #687 (lookupOrThrow shared JXA helper);
# 760 KiB alongside #686 (DRY JXA scripts, buildTask helper);
# 740 KiB alongside #689 (ban-empty-catch comment payload);
# 700 KiB alongside #681; 680 KiB alongside #483 slice 1 (webhooks);
# 660 KiB alongside #485 slice 1 (decision-journal); 640 KiB alongside
# #484; 625 KiB alongside #577; 610 KiB alongside #570; 580 KiB alongside
# #494; 540, 525, originally 500 KiB. Keep in sync with DESIGN §20.
BUDGET=870400

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
echo "$BUNDLE: ${SIZE} bytes (budget: ${BUDGET} bytes / 850 KiB)"

if [ "$SIZE" -gt "$BUDGET" ]; then
  echo "::error::bundle exceeds 850 KiB budget (${SIZE} > ${BUDGET})" >&2
  exit 1
fi
