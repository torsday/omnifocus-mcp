/**
 * Smoke tests for scripts/board-mutate.sh (#847).
 *
 * Spawns the bash script as a subprocess. Mocks `gh` via a shim on PATH so
 * mutation/verify paths run without hitting the live GitHub API.
 *
 * Coverage targets (per #847 AC):
 *   exit 0  success — every verb in the surface
 *   exit 2  invalid usage / missing args
 *   exit 3  _project-constants.sh missing or required vars unfilled
 *   exit 4  unknown verb
 *   exit 5  unknown value for verb
 *   exit 6  mutation API call failed
 *   exit 7  round-trip verification failed
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/board-mutate.sh");

/**
 * Build a self-contained sandbox: a temp dir with a copy of board-mutate.sh,
 * a stub _project-constants.sh, and a mock `gh` whose behavior is controlled
 * by a per-test flag file.
 *
 * `ghMode` controls how the mock gh responds:
 *   "ok"        — mutation succeeds, verify returns the option ID just written
 *   "fail"      — mutation exits non-zero
 *   "drift"     — mutation succeeds, verify returns a different option ID
 */
function makeSandbox(ghMode: "ok" | "fail" | "drift") {
  const dir = mkdtempSync(join(tmpdir(), "board-mutate-test-"));
  const scripts = join(dir, "scripts");
  const bin = join(dir, "bin");
  mkdirSync(scripts);
  mkdirSync(bin);

  // Copy the script under test into place so its SCRIPT_DIR resolves to our scripts/
  const scriptCopy = join(scripts, "board-mutate.sh");
  const fs = require("node:fs") as typeof import("node:fs");
  fs.copyFileSync(SCRIPT, scriptCopy);
  chmodSync(scriptCopy, 0o755);

  // Stub constants — every variable the script may resolve, with synthetic IDs
  // so we can assert what option ID flows into the mock gh.
  writeFileSync(
    join(scripts, "_project-constants.sh"),
    [
      `OWNER="testorg"`,
      `PROJECT_ID="PVT_test"`,
      `F_STATUS="F_STATUS_ID"`,
      `F_PRIORITY="F_PRIORITY_ID"`,
      `F_SIZE="F_SIZE_ID"`,
      `F_PHASE="F_PHASE_ID"`,
      `F_RISK="F_RISK_ID"`,
      `F_MODEL_QUEUE="F_MODEL_QUEUE_ID"`,
      `STATUS_BACKLOG="opt_status_backlog"`,
      `STATUS_UP_NEXT="opt_status_up_next"`,
      `STATUS_IN_PROGRESS="opt_status_in_progress"`,
      `STATUS_IN_REVIEW="opt_status_in_review"`,
      `STATUS_ON_HOLD="opt_status_on_hold"`,
      `STATUS_DONE="opt_status_done"`,
      `O_P0="opt_p0"`,
      `O_P1="opt_p1"`,
      `O_P2="opt_p2"`,
      `O_P3="opt_p3"`,
      `O_SIZE_XS="opt_size_xs"`,
      `O_SIZE_S="opt_size_s"`,
      `O_SIZE_M="opt_size_m"`,
      `O_SIZE_L="opt_size_l"`,
      `O_SIZE_XL="opt_size_xl"`,
      `O_PHASE_M0="opt_phase_m0"`,
      `O_PHASE_M1="opt_phase_m1"`,
      `O_PHASE_M2="opt_phase_m2"`,
      `O_PHASE_M3="opt_phase_m3"`,
      `O_PHASE_M4="opt_phase_m4"`,
      `O_PHASE_M5="opt_phase_m5"`,
      `O_RISK_LOW="opt_risk_low"`,
      `O_RISK_MED="opt_risk_med"`,
      `O_RISK_HIGH="opt_risk_high"`,
      `O_MQ_SONNET_LOW="opt_mq_sonnet_low"`,
      `O_MQ_OPUS_MED="opt_mq_opus_med"`,
      `O_MQ_OPUS_HIGH="opt_mq_opus_high"`,
      `O_MQ_OPUS_1M_MAX="opt_mq_opus_1m_max"`,
      `O_MQ_IN_PROGRESS="opt_mq_in_progress"`,
      `O_MQ_IN_REVIEW="opt_mq_in_review"`,
      `O_MQ_ON_HOLD="opt_mq_on_hold"`,
      `O_MQ_DONE="opt_mq_done"`,
      "",
    ].join("\n"),
  );

  // Mock gh — distinguishes mutation vs query by the presence of `mutation(` in
  // the -f query argument. The mutation captures the `-f o=...` value into a
  // sidecar file so the query path can echo it back (or a deliberate drift).
  const stateFile = join(dir, "last-mutation-opt");
  const ghScript = `#!/usr/bin/env bash
# Mock gh for board-mutate.sh tests.
# Mode: ${ghMode}
mode="${ghMode}"

# Slurp args. Look for: -f query=..., -f o=..., --jq <expr>.
# Real \`gh ... --jq <expr>\` filters server-side; our mock applies it locally
# via the system \`jq\` so the script's parsing logic sees the same shape.
query=""
opt_arg=""
jq_expr=""
prev=""
for a in "$@"; do
  case "$prev" in
    -f)
      case "$a" in
        query=*) query="\${a#query=}" ;;
        o=*)     opt_arg="\${a#o=}" ;;
      esac ;;
    --jq) jq_expr="$a" ;;
  esac
  prev="$a"
done

is_mutation=0
case "$query" in *mutation*) is_mutation=1 ;; esac

emit() {
  if [ -n "$jq_expr" ]; then
    /usr/bin/env jq -r "$jq_expr"
  else
    cat
  fi
}

if [ "$is_mutation" = "1" ]; then
  if [ "$mode" = "fail" ]; then
    echo "mock gh: simulated mutation failure" >&2
    exit 1
  fi
  echo "$opt_arg" > "${stateFile}"
  echo '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"x"}}}}' | emit
  exit 0
fi

# query path — emit one entry per field id with the option captured at mutation
# time (or a deliberate drift). The script's --jq filter selects the right one.
last="$(cat "${stateFile}" 2>/dev/null || echo "")"
if [ "$mode" = "drift" ]; then
  last="DRIFT_DIFFERENT_OPT"
fi
cat <<EOF | emit
{"data":{"node":{"fieldValues":{"nodes":[
  {"field":{"id":"F_STATUS_ID"},"optionId":"$last"},
  {"field":{"id":"F_PRIORITY_ID"},"optionId":"$last"},
  {"field":{"id":"F_SIZE_ID"},"optionId":"$last"},
  {"field":{"id":"F_PHASE_ID"},"optionId":"$last"},
  {"field":{"id":"F_RISK_ID"},"optionId":"$last"},
  {"field":{"id":"F_MODEL_QUEUE_ID"},"optionId":"$last"}
]}}}}
EOF
`;
  writeFileSync(join(bin, "gh"), ghScript);
  chmodSync(join(bin, "gh"), 0o755);

  return { dir, scriptCopy, bin };
}

