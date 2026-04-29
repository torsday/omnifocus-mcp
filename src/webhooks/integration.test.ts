/**
 * Integration test for the webhook subsystem (per #483 AC, slice 4).
 *
 * Stands up a local HTTP receiver, registers a webhook against it, and
 * verifies that the orchestrator + HttpsDispatcher together:
 *   - POST the event JSON to the receiver
 *   - sign with HMAC-SHA256 verifiably from the receiver's perspective
 *   - retry on 500 and succeed on a subsequent 200
 *
 * Uses node:http for the receiver (loopback only) — the production
 * dispatcher uses node:https, but for a local receiver we only need to
 * verify the dispatcher's HTTPS code path produces the right wire bytes.
 * The dispatcher's `request` function is overridden to point at the
 * loopback http server, so all the dispatch logic runs except the TLS
 * handshake. This sidesteps the cert-management complexity of standing
 * up a self-signed HTTPS server in CI.
 *
 * Loopback-only by construction (`127.0.0.1`); never reaches the network.
 */

import { createHmac } from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpsDispatcher, type HttpsRequestFn, SIGNATURE_HEADER } from "./httpsDispatcher.js";
import { WebhookOrchestrator } from "./orchestrator.js";
import { WebhookRegistry } from "./registry.js";

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface ServerHarness {
  server: http.Server;
  port: number;
  received: CapturedRequest[];
  /**
   * Sequence of status codes to return per request. After the array is
   * exhausted, the receiver returns 200.
   */
  responsesQueue: number[];
}

async function startReceiver(): Promise<ServerHarness> {
  const harness: ServerHarness = {
    server: undefined as unknown as http.Server,
    port: 0,
    received: [],
    responsesQueue: [],
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      harness.received.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body,
      });
      const status = harness.responsesQueue.shift() ?? 200;
      res.statusCode = status;
      res.end();
    });
  });
  harness.server = server;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("no server address");
  harness.port = addr.port;
  return harness;
}

/**
 * HttpsRequestFn pointing at the local http receiver. Re-implements the
 * essence of the dispatcher's defaultHttpsRequest using node:http.
 */
function makeHttpRequester(host: string, port: number): HttpsRequestFn {
  return ({ url, body, headers, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = http.request(
        {
          method: "POST",
          host,
          port,
          path: `${parsed.pathname}${parsed.search}`,
          headers: { "Content-Length": Buffer.byteLength(body), ...headers },
          timeout: timeoutMs,
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve({ statusCode: res.statusCode ?? 0 }));
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.write(body);
      req.end();
    });
}

describe("webhooks — integration: local HTTP receiver", () => {
  let harness: ServerHarness;
  let registryPath: string;

  beforeEach(async () => {
    harness = await startReceiver();
    registryPath = `/tmp/omnifocus-mcp-webhooks-int-test-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
    const fs = await import("node:fs");
    if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
  });

  it("dispatches a synthetic event end-to-end and the receiver sees the JSON body", async () => {
    const registry = new WebhookRegistry({ filePath: registryPath });
    registry.register({
      name: "int-1",
      url: `http://127.0.0.1:${harness.port}/events`,
      trigger: { on: "task-completed" },
    });
    const dispatcher = new HttpsDispatcher({
      request: makeHttpRequester("127.0.0.1", harness.port),
      sleep: async () => {},
    });
    const orchestrator = new WebhookOrchestrator({ registry, dispatcher });

    const result = await orchestrator.fireSynthetic("int-1");
    expect(result).toEqual({ delivered: true });
    expect(harness.received).toHaveLength(1);
    const recv = harness.received[0];
    expect(recv?.method).toBe("POST");
    expect(recv?.path).toBe("/events");
    expect(recv?.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(recv?.body ?? "{}");
    expect(parsed.kind).toBe("task-completed");
    expect(parsed.webhookName).toBe("int-1");
  });

  it("HMAC signature is verifiable from the receiver's side", async () => {
    const secret = "integration-secret-key-very-long";
    const registry = new WebhookRegistry({ filePath: registryPath });
    registry.register({
      name: "int-signed",
      url: `http://127.0.0.1:${harness.port}/signed`,
      trigger: { on: "task-completed" },
      secret,
    });
    const dispatcher = new HttpsDispatcher({
      request: makeHttpRequester("127.0.0.1", harness.port),
      sleep: async () => {},
    });
    const orchestrator = new WebhookOrchestrator({ registry, dispatcher });

    await orchestrator.fireSynthetic("int-signed");

    const recv = harness.received[0];
    const sigHeader = recv?.headers[SIGNATURE_HEADER.toLowerCase()];
    expect(typeof sigHeader).toBe("string");
    const sig = (sigHeader as string).replace(/^sha256=/, "");
    const expected = createHmac("sha256", secret)
      .update(recv?.body ?? "")
      .digest("hex");
    expect(sig).toBe(expected);
  });

  it("retries on 500 and succeeds on subsequent 200 (per ADR-0016 §3)", async () => {
    harness.responsesQueue = [500, 500, 200];
    const registry = new WebhookRegistry({ filePath: registryPath });
    registry.register({
      name: "int-retry",
      url: `http://127.0.0.1:${harness.port}/flaky`,
      trigger: { on: "task-completed" },
    });
    const dispatcher = new HttpsDispatcher({
      request: makeHttpRequester("127.0.0.1", harness.port),
      sleep: async () => {}, // skip the real 1s/5s/30s waits
    });
    const orchestrator = new WebhookOrchestrator({ registry, dispatcher });

    await orchestrator.fireSynthetic("int-retry");
    expect(harness.received).toHaveLength(3);
    // The first two saw the 500 path; the third returned 200. The
    // dispatcher's success short-circuit means no 4th attempt.
  });
});
