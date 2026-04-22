#!/usr/bin/env tsx
/**
 * OmniJS URL-scheme + result-retrieval spike — validates that Node can invoke
 * OmniJS scripts inside OmniFocus via the `omnifocus://localhost/omnijs-run?script=…`
 * URL scheme and read structured results back.
 *
 * Usage:
 *   pnpm tsx scripts/spikes/omnijs-spike.ts
 *
 * Requires OmniFocus to be running. Results feed into
 * docs/spikes/2026-04-omnijs-spike.md.
 *
 * ## Key findings (discovered during spike):
 *
 * 1. Invocation: `osascript -e 'open location "URL"'` is required.
 *    Plain `open URL` from the shell is silently dropped by OmniFocus.
 *
 * 2. URL encoding: `encodeURIComponent` is insufficient — it leaves `()` and
 *    other chars unencoded that break OmniFocus's query-parameter parser.
 *    All non-alphanumeric bytes must be percent-encoded (full RFC 3986 encoding).
 *
 * 3. File-write transport (originally planned): Blocked by macOS sandbox.
 *    OmniFocus 4 is a sandboxed app; writes to /tmp, ~/Downloads, ~/Documents
 *    all fail silently from inside OmniJS.
 *
 * 3. HTTP fetch transport: Also blocked. OmniFocus sandbox prevents network
 *    requests from OmniJS scripts.
 *
 * 4. Result transport — task-note pattern: Works. The OmniJS script creates
 *    a sentinel inbox task whose note contains the JSON result. The Node side
 *    polls via a JXA query until the task appears, reads the note, then marks
 *    the task complete to clean up.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * Percent-encode a script string for use in an OmniJS URL query parameter.
 *
 * `encodeURIComponent` leaves `! * ' ( )` unencoded, which is insufficient
 * when the script contains function call syntax that confuses OmniFocus's
 * query-string parser.
 *
 * This implementation encodes every byte that is NOT an unreserved URI char
 * (A-Z a-z 0-9 - _ . ~), matching Python's `urllib.parse.quote` behaviour
 * which is the reference that was validated to work against OF 4.
 */
