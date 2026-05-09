/**
 * Cross-process `tools/list` determinism (#772).
 *
 * Anthropic's prompt cache reuses static prefixes byte-for-byte across
 * sessions. The MCP `tools/list` response — full JSON Schema + descriptions
 * for every registered tool — is the largest static prefix this server
 * emits, paid by every session at handshake.
 *
 * This test boots the bundled server twice in fully separate child
 * processes, captures the raw `tools/list` JSON-RPC response line on each
 * boot, and asserts the response payload is byte-for-byte identical. A
 * regression here would silently double the prompt-cache cost for every
 * client session.
 *
 * The harness bypasses the SDK Client deliberately — re-serializing through
 * `JSON.stringify` after parsing would mask any byte-order drift the cache
 * actually sees. Raw stdout bytes are the proof.
 *
 * Gated on `OMNIFOCUS_E2E=1`; the bundle must exist (run `pnpm build` first).
 *
 * @see docs/prompt-cache.md — the determinism contract this test guards
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const E2E = process.env.OMNIFOCUS_E2E === "1";
const SERVER_PATH = resolve(process.cwd(), "dist", "index.js");

const BOOT_TIMEOUT_MS = 30_000;

interface CapturedToolsList {
  /** Parsed `result` field — the cache-relevant payload. */
  result: unknown;
}

/**
 * Boot the bundled server, complete the MCP `initialize` handshake, issue
 * `tools/list`, and return the raw response line. The child is killed as
 * soon as the response is captured.
 */
async function captureToolsList(): Promise<CapturedToolsList> {
  return new Promise<CapturedToolsList>((resolveFn, rejectFn) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    const timer = setTimeout(() => {
      child?.kill("SIGKILL");
      rejectFn(new Error(`tools/list capture timed out after ${BOOT_TIMEOUT_MS}ms`));
    }, BOOT_TIMEOUT_MS);

    child = spawn(process.execPath, [SERVER_PATH], {
      env: {
        ...process.env,
        OMNIFOCUS_E2E: "1",
        OMNIFOCUS_E2E_USE_MEMORY: "1",
        // Quietest level the validator accepts (no `silent`).
        OMNIFOCUS_LOG_LEVEL: "error",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf = "";
    let initialized = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (line.trim() === "") continue;
        let msg: { id?: number; result?: unknown };
        try {
          msg = JSON.parse(line) as { id?: number; result?: unknown };
        } catch {
          // Non-JSON output before handshake completion. Ignore.
          continue;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          // Send the standard MCP `notifications/initialized` then issue
          // `tools/list`. No `id` on the notification.
          child?.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
            })}\n`,
          );
          child?.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/list",
              params: {},
            })}\n`,
          );
          continue;
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child?.kill("SIGTERM");
          resolveFn({ result: msg.result });
          return;
        }
      }
    });

    // Drain stderr so the child doesn't block on a full pipe buffer.
    child.stderr.resume();

    child.on("error", (err) => {
      clearTimeout(timer);
      rejectFn(err);
    });

    child.on("exit", (code, signal) => {
      // If the response was already captured we resolved above. If not, the
      // child died early and the `data` handler will never fire — surface
      // the exit so the test fails fast instead of timing out.
      if (!initialized) {
        clearTimeout(timer);
        rejectFn(
          new Error(
            `server exited before initialize handshake (code=${String(code)} signal=${String(signal)})`,
          ),
        );
      }
    });

    // Initiate the handshake.
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "determinism-probe", version: "1.0.0" },
        },
      })}\n`,
    );
  });
}

describe.skipIf(!E2E)("E2E — tools/list determinism (#772)", () => {
  it("emits a byte-identical tools/list payload across two fresh process boots", async () => {
    if (!existsSync(SERVER_PATH)) {
      throw new Error(`E2E bundle missing at ${SERVER_PATH}. Run \`pnpm build\` first.`);
    }

    const a = await captureToolsList();
    const b = await captureToolsList();

    // The full JSON-RPC envelope embeds an `id` (always 2 here) and a
    // `result`; only `result` is the prompt-cache prefix. Strip the
    // envelope before comparing so an SDK-side `id` change doesn't
    // accidentally invalidate the contract.
    const aJson = JSON.stringify(a.result);
    const bJson = JSON.stringify(b.result);

    expect(aJson).toBe(bJson);
  });

  // Acceptance criterion from #772: hash of the first 4 KiB is stable
  // across at least three fresh runs.
  it("emits a stable hash of the first 4 KiB of tools/list result across three boots", async () => {
    if (!existsSync(SERVER_PATH)) {
      throw new Error(`E2E bundle missing at ${SERVER_PATH}. Run \`pnpm build\` first.`);
    }

    const hashFirst4Kib = (result: unknown): string => {
      const bytes = Buffer.from(JSON.stringify(result), "utf8").subarray(0, 4096);
      return createHash("sha256").update(bytes).digest("hex");
    };

    const a = await captureToolsList();
    const b = await captureToolsList();
    const c = await captureToolsList();

    const ha = hashFirst4Kib(a.result);
    const hb = hashFirst4Kib(b.result);
    const hc = hashFirst4Kib(c.result);

    expect(hb).toBe(ha);
    expect(hc).toBe(ha);
  });
});
