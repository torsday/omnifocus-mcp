#!/usr/bin/env bash
# scripts/build-calendar-bridge.sh — compile the Swift EventKit bridge binary.
#
# Per ADR-0018, the calendar bridge is a Swift subprocess that the Node MCP
# server spawns to access EventKit. This script mirrors `build-watcher.sh`:
# the watcher and the bridge follow the same single-purpose-Swift-binary
# pattern, so their build pipelines stay parallel for future maintenance.
#
# Produces:
#   bin/calendar-bridge-darwin-arm64   (Apple Silicon)
#   bin/calendar-bridge-darwin-x64     (Intel)
#   bin/calendar-bridge                (fat universal binary via lipo)
#
# Usage:
#   ./scripts/build-calendar-bridge.sh           # build for current arch only
#   ./scripts/build-calendar-bridge.sh --all     # build both arches + fat binary
#   ./scripts/build-calendar-bridge.sh --verify  # compile-check only, no output
#
# Requirements: swiftc (Xcode Command Line Tools — `xcode-select --install`)
#
# The resulting binaries are gitignored and built on demand. If the binary is
# absent at runtime, the calendar resources will fail with a typed
# `CalendarBridgeNotAvailable` error (see ADR-0018 + #484 implementation
# slices) rather than crash — same fallback discipline as the watcher.
#
# This commit ships the **scaffold only**: the source under
# tools/calendar-bridge/ implements a `ping` subcommand that emits stable
# scaffold JSON and exits. No EventKit calls yet.

set -euo pipefail

SWIFT_SOURCE="tools/calendar-bridge/calendar-bridge.swift"
BIN_DIR="bin"
SWIFT_FLAGS="-O -wmo"  # whole-module optimisation, fast, small

# Resolve repo root relative to this script.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v swiftc &>/dev/null; then
  echo "error: swiftc not found. Install Xcode Command Line Tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"

case "${1:-}" in
  --verify)
    echo "Verifying Swift source compiles…"
    swiftc $SWIFT_FLAGS -typecheck "$SWIFT_SOURCE"
    echo "OK"
    exit 0
    ;;

  --all)
    echo "Building arm64…"
    swiftc $SWIFT_FLAGS -target arm64-apple-macosx12.0 \
      "$SWIFT_SOURCE" -o "$BIN_DIR/calendar-bridge-darwin-arm64"

    echo "Building x86_64…"
    swiftc $SWIFT_FLAGS -target x86_64-apple-macosx12.0 \
      "$SWIFT_SOURCE" -o "$BIN_DIR/calendar-bridge-darwin-x64"

    echo "Creating universal binary…"
    lipo -create \
      "$BIN_DIR/calendar-bridge-darwin-arm64" \
      "$BIN_DIR/calendar-bridge-darwin-x64" \
      -output "$BIN_DIR/calendar-bridge"

    echo "Done. Binaries:"
    ls -lh "$BIN_DIR"/calendar-bridge*
    ;;

  *)
    ARCH="$(uname -m)"
    if [[ "$ARCH" == "arm64" ]]; then
      TARGET="arm64-apple-macosx12.0"
      OUT="$BIN_DIR/calendar-bridge-darwin-arm64"
    else
      TARGET="x86_64-apple-macosx12.0"
      OUT="$BIN_DIR/calendar-bridge-darwin-x64"
    fi

    echo "Building $ARCH binary…"
    swiftc $SWIFT_FLAGS -target "$TARGET" "$SWIFT_SOURCE" -o "$OUT"
    # Symlink to the canonical name the Node consumer (future slice) will look for.
    ln -sf "$(basename "$OUT")" "$BIN_DIR/calendar-bridge"
    echo "Built: $OUT"
    ;;
esac
