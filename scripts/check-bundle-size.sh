#!/usr/bin/env bash
# check-bundle-size.sh
#
# Report the size of the built `dist/index.js` bundle. **Informational only**
# as of #910 (2026-05-10) — this script does NOT block CI. It prints the size
# every time and emits a `::warning::` annotation when the bundle exceeds the
# soft threshold so the trend stays visible in PR check UIs.
#
# Why informational, not blocking: between launch and 2026-05-10 the gate
# tracked a hard cap that was bumped 15 times (500 → 850 KiB) without ever
# catching a real regression. Each bump cost a follow-up PR and blocked
# unrelated work in the meantime. For a Node 24 CLI distributed via npm +
# Homebrew, the difference between today's bundle and a 2 MiB one is tens of
# milliseconds of cold-install / parse cost — dominated by other factors.
# The case for a hard gate at our current size is materially weaker than the
# friction it produces. Soft warning preserves the signal that drives the
# tree-shaking work tracked in #578 (investigation) and #827 (audit).
#
# Usage (run after `pnpm build`):
#   ./scripts/check-bundle-size.sh
#
# Always exits 0 except when `dist/index.js` is missing (caller didn't build).
# Re-arming the hard gate is a one-line revert: change `exit 0` to `exit 1` in
# the over-soft-threshold branch.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BUNDLE="dist/index.js"

# Soft threshold — bundle sizes above this trigger a CI warning annotation
# but do NOT fail the check. Update freely when meaningful work raises the
# steady-state size; the cost of getting this wrong is now a warning, not a
# blocked PR.
#
# History (when this was a hard gate, retained for context):
# 850 KiB on 2026-05-10 alongside #907 after the eight-PR perf+input-validation
# merge wave pushed the bundle to 840804 bytes; #812 had bumped 820 → 824 KiB
# the same day for the cache byte-cap. Earlier bumps:
# 800 KiB alongside #705 (buildFolder shared JXA helper);
# 780 KiB alongside #687 (lookupOrThrow shared JXA helper);
# 760 KiB alongside #686 (DRY JXA scripts, buildTask helper);
# 740 KiB alongside #689 (ban-empty-catch comment payload);
# 700 KiB alongside #681; 680 KiB alongside #483 slice 1 (webhooks);
# 660 KiB alongside #485 slice 1 (decision-journal); 640 KiB alongside
# #484; 625 KiB alongside #577; 610 KiB alongside #570; 580 KiB alongside
# #494; 540, 525, originally 500 KiB.
SOFT_THRESHOLD=870400

if [ ! -f "$BUNDLE" ]; then
  echo "::error::$BUNDLE not found — run 'pnpm build' first." >&2
  exit 1
fi

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
KIB=$((SIZE / 1024))
SOFT_KIB=$((SOFT_THRESHOLD / 1024))
echo "$BUNDLE: ${SIZE} bytes (${KIB} KiB; soft threshold: ${SOFT_KIB} KiB)"

if [ "$SIZE" -gt "$SOFT_THRESHOLD" ]; then
  OVER=$((SIZE - SOFT_THRESHOLD))
  echo "::warning::bundle is ${KIB} KiB, ${OVER} bytes over the ${SOFT_KIB} KiB soft threshold — tree-shaking work tracked in #578 / #827"
fi
