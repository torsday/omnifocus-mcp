#!/usr/bin/env bash
# Verify omnifocus://intents references only registered tools / prompts /
# resources. The lint logic lives in src/resources/intents.test.ts so the
# rule runs every commit via `pnpm test`. This wrapper exists for ad-hoc
# invocation and CI workflows that want to gate on intents alone.
#
# Exit code: 0 = clean, non-zero = at least one drifted reference.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec pnpm vitest run src/resources/intents.test.ts
