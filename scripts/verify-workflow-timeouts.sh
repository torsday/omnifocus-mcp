#!/usr/bin/env bash
# verify-workflow-timeouts.sh — fail if any workflow job lacks `timeout-minutes`.
#
# A job without `timeout-minutes` falls back to GitHub's 6-hour default,
# which on a single self-hosted runner means a wedged step can starve the
# queue for the rest of the day. The 2026-05-10 incident hit this exactly
# (#912 added a 30m cap on `integration.yml`'s heavy job after a hung
# osascript held the runner for 70+ minutes). This guard codifies the
# lesson: every job declares an explicit timeout, picked by the workflow
# author against the work they actually do, with a regression catch at PR
# time so the next workflow can't drift back.
#
# Wired into meta-lint.yml's `workflow-timeouts` job. Runs on ubuntu-latest
# under PR; uses python3 + PyYAML, both preinstalled on GitHub-hosted
# runners.
#
# Skips reusable-workflow callers (`uses:` job entries) — those carry
# their timeouts inside the called workflow.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import sys
import yaml
from pathlib import Path

violations = []
for f in sorted(Path(".github/workflows").glob("*.yml")):
    try:
        data = yaml.safe_load(f.read_text())
    except yaml.YAMLError as e:
        print(f"::error file={f}::failed to parse YAML: {e}", file=sys.stderr)
        sys.exit(1)
    jobs = (data or {}).get("jobs") or {}
    for job_name, job_def in jobs.items():
        if not isinstance(job_def, dict):
            continue
        # Reusable-workflow caller — timeout lives inside the called workflow.
        if "uses" in job_def:
            continue
        if "timeout-minutes" not in job_def:
            violations.append(f"{f}::{job_name}")

if violations:
    print("::error::Workflow jobs missing timeout-minutes:", file=sys.stderr)
    for v in violations:
        print(f"  - {v}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Every job needs an explicit `timeout-minutes:` value picked against the work it does.", file=sys.stderr)
    print("Without one a hung step holds the runner for the GitHub default of 6h. Pick a value", file=sys.stderr)
    print("a few times the typical wall time so a true stall surfaces as a clean failure.", file=sys.stderr)
    print("See `.github/workflows/integration.yml` or `ci.yml` for examples.", file=sys.stderr)
    sys.exit(1)

print("ok: every workflow job declares timeout-minutes")
PY
