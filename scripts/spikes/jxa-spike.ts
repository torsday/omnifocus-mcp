#!/usr/bin/env tsx
/**
 * JXA round-trip spike — validates that Node can shell out to `osascript -l JavaScript`,
 * run a trivial script against OmniFocus, and parse structured JSON back without corruption.
 *
 * Usage:
 *   tsx scripts/spikes/jxa-spike.ts
 *
 * Requires OmniFocus to be running. Results feed into docs/spikes/2026-04-jxa-spike.md.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Test scripts
// ---------------------------------------------------------------------------

const PING_SCRIPT = `
ObjC.import("Foundation");
function run() {
  const app = Application("OmniFocus");
  return JSON.stringify({
    event: "pong",
    transport: "jxa",
    ofRunning: app.running(),
    ofName: app.name()
  });
}
`;

const TASK_COUNT_SCRIPT = `
ObjC.import("Foundation");
function run() {
  const app = Application("OmniFocus");
  const doc = app.defaultDocument;
  const tasks = doc.flattenedTasks();
  return JSON.stringify({
    taskCount: tasks.length,
    transport: "jxa"
  });
}
`;

const UTF8_ROUNDTRIP_SCRIPT = `
ObjC.import("Foundation");
function run() {
  return JSON.stringify({
    text: "Héllo wörld — 日本語 🎯 \u2603",
    transport: "jxa"
  });
}
`;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runJxa(script: string): Promise<{ stdout: string; durationMs: number }> {
  const start = performance.now();
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script]);
  const durationMs = performance.now() - start;
  return { stdout: stdout.trim(), durationMs };
}

async function runWithLatencies(
  label: string,
  script: string,
  iterations: number,
): Promise<{
  label: string;
  results: unknown[];
  p50: number;
  p95: number;
  min: number;
  max: number;
}> {
  const durations: number[] = [];
  const results: unknown[] = [];

  for (let i = 0; i < iterations; i++) {
    const { stdout, durationMs } = await runJxa(script);
    durations.push(durationMs);
    if (i === 0) {
      try {
        results.push(JSON.parse(stdout));
      } catch {
        results.push({ raw: stdout });
      }
    }
  }

  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(iterations * 0.5)] ?? 0;
  const p95 = durations[Math.floor(iterations * 0.95)] ?? 0;
  const min = durations[0] ?? 0;
  const max = durations[durations.length - 1] ?? 0;

  return { label, results, p50, p95, min, max };
}

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

async function testOFNotRunning(): Promise<string> {
  // We can't actually stop OF, so test a script that errors cleanly.
  try {
    await execFileAsync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      `function run() { throw new Error("intentional failure"); }`,
    ]);
    return "UNEXPECTED: no error thrown";
  } catch (e) {
    return `OK: error surfaced — ${(e as { message?: string }).message?.slice(0, 100)}`;
  }
}

async function testMalformedJson(): Promise<string> {
  const { stdout } = await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    `function run() { return "not json {"; }`,
  ]);
  try {
    JSON.parse(stdout.trim());
    return "UNEXPECTED: parsed successfully";
  } catch {
    return `OK: JSON.parse throws — raw: ${JSON.stringify(stdout.trim().slice(0, 50))}`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stderr.write("=== JXA Round-Trip Spike ===\n\n");

  // Ping
  process.stderr.write("1. Ping (10 iterations)…\n");
  const ping = await runWithLatencies("ping", PING_SCRIPT, 10);
  process.stderr.write(`   result: ${JSON.stringify(ping.results[0])}\n`);
  process.stderr.write(
    `   latency (ms): min=${ping.min.toFixed(0)} p50=${ping.p50.toFixed(0)} p95=${ping.p95.toFixed(0)} max=${ping.max.toFixed(0)}\n\n`,
  );

  // Task count
  process.stderr.write("2. Task count (10 iterations)…\n");
  const tc = await runWithLatencies("task_count", TASK_COUNT_SCRIPT, 10);
  process.stderr.write(`   result: ${JSON.stringify(tc.results[0])}\n`);
  process.stderr.write(
    `   latency (ms): min=${tc.min.toFixed(0)} p50=${tc.p50.toFixed(0)} p95=${tc.p95.toFixed(0)} max=${tc.max.toFixed(0)}\n\n`,
  );

  // UTF-8 round-trip
  process.stderr.write("3. UTF-8 round-trip…\n");
  const utf = await runWithLatencies("utf8", UTF8_ROUNDTRIP_SCRIPT, 5);
  process.stderr.write(`   result: ${JSON.stringify(utf.results[0])}\n\n`);

  // Failure modes
  process.stderr.write("4. Failure modes…\n");
  const errResult = await testOFNotRunning();
  process.stderr.write(`   script error: ${errResult}\n`);
  const jsonResult = await testMalformedJson();
  process.stderr.write(`   malformed JSON: ${jsonResult}\n\n`);

  // Summary for doc
  const summary = {
    ping,
    taskCount: tc,
    utf8: { label: utf.label, p50: utf.p50, p95: utf.p95 },
    failureModes: {
      scriptError: errResult,
      malformedJson: jsonResult,
    },
  };

  // Print JSON to stdout for capture
  process.stdout.write(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${String(e)}\n`);
  process.exit(1);
});
