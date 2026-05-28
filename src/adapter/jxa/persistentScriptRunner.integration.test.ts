/**
 * Integration tests for the persistent JXA transport (#882) against the REAL
 * `osascript` runtime — this is what validates the inlined runtime source
 * (framing, dispatch, UTF-8, fd-3 protocol) and the memory ceiling that the
 * fake-child unit tests can't.
 *
 * Gated behind `OMNIFOCUS_INTEGRATION=1` and macOS — it spawns `osascript` but
 * does NOT require OmniFocus (the scripts here are OF-independent), so it's a
 * pure transport-mechanism check.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test src/adapter/jxa/persistentScriptRunner.integration.test.ts
 *
 * @see src/adapter/jxa/persistentScriptRunner.test.ts — deterministic unit tests
 */

import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createPersistentJxaTransport } from "./persistentScriptRunner.js";

const RUN = process.env.OMNIFOCUS_INTEGRATION === "1" && process.platform === "darwin";

type Transport = ReturnType<typeof createPersistentJxaTransport>;
let transport: Transport | null = null;

afterEach(async () => {
  await transport?.dispose();
  transport = null;
});

/** Resident set size (KiB) of a pid via `ps`. */
function rssKib(pid: number): number {
  const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return Number.parseInt(out, 10);
}

describe.skipIf(!RUN)("persistent JXA transport — real osascript", () => {
  it("round-trips a run-form script with UTF-8 through one persistent child", async () => {
    transport = createPersistentJxaTransport();
    const script =
      "function run(argv){ var i = JSON.parse(argv[0]); return JSON.stringify({echo:i}); }";
    const result = await transport.spawner(script, JSON.stringify({ hi: "🌍 café", n: 7 }), 5000);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(JSON.parse(result.stdout)).toEqual({ echo: { hi: "🌍 café", n: 7 } });
    expect(transport.stats().spawns).toBe(1);
  });

  it("round-trips an expression-form (no run) script", async () => {
    transport = createPersistentJxaTransport();
    const result = await transport.spawner("(() => JSON.stringify({event:'pong'}))();", "{}", 5000);
    expect(JSON.parse(result.stdout)).toEqual({ event: "pong" });
  });

  it("captures a script throw as a non-zero exit and keeps serving", async () => {
    transport = createPersistentJxaTransport();
    const thrown = await transport.spawner(
      "function run(){ throw new Error('Task not found (-1728)'); }",
      "{}",
      5000,
    );
    expect(thrown.exitCode).toBe(1);
    expect(thrown.stderr).toContain("-1728");
    // Same child still serves the next call (a throw is not a crash).
    const ok = await transport.spawner("(() => JSON.stringify({ok:1}))();", "{}", 5000);
    expect(JSON.parse(ok.stdout)).toEqual({ ok: 1 });
    expect(transport.stats().spawns).toBe(1);
  });

  it("reuses one child across 1000 calls without leaking (RSS ceiling)", async () => {
    transport = createPersistentJxaTransport();
    const script = "function run(argv){ return argv[0]; }";
    await transport.spawner(script, '{"warmup":true}', 5000);
    const pid = transport.childPid();
    expect(pid).toBeGreaterThan(0);
    const rssStart = rssKib(pid as number);

    for (let i = 0; i < 1000; i++) {
      const r = await transport.spawner(script, `{"i":${i}}`, 5000);
      expect(r.exitCode).toBe(0);
    }

    const stats = transport.stats();
    expect(stats.spawns).toBe(1); // one child served all 1001 calls
    expect(stats.callsServed).toBe(1001);

    const rssEnd = rssKib(transport.childPid() as number);
    // osascript baseline is ~15-25 MiB; a leak would balloon to hundreds. Assert
    // a generous absolute ceiling and bounded growth over 1000 calls.
    expect(rssEnd).toBeLessThan(80_000); // < ~80 MiB
    expect(rssEnd - rssStart).toBeLessThan(40_000); // < ~40 MiB growth
  });
});
