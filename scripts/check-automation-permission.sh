#!/usr/bin/env bash
# check-automation-permission.sh
#
# Verify that the running shell process has macOS Automation permission to
# send Apple Events to OmniFocus. Exits 0 when permission is granted, exits
# 1 with an actionable diagnostic when it is not.
#
# Usage:
#   ./scripts/check-automation-permission.sh
#
# CI: call this as a step before `pnpm test:integration` so that a missing
# Automation permission produces a clear error message rather than a generic
# "JXA script returned empty stdout" failure.
#
# Detection mechanism:
#   `osascript` exits non-zero and writes "Not authorized to send Apple
#   events to OmniFocus" to stderr (error code -1743) when Automation
#   permission is absent. The script captures stderr and checks for the
#   known error string.

set -euo pipefail

OMNIFOCUS_BUNDLE="com.omnigroup.OmniFocus4"
TEST_SCRIPT='Application("OmniFocus").name()'

# Run a minimal JXA script that requires Automation access to OmniFocus.
STDERR_OUTPUT=$(osascript -l JavaScript -e "$TEST_SCRIPT" 2>&1 >/dev/null || true)

if echo "$STDERR_OUTPUT" | grep -q "Not authorized to send Apple events"; then
  echo "::error::macOS Automation permission for OmniFocus is not granted."
  echo ""
  echo "Fix: grant Automation access in System Settings:"
  echo "  System Settings → Privacy & Security → Automation"
  echo "  → Find the terminal/runner process (e.g. bash, zsh, GitHub Actions runner)"
  echo "  → Enable the toggle next to OmniFocus"
  echo ""
  echo "If running on a fresh macOS install or after a macOS update:"
  echo "  1. Open System Settings → Privacy & Security → Automation"
  echo "  2. Locate the process used by the CI runner (often 'bash' or the runner agent)"
  echo "  3. Enable the OmniFocus toggle"
  echo "  4. Re-run the integration tests"
  echo ""
  echo "For local development: run the failing test once interactively —"
  echo "  OMNIFOCUS_INTEGRATION=1 pnpm test:integration"
  echo "macOS will prompt for Automation permission on the first run."
  exit 1
fi

if echo "$STDERR_OUTPUT" | grep -qi "error"; then
  echo "::warning::Unexpected osascript error during permission check: $STDERR_OUTPUT"
fi

echo "✓ Automation permission for OmniFocus is granted."
