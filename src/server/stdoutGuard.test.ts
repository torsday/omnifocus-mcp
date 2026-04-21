import { afterEach, describe, expect, it } from "vitest";
import { installStdoutGuard, isAllowedStackTrace, uninstallStdoutGuard } from "./stdoutGuard.js";

afterEach(() => {
  uninstallStdoutGuard();
});

describe("isAllowedStackTrace", () => {
  it("allows the MCP SDK path", () => {
    expect(
      isAllowedStackTrace(
        "at Object.<anonymous> (node_modules/@modelcontextprotocol/sdk/dist/server/stdio.js:12:5)",
      ),
    ).toBe(true);
  });

  it("allows the alternative SDK path form", () => {
    expect(
      isAllowedStackTrace("at StdioTransport.send (@modelcontextprotocol/sdk/server.js:99)"),
    ).toBe(true);
  });

  it("rejects our own code path", () => {
    expect(isAllowedStackTrace("at Object.<anonymous> (src/services/taskService.ts:42)")).toBe(
      false,
    );
  });

  it("rejects an empty stack", () => {
    expect(isAllowedStackTrace("")).toBe(false);
  });
});

describe("installStdoutGuard", () => {
  it("throws when application code calls process.stdout.write", () => {
    installStdoutGuard();
    expect(() => process.stdout.write("hello\n")).toThrow(/Stray stdout write detected/);
  });

  it("error message includes the attempted content", () => {
    installStdoutGuard();
    let message = "";
    try {
      process.stdout.write("secret diagnostic");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("secret diagnostic");
  });

  it("is idempotent — installing twice has no effect", () => {
    installStdoutGuard();
    const wrappedOnce = process.stdout.write;
    installStdoutGuard();
    expect(process.stdout.write).toBe(wrappedOnce);
  });

  it("uninstallStdoutGuard restores original write", () => {
    const before = process.stdout.write;
    installStdoutGuard();
    expect(process.stdout.write).not.toBe(before);
    uninstallStdoutGuard();
    expect(process.stdout.write).toBe(before);
  });

  it("uninstall is a no-op when guard is not installed", () => {
    expect(() => uninstallStdoutGuard()).not.toThrow();
  });
});
