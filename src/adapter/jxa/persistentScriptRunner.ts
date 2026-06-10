/**
 * Persistent JXA transport (#882) — a long-lived `osascript` child that
 * eliminates the ~500ms-1s cold-spawn cost paid by the one-shot
 * {@link defaultJxaSpawner} on every call.
 *
 * ## Why
 *
 * Each one-shot JXA call forks a fresh `osascript`, brings up the JS
 * interpreter, and tears it all down — a fixed floor that dominates for
 * fast OmniFocus reads and compounds across multi-call workflows (the
 * spawn-floor calibration in `_shared/spawnFloor.ts` measures exactly this).
 * A persistent child pays that floor once; subsequent calls cost only the
 * AppleEvent round-trip.
 *
 * ## How
 *
 * One `osascript -l JavaScript -e <runtime>` child is kept alive. The runtime
 * is an interpreter loop (no `-i` interactive mode — a file/`-e` program keeps
 * stdin free for request data and avoids interactive-echo entirely) that:
 *
 *   1. reads newline-delimited JSON request frames from **stdin** (fd 0),
 *   2. runs the requested script, replicating one-shot dispatch — a
 *      `function run(argv)` is called with `[jsonArg]`; an expression script
 *      yields its value, and
 *   3. writes a newline-delimited JSON response frame to a **dedicated fd 3**.
 *
 * Responses ride fd 3, not stdout, so a stray `console.log` in a script can
 * never desync the protocol — strictly more robust than length-prefixing on
 * a shared stdout (the failure mode #882's framing requirement guards against).
 *
 * Single in-flight request at a time (osascript is single-threaded): concurrent
 * callers are serialized through a FIFO promise chain. A child that exits
 * unexpectedly mid-call surfaces {@link SpawnResult.restarted} on the
 * interrupted call (mapped to `OmniFocusTransportRestarted` by the runner) and
 * is transparently replaced on the next call. A per-call timeout kills the
 * child (it may be wedged in an OF modal) and the next call gets a fresh one.
 *
 * This is the {@link ScriptSpawner} seam — a drop-in alternative to
 * {@link defaultJxaSpawner}. Gated by `OMNIFOCUS_PERSISTENT_OSASCRIPT` (off by
 * default; see `src/config/env.ts`).
 *
 * @see #882 — persistent osascript REPL
 * @see src/adapter/jxa/scriptRunner.ts — the runner + one-shot spawner
 * @see src/adapter/_shared/spawnFloor.ts — the cost split that motivated this
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { logger } from "../../logging/logger.js";
import type { PersistentTransportStats } from "../../observability/transportStats.js";
import { trackChild } from "../_shared/childRegistry.js";
import type { ScriptSpawner, SpawnResult } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// The persistent runtime (JXA). Validated against real osascript by the #882
// spike. `\n` sequences are escaped (`\\n`) so the emitted source carries the
// two-char JS escape, not a literal newline. The integration test
// (`persistentScriptRunner.integration.test.ts`) round-trips a script through
// this exact source against real osascript, so any escaping regression fails
// loudly there.
// ---------------------------------------------------------------------------

/**
 * Dispatch replicates one-shot osascript semantics for both script shapes,
 * executing the script exactly once:
 *
 *   - **run-form** (`function run(argv){…}`, 61/62 scripts): detected by a
 *     probe IIFE whose *leading* `return typeof run === 'function'` observes
 *     the hoisted declaration before any body statement executes — so the
 *     probe runs nothing. (The `var run;` shadows a stale global `run`, which
 *     a pathological nested-`eval` script can leak, so the probe can't
 *     false-positive.) The script is then concatenated into an IIFE so `run`
 *     stays function-local. (A `run` introduced via a *nested* `eval` leaks
 *     to global, where osascript's run-handler machinery injects an empty
 *     `argv` — the spike proved IIFE-local capture avoids that.)
 *   - **expr-form** (`(() => …)()`, e.g. `ping.js`): no `run`, so the
 *     completion value of a plain `eval` is the result. The probe's early
 *     return means that `eval` is the script's only execution — a combined
 *     probe-and-execute would run the body during the probe and again for the
 *     completion value, doubling side effects.
 */
