#!/usr/bin/env tsx
/**
 * evaluateJavascript bridge spike — validates that Node can call
 * `Application("OmniFocus").evaluateJavascript(script)` via JXA (osascript)
 * as a dialog-free, synchronous transport for OmniJS scripts.
 *
 * Usage:
 *   pnpm tsx scripts/spikes/evaljs-spike.ts
 *
 * Requires OmniFocus to be running. No OmniFocus security dialogs appear —
 * this goes through the macOS Automation permission already granted to
 * osascript, not the URL-scheme path.
 *
 * Results feed into docs/spikes/2026-04-omnijs-spike.md.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Transport helper
// ---------------------------------------------------------------------------

/**
 * Run an OmniJS script inside OmniFocus's JS engine via the JXA bridge.
 *
 * The script runs synchronously (from the caller's perspective). The return
 * value must be a JSON string — call JSON.stringify() inside the script.
 *
 * Key API differences vs URL-scheme OmniJS:
 *   - `flattenedTasks`  is a **property** (array-like), not a function call
 *   - `flattenedProjects` is a **property**
 *   - `new Task(name)` auto-adds to inbox; `new Task(name, project)` places it
 *   - `inbox` global is present but `inbox.tasks` is undefined; use `new Task(name)` instead
 *   - `setTimeout` / `setInterval` are NOT available
 *   - `async/await` and `Promise.resolve()` work fine (no I/O-based async)
 */
async function evalJs(script: string): Promise<{ result: unknown; durationMs: number }> {
  const jxaScript = `Application("OmniFocus").evaluateJavascript(${JSON.stringify(script)})`;
  const start = performance.now();
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", jxaScript]);
  const durationMs = performance.now() - start;
  return { result: JSON.parse(stdout.trim()), durationMs };
}

async function bench(
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
    const { result, durationMs } = await evalJs(script);
    durations.push(durationMs);
    if (i === 0) firstResult = result;
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stderr.write("=== evaluateJavascript Bridge Spike ===\n\n");

  // 1. Ping
  process.stderr.write("1. Ping (10 iterations)…\n");
  const ping = await bench("ping", "JSON.stringify({ping:true,ts:new Date().toISOString()})", 10);
  process.stderr.write(`   result: ${JSON.stringify(ping.firstResult)}\n`);
  process.stderr.write(
    `   latency (ms): min=${ping.min.toFixed(0)} p50=${ping.p50.toFixed(0)} p95=${ping.p95.toFixed(0)} max=${ping.max.toFixed(0)}\n\n`,
  );

  // 2. Task count
  process.stderr.write("2. Task count (10 iterations)…\n");
  const tc = await bench(
    "task_count",
    `JSON.stringify({taskCount:flattenedTasks.length,transport:"evaljs"})`,
    10,
  );
  process.stderr.write(`   result: ${JSON.stringify(tc.firstResult)}\n`);
  process.stderr.write(
    `   latency (ms): min=${tc.min.toFixed(0)} p50=${tc.p50.toFixed(0)} p95=${tc.p95.toFixed(0)} max=${tc.max.toFixed(0)}\n\n`,
  );

  // 3. UTF-8 round-trip
  process.stderr.write("3. UTF-8 round-trip…\n");
  const utf = await bench(
    "utf8",
    `JSON.stringify({text:"H\\u00e9llo w\\u00f6rld \\u2014 \\u65e5\\u672c\\u8a9e \\uD83C\\uDFAF"})`,
    3,
  );
  process.stderr.write(`   result: ${JSON.stringify(utf.firstResult)}\n\n`);

  // 4. Mutations: create → update → complete
  process.stderr.write("4. Mutations (create → update → complete)…\n");
  const marker = `evaljs-spike-${Date.now()}`;
  const { result: created } = await evalJs(
    `var t = new Task(${JSON.stringify(marker)}); JSON.stringify({id: t.id.primaryKey, name: t.name})`,
  );
  process.stderr.write(`   created: ${JSON.stringify(created)}\n`);

  const { result: updated } = await evalJs(
    `var ts = flattenedTasks.filter(function(t){return t.name===${JSON.stringify(marker)};}); ts[0].note="spike-note"; ts[0].flagged=true; JSON.stringify({note:ts[0].note,flagged:ts[0].flagged})`,
  );
  process.stderr.write(`   updated: ${JSON.stringify(updated)}\n`);

  const { result: completed } = await evalJs(
    `var ts = flattenedTasks.filter(function(t){return t.name===${JSON.stringify(marker)};}); ts[0].markComplete(); JSON.stringify({completed:ts[0].completed})`,
  );
  process.stderr.write(`   completed: ${JSON.stringify(completed)}\n\n`);

  // 5. Error handling
  process.stderr.write("5. Error handling…\n");
  let errMsg = "";
  try {
    await evalJs(`throw new Error("intentional failure")`);
  } catch (e) {
    errMsg = (e as Error).message.slice(0, 120);
  }
  process.stderr.write(`   caught: ${errMsg}\n\n`);

  // 6. Async scripts (Promise.resolve — no timers available)
  process.stderr.write("6. Async (Promise.resolve)…\n");
  const { result: asyncResult } = await evalJs(
    "(async function(){return JSON.stringify({asyncWorks:true,val:await Promise.resolve(42)});})()",
  );
  process.stderr.write(`   result: ${JSON.stringify(asyncResult)}\n\n`);

  // 7. Large payload
  process.stderr.write("7. Large payload (~300 KB return)…\n");
  const { result: large, durationMs: largeDuration } = await evalJs(
    `var arr=[]; for(var i=0;i<5000;i++) arr.push({id:i,name:"task-"+i,note:"some note text here "+i}); JSON.stringify(arr)`,
  );
  const size = JSON.stringify(large).length;
  process.stderr.write(`   size: ${size} bytes, duration: ${largeDuration.toFixed(0)}ms\n\n`);

  // 8. Concurrent calls
  process.stderr.write("8. Concurrent calls…\n");
  const [r1, r2] = await Promise.all([
    evalJs("JSON.stringify({id:1,taskCount:flattenedTasks.length})"),
    evalJs("JSON.stringify({id:2,taskCount:flattenedTasks.length})"),
  ]);
  process.stderr.write(`   r1: ${JSON.stringify(r1.result)} (${r1.durationMs.toFixed(0)}ms)\n`);
  process.stderr.write(`   r2: ${JSON.stringify(r2.result)} (${r2.durationMs.toFixed(0)}ms)\n\n`);

  // Summary JSON to stdout
  const summary = {
    ping: { p50: ping.p50, p95: ping.p95, min: ping.min, max: ping.max },
    taskCount: { firstResult: tc.firstResult, p50: tc.p50, p95: tc.p95 },
    utf8: { firstResult: utf.firstResult },
    mutations: { created, updated, completed },
    errors: { caught: errMsg },
    async: { result: asyncResult },
    largePayload: { sizeBytes: size, durationMs: largeDuration },
    concurrent: { r1: r1.result, r2: r2.result },
  };
  process.stdout.write(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${String(e)}\n`);
  process.exit(1);
});
