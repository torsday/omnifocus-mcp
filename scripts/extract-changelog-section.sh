#!/usr/bin/env bash
# extract-changelog-section.sh <version>
#
# Print the body of a single CHANGELOG.md section (Keep-a-Changelog format).
# Captures everything from `## [<version>] …` up to (but not including) the
# next `## […` heading, with trailing horizontal rules and blank lines
# trimmed so the output drops cleanly into a GitHub Release body.
#
# This is the single source of truth for CHANGELOG-section extraction.
# Both `release.yml` and the `/release` slash command call it so the
# parsing rules only ever live in one place.
#
# Usage:
#   ./scripts/extract-changelog-section.sh 1.0.0
#   ./scripts/extract-changelog-section.sh v1.0.0     # leading "v" tolerated
#
# Exits 1 with `::error::` annotation when CHANGELOG is missing or the
# requested section doesn't exist — caller fails loudly rather than
# silently producing an empty release body.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION="${1:?usage: extract-changelog-section.sh <version>}"
VERSION="${VERSION#v}"   # tolerate "v1.0.0"

CHANGELOG="CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
  echo "::error::$CHANGELOG not found" >&2
  exit 1
fi

# Awk handles BSD/GNU consistency. The previous sed | head -n -1 idiom
# in the skill silently produced wrong output on macOS BSD utilities.
#
# Stop conditions while in-section: next `## […` heading OR a Markdown
# link-reference definition (`[label]: url` at column 0). The link-ref
# stop matters when the target section is the LAST one in the file —
# otherwise the link-ref block at the bottom would leak into the output.
SECTION=$(awk -v ver="$VERSION" '
  /^## \[/ {
    if (in_section) exit
    if ($0 ~ "^## \\[" ver "\\]") in_section = 1
  }
  /^\[.+\]:[[:space:]]/ {
    if (in_section) exit
  }
  in_section { lines[++n] = $0 }
  END {
    # Trim trailing blank lines and horizontal rules so the GH Release
    # body does not end on a stray "---" between adjacent sections.
    last = n
    while (last > 0 && (lines[last] == "" || lines[last] == "---")) last--
    for (i = 1; i <= last; i++) print lines[i]
  }
' "$CHANGELOG")

if [ -z "$SECTION" ]; then
  echo "::error::CHANGELOG.md has no [$VERSION] section. Add the section before tagging." >&2
  exit 1
fi

printf '%s\n' "$SECTION"
