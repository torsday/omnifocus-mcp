/**
 * Driver for end-to-end tests: spawns the bundled server as a child process,
 * speaks MCP over stdio with the official SDK client, and exposes a narrow
 * `callTool` / `listTools` surface so suites can focus on the tool contract
 * rather than transport plumbing.
 *
 * Scaffolding layer per #256 (sub-issue of #80). Per-tool exercise tests are
 * expected to live alongside this file as `tests/e2e/*.test.ts`.
 *
 * @see tests/e2e/smoke.test.ts — the canonical usage example
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEFAULT_SERVER_PATH = resolve(process.cwd(), "dist", "index.js");

export interface E2EServerOptions {
  /** Absolute path to the bundled server entry. Defaults to `dist/index.js`. */
  serverPath?: string;
  /** Extra environment variables merged over the inherited env. */
  env?: Record<string, string>;
  /** Client identity advertised during `initialize`. Tests rarely need to override. */
  clientInfo?: { name: string; version: string };
}

/**
 * Thrown when the bundled server entry is missing. Suites should catch and
 * fail fast with an instruction to run `pnpm build` first.
 */
export class E2EBundleMissingError extends Error {
  readonly code = "E2E_BUNDLE_MISSING" as const;
  constructor(path: string) {
    super(`E2E bundle not found at ${path}. Run \`pnpm build\` before \`pnpm test:e2e\`.`);
    this.name = "E2EBundleMissingError";
  }
}

/**
 * Handle to a running E2E server + its connected client. Always pair
 * `start()` with `stop()` (use a `finally` block or a vitest `afterEach`).
 *
 * The driver captures the child's stderr into `stderrBuffer` so a failing
 * test can surface the server-side logs without polluting the terminal on
 * every run. Tests can print `buffer` on failure for debuggability.
 */
export class E2EServer {
  private readonly serverPath: string;
  private readonly env: Record<string, string>;
  private readonly clientInfo: { name: string; version: string };

  private transport: StdioClientTransport | undefined;
  private _client: Client | undefined;
  private _stderr = "";

  constructor(opts: E2EServerOptions = {}) {
    this.serverPath = opts.serverPath ?? DEFAULT_SERVER_PATH;
    this.env = opts.env ?? {};
    this.clientInfo = opts.clientInfo ?? { name: "e2e-test-client", version: "0.0.1" };
  }

  /**
   * Spawn the server, wire stderr capture, and run the MCP `initialize`
   * handshake. Resolves once the client is ready to issue requests.
   *
   * @throws {E2EBundleMissingError} when `dist/index.js` is absent
   */
  async start(): Promise<void> {
    if (!existsSync(this.serverPath)) {
      throw new E2EBundleMissingError(this.serverPath);
    }

    // Spawn a sidecar child purely to capture stderr for debuggability.
    // The SDK's StdioClientTransport spawns its own child for stdin/stdout;
    // running two copies would double-boot the server. Instead we let the
    // SDK own the lifecycle and surface logs via the transport's own pipe.
    this.transport = new StdioClientTransport({
      command: process.execPath, // node
      args: [this.serverPath],
      env: { ...process.env, ...this.env } as Record<string, string>,
      // Route child stderr to a pipe so tests can print it on failure rather
      // than splattering logs on green runs.
      stderr: "pipe",
    });

    this._client = new Client(this.clientInfo, { capabilities: {} });
    await this._client.connect(this.transport);

    const stderrStream = this.transport.stderr as Readable | null;
    if (stderrStream !== null) {
      stderrStream.setEncoding("utf8");
      stderrStream.on("data", (chunk: string) => {
        this._stderr += chunk;
      });
    }
  }

  /**
   * Close the client (which closes the transport and kills the child).
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this._client !== undefined) {
      await this._client.close();
      this._client = undefined;
    }
    this.transport = undefined;
  }

  /** Captured child stderr since `start()`. Useful in assertion failure paths. */
  get stderrBuffer(): string {
    return this._stderr;
  }

  /** Underlying MCP client. Only accessible after `start()`. */
  get client(): Client {
    if (this._client === undefined) throw new Error("E2EServer.start() has not been called");
    return this._client;
  }
}