function encodeScript(s: string): string {
  const unreserved = /[A-Za-z0-9\-_.~]/;
  return [...new TextEncoder().encode(s)]
    .map((b) => {
      const ch = String.fromCharCode(b);
      return unreserved.test(ch) ? ch : `%${b.toString(16).padStart(2, "0").toUpperCase()}`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Invocation helpers
// ---------------------------------------------------------------------------

let seqNum = 0;

function sentinelTaskName(): string {
  return `__omnijs_spike_result_${process.pid}_${++seqNum}_${Date.now()}`;
}

/**
 * Invoke an OmniJS script via the URL scheme.
 * The script receives `__resultTaskName` as a pre-injected global that it
 * should use as the name of the inbox task it creates to return its result.
 *
 * IMPORTANT: plain `open URL` from the shell does NOT reliably trigger OF to
 * process the URL. Only `osascript -e 'open location "URL"'` works.
 */
async function invokeOmniJs(script: string, resultTaskName: string): Promise<void> {
  // IMPORTANT: No IIFE wrapper — `inbox` behaves as a top-level global only;
  // wrapping the script in a function scope breaks the `inbox.append()` call.
  const fullScript = `
var __resultTaskName = ${JSON.stringify(resultTaskName)};
var __errTaskName = ${JSON.stringify(`${resultTaskName}__error`)};
try {
${script}
} catch (__e) {
  var __errTask = new Task(__errTaskName);
  __errTask.note = JSON.stringify({ error: String(__e) });
  inbox.append(__errTask);
}
`;
  const encoded = encodeScript(fullScript);
  const url = `omnifocus://localhost/omnijs-run?script=${encoded}`;
  await execFileAsync("osascript", ["-e", `open location ${JSON.stringify(url)}`]);
}

/**
 * Read back the result from the sentinel task written by OmniJS.
 * Polls via JXA until the task appears or the timeout fires.
 */
async function waitForResult(taskName: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const jxaQuery = `
    function run() {
      var app = Application("OmniFocus");
      var tasks = app.defaultDocument.inboxTasks().filter(function(t) {
        return t.name() === ${JSON.stringify(taskName)};
      });
      if (tasks.length === 0) return "";
      var note = tasks[0].note();
      // Mark complete to clean up
      tasks[0].markComplete();
      return note;
    }
  `;

  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", jxaQuery]);
    const raw = stdout.trim();
    if (raw) {
      return JSON.parse(raw);
    }
    // 300ms between polls — each JXA call takes ~100-150ms itself
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for OmniJS result task: ${taskName}`);
}

async function runOmniJs(
  script: string,
  timeoutMs = 30000,
): Promise<{ result: unknown; durationMs: number }> {
  const taskName = sentinelTaskName();
  const start = performance.now();
  await invokeOmniJs(script, taskName);
  const result = await waitForResult(taskName, timeoutMs);
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

async function runWithLatencies(
  label: string,
  script: string,
  iterations: number,
): Promise<{
  label: string;
  firstResult: unknown;
  p50: number;
  p95: number;
  min: number;
  max: number;
}> {
  const durations: number[] = [];
  let firstResult: unknown;
  for (let i = 0; i < iterations; i++) {
    try {
      const { result, durationMs } = await runOmniJs(script);
      durations.push(durationMs);
      if (i === 0) firstResult = result;
    } catch (e) {
      process.stderr.write(`   [iter ${i + 1} skipped: ${(e as Error).message.slice(0, 60)}]\n`);
    }
  }
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(iterations * 0.5)] ?? 0;
  const p95 = durations[Math.floor(iterations * 0.95)] ?? 0;
  return {
    label,
    firstResult,
    p50,
    p95,
    min: durations[0] ?? 0,
    max: durations[durations.length - 1] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// OmniJS test scripts
// (These run inside OmniFocus's JS engine — Omni Automation API, not JXA)
// Result is written as a JSON-serialised inbox task note named __resultTaskName.
// ---------------------------------------------------------------------------

/** Ping — confirms round-trip works and OF is alive. */
const PING_SCRIPT = `
var result = JSON.stringify({
  event: "pong",
  transport: "omnijs",
  timestamp: new Date().toISOString()
});
var t = new Task(__resultTaskName);
t.note = result;
`;

/** Task count — exercises flattenedTasks(), an OmniJS-only API. */
const TASK_COUNT_SCRIPT = `
var count = flattenedTasks().length;
var t = new Task(__resultTaskName);
t.note = JSON.stringify({ taskCount: count, transport: "omnijs" });
`;

/** UTF-8 round-trip — confirms emoji and CJK survive URL-encoding + OF. */
const UTF8_SCRIPT = `
var text = "H\u00e9llo w\u00f6rld \u2014 \u65e5\u672c\u8a9e \uD83C\uDFAF \u2603";
var t = new Task(__resultTaskName);
t.note = JSON.stringify({ text: text, transport: "omnijs" });
`;

// ---------------------------------------------------------------------------
// Failure mode: script throws
// ---------------------------------------------------------------------------

async function testScriptError(): Promise<string> {
  // The wrapper in invokeOmniJs catches throws and writes to taskName+"__error"
  const taskName = sentinelTaskName();
  const errScript = `
throw new Error("intentional omnijs failure");
`;
  try {
    await invokeOmniJs(errScript, taskName);
    // Poll for the error sentinel task
    const result = await waitForResult(`${taskName}__error`, 6000);
    return `OK: error captured in sentinel task — ${JSON.stringify(result)}`;
  } catch (e) {
    return `TIMEOUT or unexpected: ${(e as Error).message.slice(0, 100)}`;
  }
}

// ---------------------------------------------------------------------------
// Failure mode: timeout (wedged OF simulation)
// ---------------------------------------------------------------------------

async function testTimeout(): Promise<string> {
  const taskName = sentinelTaskName();
  // Script that never writes back
  const hangScript = `
// deliberately stalls; never writes result
var i = 0;
while (i < 1000000000) { i++; }
`;
  const start = performance.now();
  try {
    await invokeOmniJs(hangScript, taskName);
    await waitForResult(taskName, 500);
    return "UNEXPECTED: result arrived within timeout";
  } catch (e) {
    return `OK: timeout fired at ${(performance.now() - start).toFixed(0)}ms — ${(e as Error).message.slice(0, 80)}`;
  }
}

// ---------------------------------------------------------------------------
// Concurrent invocations
// ---------------------------------------------------------------------------

async function testConcurrentInvocations(): Promise<string> {
  const name1 = sentinelTaskName();
  const name2 = sentinelTaskName();

  const makeScript = (id: number, taskName: string) => `
var t = new Task(${JSON.stringify(taskName)});
t.note = JSON.stringify({ id: ${id}, transport: "omnijs" });
`;

  const [r1, r2] = await Promise.allSettled([
    (async () => {
      await invokeOmniJs(makeScript(1, name1), name1);
      return await waitForResult(name1, 12000);
    })(),
    (async () => {
      await invokeOmniJs(makeScript(2, name2), name2);
      return await waitForResult(name2, 12000);
    })(),
  ]);

  if (r1.status === "fulfilled" && r2.status === "fulfilled") {
    const d1 = r1.value as { id: number };
    const d2 = r2.value as { id: number };
    return `OK: both completed — id1=${d1.id} id2=${d2.id}`;
  }
  if (r1.status === "fulfilled") return "PARTIAL: only id=1 completed";
  if (r2.status === "fulfilled") return "PARTIAL: only id=2 completed";
  return "TIMEOUT: neither completed";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stderr.write("=== OmniJS URL-scheme Round-Trip Spike ===\n\n");

  process.stderr.write("1. Ping (10 iterations)…\n");
  const ping = await runWithLatencies("ping", PING_SCRIPT, 10);
  process.stderr.write(`   result: ${JSON.stringify(ping.firstResult)}\n`);
  process.stderr.write(
    `   latency (ms): min=${ping.min.toFixed(0)} p50=${ping.p50.toFixed(0)} p95=${ping.p95.toFixed(0)} max=${ping.max.toFixed(0)}\n\n`,
  );

  process.stderr.write("2. Task count (10 iterations)…\n");
  const tc = await runWithLatencies("task_count", TASK_COUNT_SCRIPT, 10);
  process.stderr.write(`   result: ${JSON.stringify(tc.firstResult)}\n`);
  process.stderr.write(
    `   latency (ms): min=${tc.min.toFixed(0)} p50=${tc.p50.toFixed(0)} p95=${tc.p95.toFixed(0)} max=${tc.max.toFixed(0)}\n\n`,
  );

  process.stderr.write("3. UTF-8 round-trip (5 iterations)…\n");
  const utf = await runWithLatencies("utf8", UTF8_SCRIPT, 5);
  process.stderr.write(`   result: ${JSON.stringify(utf.firstResult)}\n\n`);

  process.stderr.write("4. Concurrent invocations…\n");
  const concurrent = await testConcurrentInvocations();
  process.stderr.write(`   ${concurrent}\n\n`);

  process.stderr.write("5. Script-error surfacing…\n");
  const scriptErr = await testScriptError();
  process.stderr.write(`   ${scriptErr}\n\n`);

  process.stderr.write("6. Timeout simulation (500ms budget)…\n");
  const timeout = await testTimeout();
  process.stderr.write(`   ${timeout}\n\n`);

  const summary = {
    ping: { p50: ping.p50, p95: ping.p95, min: ping.min, max: ping.max },
    taskCount: {
      firstResult: tc.firstResult,
      p50: tc.p50,
      p95: tc.p95,
      min: tc.min,
      max: tc.max,
    },
    utf8: { firstResult: utf.firstResult, p50: utf.p50, p95: utf.p95 },
    concurrent,
    scriptError: scriptErr,
    timeout,
  };

  process.stdout.write(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${String(e)}\n`);
  process.exit(1);
});