const PERSISTENT_RUNTIME_SRC = [
  'ObjC.import("Foundation");',
  "(function () {",
  "  var stdin = $.NSFileHandle.fileHandleWithStandardInput;",
  "  var out = $.NSFileHandle.alloc.initWithFileDescriptor(3);",
  '  var nl = $.NSString.alloc.initWithUTF8String("\\n").dataUsingEncoding($.NSUTF8StringEncoding);',
  "  var buf = $.NSMutableData.alloc.init;",
  "  var NF = Number($.NSNotFound);",
  "  function send(obj) {",
  '    var j = JSON.stringify(obj) + "\\n";',
  "    out.writeData($.NSString.alloc.initWithUTF8String(j).dataUsingEncoding($.NSUTF8StringEncoding));",
  "  }",
  "  function dispatch(script, arg) {",
  '    var isRunForm = eval("(function(){ var run; return typeof run === \'function\'; " + script + "\\n })()");',
  "    if (isRunForm) {",
  '      var fn = eval("(function(){ " + script + "\\n;return run; })()");',
  "      return fn([arg]);",
  "    }",
  "    return eval(script);",
  "  }",
  "  while (true) {",
  "    var bl = Number(buf.length);",
  "    var r = buf.rangeOfDataOptionsRange(nl, 0, $.NSMakeRange(0, bl));",
  "    var loc = Number(r.location);",
  "    if (loc === NF || loc >= bl) {",
  "      var chunk = stdin.availableData;",
  "      if (Number(chunk.length) === 0) break;",
  "      buf.appendData(chunk);",
  "      continue;",
  "    }",
  "    var frame = buf.subdataWithRange($.NSMakeRange(0, loc));",
  "    buf = $.NSMutableData.alloc.initWithData(buf.subdataWithRange($.NSMakeRange(loc + 1, bl - (loc + 1))));",
  "    var req;",
  "    try {",
  "      req = JSON.parse($.NSString.alloc.initWithDataEncoding(frame, $.NSUTF8StringEncoding).js);",
  '    } catch (e) { send({ ok: false, stderr: "transport: bad request frame" }); continue; }',
  "    try {",
  "      var v = dispatch(req.s, req.a);",
  '      send({ ok: true, stdout: v == null ? "" : String(v) });',
  "    } catch (e2) {",
  // AppleEvent errors carry their numeric code only on `e.errorNumber` — the
  // "(-1728)"-style suffix in one-shot stderr is appended by osascript's own
  // uncaught-error formatter, which this loop's catch replaces. Append it here
  // so the runner's stderr signature matching (transient retry-once,
  // NotFound / PermissionDenied classification) sees the one-shot shape.
  "      var m2 = e2 && e2.message ? e2.message : String(e2);",
  "      if (e2 && typeof e2.errorNumber === 'number') m2 += ' (' + e2.errorNumber + ')';",
  "      send({ ok: false, stderr: m2 });",
  "    }",
  "  }",
  "})();",
].join("\n");

/**
 * Test-only: the runtime source, so unit tests can pin the dispatch semantics
 * (single execution per script shape) by evaluating it in Node. Mirrors the
 * `__*ForTest` convention used elsewhere in the adapter layer.
 */
export const __PERSISTENT_RUNTIME_SRC_FOR_TEST = PERSISTENT_RUNTIME_SRC;

// ---------------------------------------------------------------------------
// Telemetry — {@link PersistentTransportStats} is defined in
// `observability/transportStats.ts` (a layer the `internal_status` tool may
// import; `tools/` → `adapter/jxa/` is forbidden by the layering lint).
// ---------------------------------------------------------------------------

/** Grace window between SIGTERM and SIGKILL on dispose / timeout (#882 AC). */
const DEFAULT_KILL_GRACE_MS = 1_000;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface PendingCall {
  resolve: (result: SpawnResult) => void;
  settled: boolean;
  timer: NodeJS.Timeout | null;
}

/** How to launch the child. Production launches real osascript; tests inject a fake. */
type ChildLauncher = () => ChildProcess;

function launchOsascript(): ChildProcess {
  return spawn("osascript", ["-l", "JavaScript", "-e", PERSISTENT_RUNTIME_SRC], {
    stdio: ["pipe", "ignore", "pipe", "pipe"], // stdin, stdout(ignored), stderr, fd3
    env: { ...process.env, LANG: "en_US.UTF-8" },
  });
}

/**
 * One persistent osascript child plus the FIFO, framing reader, crash
 * recovery, and per-call timeout. Constructed via {@link createPersistentJxaTransport};
 * production uses a lazy module singleton (see {@link getPersistentJxaSpawner}).
 */
class PersistentJxaTransport {
  private child: ChildProcess | null = null;
  private fd3Buf = "";
  // Pipe chunks split on byte — not code-point — boundaries, so each stream
  // needs a stateful decoder; a per-chunk `Buffer.toString` would turn a
  // multibyte character straddling two chunks into U+FFFD on both sides.
  private fd3Decoder = new StringDecoder("utf8");
  private stderrTail = "";
  private stderrDecoder = new StringDecoder("utf8");
  private current: PendingCall | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposing = false;
  private readonly intentionalExits = new WeakSet<ChildProcess>();
  private readonly counters = {
    spawns: 0,
    unexpectedExits: 0,
    restarts: 0,
    timeouts: 0,
    callsServed: 0,
  };

