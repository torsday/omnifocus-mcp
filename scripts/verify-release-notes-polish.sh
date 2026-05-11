#!/usr/bin/env bash
# verify-release-notes-polish.sh — fail release-please PRs whose CHANGELOG
# section is still in raw bot-output shape.
#
# Three releases on 2026-05-10 (v1.4.0, v1.5.0, v1.5.1) shipped with raw
# release-please output as their CHANGELOG sections — bulleted Conventional
# Commit subject lines, no Summary paragraph, no narrative. That regressed
# the standard the project established with v1.3.0 / v1.0.0 (verbose
# "context + technical detail + impact" entries). The polish step in
# .claude/commands/release.md (run `/release-notes` against the
# release-please PR before merging) is canonical but was skipped.
#
# This script is the machine-checkable guard: when a release-please PR is
# opened or updated, scan the newly-added CHANGELOG section for bot-shape
# signatures and fail the build if no narrative has been added.
#
# Wired into meta-lint.yml's `release-notes-polish` job.
#
# Skips:
#   - Non-release-please PRs (head ref doesn't start with `release-please--`).
#   - PRs labelled `release-notes-polish-ack` (escape hatch for the rare
#     case where bot output is genuinely the right call — e.g. a one-line
#     patch release that doesn't warrant a narrative).
#
# Heuristic for "raw bot output":
#   - Section has no `**Summary** —` paragraph between the version header
#     and the first `### Section` heading.
#   - All bullets match the single-line bot pattern:
#       * **scope:** message ([#N](url)) ([sha](url))[, closes [#M](url)]
#
# Polished sections always have:
#   - A Summary paragraph
#   - Multi-line bullets with prose context
#
# False positive direction: rejecting a polished section is easier to
# fix (run /release-notes properly, or add the ack label) than letting
# bot output slip through unnoticed.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Only run on release-please PRs. The CI workflow narrows this further but
# the script is also runnable locally — be defensive.
PR_HEAD_REF="${GITHUB_HEAD_REF:-}"
case "$PR_HEAD_REF" in
  release-please--*) : ;;
  "")
    # Local invocation: scan the CHANGELOG.md as-is, against the most
    # recent header. Useful for sanity-checking a polish pass before push.
    PR_HEAD_REF="local"
    ;;
  *)
    echo "ok: not a release-please PR (head=$PR_HEAD_REF) — skipping polish check"
    exit 0
    ;;
esac

# Escape hatch label.
if [ -n "${PR_LABELS:-}" ] && echo "$PR_LABELS" | grep -q "release-notes-polish-ack"; then
  echo "ok: release-notes-polish-ack label set — bot-output release permitted"
  exit 0
fi

# Extract the first (newest) `## [vX.Y.Z]...` section from CHANGELOG.md.
# Bash awk is bash-3.2-compatible (macOS default).
section=$(awk '
  /^## \[[0-9]+\.[0-9]+\.[0-9]+\]/ {
    if (started) exit
    started = 1
    print
    next
  }
  started { print }
' CHANGELOG.md)

if [ -z "$section" ]; then
  echo "::warning::no version section found in CHANGELOG.md — nothing to lint"
  exit 0
fi

# Heuristic 1: must have a Summary paragraph between the header and the
# first `### Section` heading.
has_summary=$(echo "$section" | awk '
  /^### / { exit }
  /\*\*Summary\*\* —/ { print "yes"; exit }
')

if [ "$has_summary" != "yes" ]; then
  cat <<EOF >&2
::error::CHANGELOG section appears unpolished — no \`**Summary** —\` paragraph found between the version header and the first \`### Section\` heading.

This project's release standard (established by v1.3.0 / v1.0.0 / v1.5.1) requires:
  - A \`**Summary** —\` paragraph at the top of each version block
  - Multi-line bullets with prose context (not single-line Conventional Commit subjects)

Fix: run \`/release-notes\` against this PR's diff to rewrite the auto-generated entries
as user-facing narrative, then commit the polished version into the PR.

See .claude/commands/release.md "Polish guidance for this repo" for the canonical
voice and v1.3.0's CHANGELOG section as the worked example.

Escape hatch: add the \`release-notes-polish-ack\` label to this PR if the bot output
is genuinely the right call for this release (e.g. a one-line patch).
EOF
  exit 1
fi

# Heuristic 2: bullets must not be entirely single-line bot pattern.
# If literally every bullet matches the bot regex AND none has a follow-up
# context paragraph or sub-bullet, the polish never happened.
bot_pattern='^\* \*\*[a-z][a-z0-9-]+:\*\*'
total_bullets=$(echo "$section" | grep -cE '^\* ' || true)
bot_bullets=$(echo "$section" | grep -cE "$bot_pattern" || true)

if [ "$total_bullets" -gt 0 ] && [ "$bot_bullets" = "$total_bullets" ]; then
  # All bullets are bot-shape — check if any has a continuation line.
  # Polished bullets have prose continuation indented under them.
  continuations=$(echo "$section" | awk '
    /^\* / { in_bullet = 1; bullet_lines = 1; next }
    /^[a-zA-Z0-9]/ && in_bullet { in_bullet = 0 }
    /^  / && in_bullet { bullet_lines++ }
    bullet_lines > 1 { print "yes"; exit }
  ')

  if [ "$continuations" != "yes" ]; then
    cat <<EOF >&2
::error::CHANGELOG section appears unpolished — all $total_bullets bullets are single-line Conventional Commit subjects with no prose continuation.

A polished bullet looks like:
  - **scope: short imperative ([#N](pr-url))** — multi-sentence narrative that
    explains the context, the technical detail, and the user-visible impact.
    Optionally followed by code examples or before/after framing.

Fix: run \`/release-notes\` and rewrite the bullets with full context.
See v1.3.0's CHANGELOG section as the worked example.

Escape hatch: \`release-notes-polish-ack\` label.
EOF
    exit 1
  fi
fi

echo "ok: CHANGELOG section appears polished (has Summary + non-trivial bullets)"
