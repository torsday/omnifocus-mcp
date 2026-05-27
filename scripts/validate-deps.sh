#!/usr/bin/env bash
# =============================================================================
# validate-deps.sh — audit the "Blocked by: #N" dependency graph
# =============================================================================
# Parses every open issue's body for `- Blocked by: #N` lines and reports:
#
#   1. Cycles — issue A blocked by B blocked by … blocked by A
#   2. Orphan references — "Blocked by: #N" where #N doesn't exist
#   3. Stale blocks — dependent is open/blocked but blocker is already closed
#
# Exits nonzero if any issue is found, so this can gate `/groom` or CI.
# Prints a human-readable report on stderr. Safe to run read-only.
#
# Uses only bash 3.2 features (no associative arrays) for macOS compatibility.
# Intermediate state lives in a TSV table: `number<TAB>state<TAB>blockers...`.
#
# Example:
#   ./scripts/validate-deps.sh
#   ./scripts/validate-deps.sh --repo torsday/some-other-repo
# =============================================================================
set -euo pipefail

REPO="torsday/omnifocus-mcp"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

TABLE="$(mktemp -t validate-deps.XXXXXX)"
trap 'rm -f "$TABLE"' EXIT

echo "==> Fetching all issues (open + closed) from $REPO" >&2
# TSV: number \t state \t space-separated-blockers
gh issue list --repo "$REPO" --state all --limit 2000 \
  --json number,state,body \
  --jq '.[] | [
    (.number|tostring),
    .state,
    (
      (.body // "")
      | scan("(?i)blocked by:?\\s*#[0-9]+(?:,\\s*#[0-9]+)*")
      | scan("#[0-9]+")
      | sub("#"; "")
    )
  ] | @tsv' \
  > "$TABLE.raw"

# jq's @tsv emits one row per blocker; collapse back to one row per issue.
awk -F'\t' '
  {
    key = $1 "\t" $2
    if ($3 != "") blockers[key] = (blockers[key] == "" ? $3 : blockers[key] " " $3)
    else if (!(key in blockers)) blockers[key] = ""
    seen[key] = 1
  }
  END {
    for (k in seen) print k "\t" blockers[k]
  }
' "$TABLE.raw" | sort -n > "$TABLE"
rm -f "$TABLE.raw"

total=$(wc -l < "$TABLE" | tr -d ' ')
with_deps=$(awk -F'\t' '$3 != "" {c++} END {print c+0}' "$TABLE")
echo "==> Parsed $total issues; $with_deps have blocker refs" >&2

# Helpers for lookups.
state_of() { awk -F'\t' -v n="$1" '$1 == n {print $2; exit}' "$TABLE"; }
blockers_of() { awk -F'\t' -v n="$1" '$1 == n {print $3; exit}' "$TABLE"; }
exists() { awk -F'\t' -v n="$1" '$1 == n {found=1; exit} END {exit !found}' "$TABLE"; }

# ── 1. Orphan references ────────────────────────────────────────────────────
orphans=()
while IFS=$'\t' read -r num _ blks; do
  [ -z "$blks" ] && continue
  for b in $blks; do
    if ! exists "$b"; then
      orphans+=("#$num references #$b, which doesn't exist")
    fi
  done
done < "$TABLE"

# ── 2. Stale blocks (blocker closed, dependent still open) ──────────────────
stale=()
while IFS=$'\t' read -r num state blks; do
  [ "$state" = "OPEN" ] || continue
  [ -z "$blks" ] && continue
  for b in $blks; do
    bs="$(state_of "$b")"
    [ -z "$bs" ] && continue  # orphan, reported above
    if [ "$bs" = "CLOSED" ]; then
      stale+=("#$num (open) blocked by #$b (closed) — unblock or close")
    fi
  done
done < "$TABLE"

# ── 3. Cycle detection (iterative DFS via color marking) ────────────────────
# Colors: unvisited (absent), "gray" (on stack), "black" (fully explored).
# Use two flat files as the color maps.
GRAY="$(mktemp -t validate-deps-gray.XXXXXX)"
BLACK="$(mktemp -t validate-deps-black.XXXXXX)"
trap 'rm -f "$TABLE" "$GRAY" "$BLACK"' EXIT
cycles=()

mark_gray()  { echo "$1" >> "$GRAY"; }
unmark_gray() { grep -v "^$1$" "$GRAY" > "$GRAY.tmp" 2>/dev/null || true; mv "$GRAY.tmp" "$GRAY" 2>/dev/null || : > "$GRAY"; }
mark_black() { echo "$1" >> "$BLACK"; }
is_gray()    { grep -qx "$1" "$GRAY" 2>/dev/null; }
is_black()   { grep -qx "$1" "$BLACK" 2>/dev/null; }

visit() {
  local node="$1" path="$2"
  mark_gray "$node"
  local blks; blks="$(blockers_of "$node")"
  for b in $blks; do
    exists "$b" || continue
    if is_gray "$b"; then
      cycles+=("$path → #$b (cycle)")
    elif ! is_black "$b"; then
      visit "$b" "$path → #$b"
    fi
  done
  unmark_gray "$node"
  mark_black "$node"
}

while IFS=$'\t' read -r num _ _; do
  is_black "$num" && continue
  visit "$num" "#$num"
done < "$TABLE"

# ── Report ──────────────────────────────────────────────────────────────────
problems=0

echo "" >&2
if [ ${#orphans[@]} -gt 0 ]; then
  echo "⚠️  Orphan blocker references (${#orphans[@]}):" >&2
  printf '    %s\n' "${orphans[@]}" >&2
  problems=$((problems + ${#orphans[@]}))
fi

if [ ${#stale[@]} -gt 0 ]; then
  echo "⚠️  Stale blocks — blocker closed but dependent still open (${#stale[@]}):" >&2
  printf '    %s\n' "${stale[@]}" >&2
  problems=$((problems + ${#stale[@]}))
fi

if [ ${#cycles[@]} -gt 0 ]; then
  echo "⚠️  Dependency cycles (${#cycles[@]}):" >&2
  printf '    %s\n' "${cycles[@]}" >&2
  problems=$((problems + ${#cycles[@]}))
fi

if [ "$problems" -eq 0 ]; then
  echo "✓ Dependency graph clean — no orphans, no stale blocks, no cycles" >&2
  exit 0
fi

echo "" >&2
echo "Found $problems issue(s). Fix via \`/groom\` or manual edits." >&2
exit 1
