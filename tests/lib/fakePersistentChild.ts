/**
 * Fake persistent-transport child for #882 tests.
 *
 * A Node process that speaks the same framing protocol as the real osascript
 * runtime in `src/adapter/jxa/persistentScriptRunner.ts`: it reads
 * newline-delimited JSON request frames `{ s, a }` from stdin and writes
 * newline-delimited JSON response frames to fd 3. This lets the transport's
 * FIFO / crash-recovery / timeout / telemetry logic be exercised
 * deterministically in CI without depending on macOS or `osascript`.
 *
 * The request's `s` (script) field doubles as a failure-mode trigger:
 *
 *   - `__CRASH__` — `process.exit(1)` mid-call (clean non-zero exit).
 *   - `__KILL__`  — `SIGKILL` self (simulates `kill -9`).
 *   - `__HANG__`  — never respond (drives the per-call timeout).
 *   - `__ERR__`   — respond with `{ ok: false, stderr: a }` (script-level error).
 *   - anything else — echo `{ ok: true, stdout: a }`.
 *
 * Runs under `--input-type=commonjs` so `require` works regardless of the
 * package's ESM `type`.
 */

import { type ChildProcess, spawn } from "node:child_process";

const FAKE_CHILD_SRC = `
const fs = require("node:fs");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    if (req.s === "__CRASH__") process.exit(1);
    if (req.s === "__KILL__") { process.kill(process.pid, "SIGKILL"); continue; }
    if (req.s === "__HANG__") continue;
    if (req.s === "__ERR__") { fs.writeSync(3, JSON.stringify({ ok: false, stderr: req.a }) + "\\n"); continue; }
    fs.writeSync(3, JSON.stringify({ ok: true, stdout: req.a }) + "\\n");
  }
});
process.stdin.resume();
`;

/** Launch a fake persistent child with stdin + fd-3 pipes wired like the real one. */
export function launchFakePersistentChild(): ChildProcess {
  return spawn(process.execPath, ["--input-type=commonjs", "-e", FAKE_CHILD_SRC], {
    stdio: ["pipe", "ignore", "pipe", "pipe"],
  });
}
