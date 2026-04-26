#!/usr/bin/env bash
# scripts/build-watcher.sh — compile the Swift FSEventStream watcher binary.
#
# Produces:
#   bin/omnifocus-watcher-darwin-arm64   (Apple Silicon)
#   bin/omnifocus-watcher-darwin-x64     (Intel)
#   bin/omnifocus-watcher                (fat universal binary via lipo)
#
# Usage:
#   ./scripts/build-watcher.sh           # build for current arch only
#   ./scripts/build-watcher.sh --all     # build both arches + fat binary
#   ./scripts/build-watcher.sh --verify  # compile-check only, no output
#
# Requirements: swiftc (Xcode Command Line Tools — `xcode-select --install`)
#
# The resulting binaries are gitignored and must be present for
# DatabaseWatcher to use the Swift fast path. If the binary is absent,
# DatabaseWatcher falls back to Node fs.watch automatically.

set -euo pipefail

SWIFT_SOURCE="tools/watcher/omnifocus-watcher.swift"
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
      "$SWIFT_SOURCE" -o "$BIN_DIR/omnifocus-watcher-darwin-arm64"

    echo "Building x86_64…"
    swiftc $SWIFT_FLAGS -target x86_64-apple-macosx12.0 \
      "$SWIFT_SOURCE" -o "$BIN_DIR/omnifocus-watcher-darwin-x64"

    echo "Creating universal binary…"
    lipo -create \
      "$BIN_DIR/omnifocus-watcher-darwin-arm64" \
      "$BIN_DIR/omnifocus-watcher-darwin-x64" \
      -output "$BIN_DIR/omnifocus-watcher"

    echo "Done. Binaries:"
    ls -lh "$BIN_DIR"/omnifocus-watcher*
    ;;

  *)
    ARCH="$(uname -m)"
    if [[ "$ARCH" == "arm64" ]]; then
      TARGET="arm64-apple-macosx12.0"
      OUT="$BIN_DIR/omnifocus-watcher-darwin-arm64"
    else
      TARGET="x86_64-apple-macosx12.0"
      OUT="$BIN_DIR/omnifocus-watcher-darwin-x64"
    fi

    echo "Building $ARCH binary…"
    swiftc $SWIFT_FLAGS -target "$TARGET" "$SWIFT_SOURCE" -o "$OUT"
    # Symlink to the canonical name DatabaseWatcher looks for.
    ln -sf "$(basename "$OUT")" "$BIN_DIR/omnifocus-watcher"
    echo "Built: $OUT"
    ;;
esac