  constructor(
    private readonly launch: ChildLauncher = launchOsascript,
    private readonly killGraceMs: number = DEFAULT_KILL_GRACE_MS,
  ) {}

  /** The {@link ScriptSpawner} seam. Serializes concurrent callers FIFO. */
  readonly spawner: ScriptSpawner = (scriptBody, jsonArg, timeoutMs) =>
    this.enqueue(() => this.runOne(scriptBody, jsonArg, timeoutMs));

  /** PID of the current child, or undefined when none is alive. For tests/diagnostics. */
  childPid(): number | undefined {
    return this.child?.pid;
  }

  stats(): PersistentTransportStats {
    return {
      enabled: true,
      alive: this.child !== null,
      spawns: this.counters.spawns,
      unexpectedExits: this.counters.unexpectedExits,
      restarts: this.counters.restarts,
      timeouts: this.counters.timeouts,
      callsServed: this.counters.callsServed,
    };
  }

  private enqueue(fn: () => Promise<SpawnResult>): Promise<SpawnResult> {
    const run = this.chain.then(fn, fn);
    // Keep the chain alive regardless of outcome; swallow so one failure
    // doesn't poison the FIFO for later callers.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private ensureChild(): ChildProcess {
    const existing = this.child;
    if (existing !== null && existing.exitCode === null && !existing.killed) {
      return existing;
    }
    return this.spawnChild();
  }

  private spawnChild(): ChildProcess {
    const child = this.launch();
    this.counters.spawns += 1;
    this.child = child;
    this.fd3Buf = "";
    this.fd3Decoder = new StringDecoder("utf8");
    this.stderrTail = "";
    this.stderrDecoder = new StringDecoder("utf8");

    const fd3 = child.stdio[3] as Readable | null | undefined;
    if (fd3 && typeof fd3 !== "number") {
      fd3.on("data", (d: Buffer) => this.onFd3Data(child, d));
    }
    if (child.stderr) {
      child.stderr.on("data", (d: Buffer) => {
        this.stderrTail = (this.stderrTail + this.stderrDecoder.write(d)).slice(-2048);
      });
    }
    child.once("exit", (code, signal) => this.onChildExit(child, code, signal));
    child.once("error", (err) => this.onChildError(child, err));
    // Register for shutdown so a SIGINT/SIGTERM mid-flight can terminate the
    // long-lived child rather than orphan an osascript holding OmniFocus (#839).
    trackChild(child);
    logger.debug(
      { event: "transport.persistent.spawned", spawns: this.counters.spawns },
      "spawned persistent osascript child",
    );
    return child;
  }

  private onFd3Data(child: ChildProcess, d: Buffer): void {
    if (child !== this.child) return; // frame from a replaced child — ignore
    this.fd3Buf += this.fd3Decoder.write(d);
    let idx = this.fd3Buf.indexOf("\n");
    while (idx >= 0) {
      const line = this.fd3Buf.slice(0, idx);
      this.fd3Buf = this.fd3Buf.slice(idx + 1);
      this.onResponse(line);
      idx = this.fd3Buf.indexOf("\n");
    }
  }

  private onResponse(line: string): void {
    const call = this.current;
    if (call === null || call.settled) return; // late/duplicate frame
    let parsed: { ok?: boolean; stdout?: string; stderr?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      this.settle(call, {
        stdout: "",
        stderr: "persistent transport: malformed response frame",
        exitCode: 1,
        timedOut: false,
      });
      return;
    }
    this.counters.callsServed += 1;
    if (parsed.ok === true) {
      this.settle(call, { stdout: parsed.stdout ?? "", stderr: "", exitCode: 0, timedOut: false });
    } else {
      // Script-level throw: surface as non-zero exit with the script's error
      // text so the runner's `classifyJxaStderr` maps it (NotFound, Validation,
      // PermissionDenied, …) exactly as it does for one-shot stderr.
      this.settle(call, {
        stdout: "",
        stderr: parsed.stderr ?? "persistent transport: script error",
        exitCode: 1,
        timedOut: false,
      });
    }
  }