function run(scriptPath: string, bin: string, args: string[]) {
  return spawnSync("bash", [scriptPath, ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });
}

let sandboxes: string[] = [];

afterEach(() => {
  // Clean up sandboxes created in this test
  const fs = require("node:fs") as typeof import("node:fs");
  for (const dir of sandboxes) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  sandboxes = [];
});

describe("board-mutate.sh", () => {
  describe("usage / arg validation", () => {
    it("--help exits 0 and prints the verb surface", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("flip-status");
      expect(r.stdout).toContain("set-model-queue");
    });

    it("no args exits 2 with usage line", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("usage:");
    });

    it("two args exits 2", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X"]);
      expect(r.status).toBe(2);
    });
  });

  describe("missing constants → exit 3", () => {
    it("exits 3 when _project-constants.sh is absent", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const fs = require("node:fs") as typeof import("node:fs");
      fs.rmSync(join(dir, "scripts/_project-constants.sh"));
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "done"]);
      expect(r.status).toBe(3);
      expect(r.stderr).toContain("not found");
    });

    it("exits 3 when PROJECT_ID is unfilled (placeholder)", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      writeFileSync(
        join(dir, "scripts/_project-constants.sh"),
        `PROJECT_ID="YOUR_PROJECT_NODE_ID"\n`,
      );
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "done"]);
      expect(r.status).toBe(3);
      expect(r.stderr).toContain("PROJECT_ID");
    });
  });

  describe("verb / value validation", () => {
    it("unknown verb exits 4", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["bogus-verb", "ITEM_X", "value"]);
      expect(r.status).toBe(4);
      expect(r.stderr).toContain("unknown verb");
    });

    it("unknown value for known verb exits 5", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "warp-speed"]);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain("unknown value");
    });

    it("value valid by name but option ID unset locally exits 5", () => {
      const { scriptCopy, bin, dir } = makeSandbox("ok");
      sandboxes.push(dir);
      // Wipe the specific option ID; everything else stays valid
      const fs = require("node:fs") as typeof import("node:fs");
      const constants = fs.readFileSync(join(dir, "scripts/_project-constants.sh"), "utf8");
      fs.writeFileSync(
        join(dir, "scripts/_project-constants.sh"),
        constants.replace(/STATUS_DONE="[^"]*"/, `STATUS_DONE=""`),
      );
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "done"]);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain("STATUS_DONE");
    });
  });

  describe("API failures", () => {
    it("mutation failure exits 6", () => {
      const { scriptCopy, bin, dir } = makeSandbox("fail");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "done"]);
      expect(r.status).toBe(6);
      expect(r.stderr).toContain("mutation API call failed");
    });

    it("round-trip verification failure exits 7", () => {
      const { scriptCopy, bin, dir } = makeSandbox("drift");
      sandboxes.push(dir);
      const r = run(scriptCopy, bin, ["flip-status", "ITEM_X", "done"]);
      expect(r.status).toBe(7);
      expect(r.stderr).toContain("did not persist");
    });
  });

  describe("happy paths — every verb resolves to the right option ID", () => {
    const cases: Array<{ verb: string; value: string; expectOpt: string }> = [
      { verb: "flip-status", value: "backlog", expectOpt: "opt_status_backlog" },
      { verb: "flip-status", value: "up-next", expectOpt: "opt_status_up_next" },
      {
        verb: "flip-status",
        value: "in-progress",
        expectOpt: "opt_status_in_progress",
      },
      { verb: "flip-status", value: "in-review", expectOpt: "opt_status_in_review" },
      { verb: "flip-status", value: "on-hold", expectOpt: "opt_status_on_hold" },
      { verb: "flip-status", value: "done", expectOpt: "opt_status_done" },
      // case-insensitivity
      { verb: "flip-status", value: "DONE", expectOpt: "opt_status_done" },
      { verb: "flip-status", value: "Up Next", expectOpt: "opt_status_up_next" },

      { verb: "set-priority", value: "P0", expectOpt: "opt_p0" },
      { verb: "set-priority", value: "p3", expectOpt: "opt_p3" },

      { verb: "set-size", value: "XS", expectOpt: "opt_size_xs" },
      { verb: "set-size", value: "L", expectOpt: "opt_size_l" },

      { verb: "set-phase", value: "M0", expectOpt: "opt_phase_m0" },
      { verb: "set-phase", value: "m5", expectOpt: "opt_phase_m5" },

      { verb: "set-risk", value: "low", expectOpt: "opt_risk_low" },
      { verb: "set-risk", value: "medium", expectOpt: "opt_risk_med" },
      { verb: "set-risk", value: "med", expectOpt: "opt_risk_med" },
      { verb: "set-risk", value: "high", expectOpt: "opt_risk_high" },

      {
        verb: "set-model-queue",
        value: "sonnet-low",
        expectOpt: "opt_mq_sonnet_low",
      },
      { verb: "set-model-queue", value: "opus-med", expectOpt: "opt_mq_opus_med" },
      {
        verb: "set-model-queue",
        value: "opus-1m-max",
        expectOpt: "opt_mq_opus_1m_max",
      },
      { verb: "set-model-queue", value: "done", expectOpt: "opt_mq_done" },
    ];

    for (const c of cases) {
      it(`${c.verb} ${c.value} → ${c.expectOpt}`, () => {
        const { scriptCopy, bin, dir } = makeSandbox("ok");
        sandboxes.push(dir);
        const r = run(scriptCopy, bin, [c.verb, "ITEM_X", c.value]);
        expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
        const fs = require("node:fs") as typeof import("node:fs");
        const captured = fs.readFileSync(join(dir, "last-mutation-opt"), "utf8").trim();
        expect(captured).toBe(c.expectOpt);
      });
    }
  });
});