  private runOne(scriptBody: string, jsonArg: string, timeoutMs: number): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve) => {
      const call: PendingCall = { resolve, settled: false, timer: null };
      this.current = call;

      let child: ChildProcess;
      try {
        child = this.ensureChild();
      } catch (err) {
        // spawn() rarely throws synchronously, but guard anyway.
        this.settle(call, {
          stdout: "",
          stderr: "",
          exitCode: 1,
          timedOut: false,
          spawnError: err as NodeJS.ErrnoException,
        });
        return;
      }

      call.timer = setTimeout(() => {
        if (call.settled) return;
        this.counters.timeouts += 1;
        // The child may be wedged in an OF modal — kill it so the next call
        // gets a fresh one, and surface a timeout (runner maps to Timeout/OFBusy).
        this.killChild(child, "timeout");
        this.settle(call, { stdout: "", stderr: "", exitCode: 1, timedOut: true });
      }, timeoutMs);

      const frame = `${JSON.stringify({ s: scriptBody, a: jsonArg })}\n`;
      const stdin = child.stdin;
      if (stdin?.writable) {
        stdin.write(frame, "utf8");
      } else if (!call.settled) {
        // Lost the child between ensure and write — treat as a restart.
        this.counters.restarts += 1;
        this.settle(call, {
          stdout: "",
          stderr: "persistent transport: child stdin not writable",
          exitCode: null,
          timedOut: false,
          restarted: true,
        });
      }
    });
  }

  private onChildExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const intentional = this.intentionalExits.has(child);
    this.intentionalExits.delete(child);
    if (child === this.child) {
      this.child = null;
      const call = this.current;
      if (call !== null && !call.settled) {
        // Crashed mid-call. Interrupted call rejects with `restarted`; the FIFO
        // proceeds and the next call spawns a fresh child.
        this.counters.restarts += 1;
        if (!intentional) this.counters.unexpectedExits += 1;
        this.settle(call, {
          stdout: "",
          stderr: this.stderrTail.slice(-256),
          exitCode: code,
          timedOut: false,
          restarted: true,
        });
      } else if (!intentional && !this.disposing) {
        this.counters.unexpectedExits += 1;
      }
    }
    // Intentional exits (dispose, timeout-kill) are routine — debug. An exit we
    // didn't initiate is operationally interesting — warn.
    const fields = { event: "transport.persistent.child_exit", code, signal, intentional };
    if (intentional) {
      logger.debug(fields, "persistent osascript child exited");
    } else {
      logger.warn(fields, "persistent osascript child exited (unexpected)");
    }
  }

  private onChildError(child: ChildProcess, err: Error): void {
    if (child === this.child) {
      this.child = null;
      const call = this.current;
      if (call !== null && !call.settled) {
        this.settle(call, {
          stdout: "",
          stderr: "",
          exitCode: 1,
          timedOut: false,
          spawnError: err as NodeJS.ErrnoException,
        });
      }
    }
    logger.warn(
      { event: "transport.persistent.child_error", err: err.message },
      "persistent osascript child error",
    );
  }

  private settle(call: PendingCall, result: SpawnResult): void {
    if (call.settled) return;
    call.settled = true;
    if (call.timer !== null) clearTimeout(call.timer);
    if (this.current === call) this.current = null;
    call.resolve(result);
  }

  private killChild(child: ChildProcess, _reason: string): void {
    this.intentionalExits.add(child);
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited — harmless.
    }
  }

  /** Graceful shutdown: close stdin (EOF), then SIGTERM → grace → SIGKILL. */
  async dispose(): Promise<void> {
    this.disposing = true;
    const child = this.child;
    if (child === null) return;
    this.intentionalExits.add(child);
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    if (await this.waitForExit(child, this.killGraceMs)) {
      this.child = null;
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    if (!(await this.waitForExit(child, this.killGraceMs))) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this.child = null;
  }

  private waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

/** Construct an isolated persistent transport — used by tests with a fake child. */
export function createPersistentJxaTransport(
  launch?: ChildLauncher,
  killGraceMs?: number,
): PersistentJxaTransport {
  return new PersistentJxaTransport(launch, killGraceMs);
}

// ---------------------------------------------------------------------------
// Production singleton
// ---------------------------------------------------------------------------

let singleton: PersistentJxaTransport | null = null;

function instance(): PersistentJxaTransport {
  if (singleton === null) singleton = new PersistentJxaTransport();
  return singleton;
}

/** The process-wide persistent JXA spawner (lazily created on first use). */
export function getPersistentJxaSpawner(): ScriptSpawner {
  return (scriptBody, jsonArg, timeoutMs) => instance().spawner(scriptBody, jsonArg, timeoutMs);
}

/**
 * Telemetry snapshot for `internal_status`. Returns `enabled: false` when no
 * persistent child has ever been created this process (the one-shot default).
 */
export function getPersistentTransportStats(): PersistentTransportStats {
  if (singleton === null) {
    return {
      enabled: false,
      alive: false,
      spawns: 0,
      unexpectedExits: 0,
      restarts: 0,
      timeouts: 0,
      callsServed: 0,
    };
  }
  return singleton.stats();
}

/** Gracefully dispose the persistent child. Registered as a server shutdown hook. */
export async function disposePersistentJxa(): Promise<void> {
  if (singleton === null) return;
  await singleton.dispose();
}
