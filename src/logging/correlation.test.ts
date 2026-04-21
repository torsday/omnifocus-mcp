import { describe, expect, it } from "vitest";
import { generateCorrelationId, getCorrelationId, withCorrelationId } from "./correlation.js";

describe("withCorrelationId", () => {
  it("propagates a generated ULID to getCorrelationId inside the scope", () => {
    let id: string | undefined;
    withCorrelationId(() => {
      id = getCorrelationId();
    });
    expect(id).toBeDefined();
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("reuses an incoming ID when provided", () => {
    const incoming = "01JBZK1234567890ABCDEFGHIJ";
    let id: string | undefined;
    withCorrelationId(() => {
      id = getCorrelationId();
    }, incoming);
    expect(id).toBe(incoming);
  });

  it("generates a new ULID when incoming is empty string", () => {
    let id: string | undefined;
    withCorrelationId(() => {
      id = getCorrelationId();
    }, "");
    expect(id).toBeDefined();
    expect(id).not.toBe("");
  });

  it("generates a new ULID when incoming is whitespace only", () => {
    let id: string | undefined;
    withCorrelationId(() => {
      id = getCorrelationId();
    }, "   ");
    expect(id).toBeDefined();
    expect(id?.trim().length).toBeGreaterThan(0);
    expect(id).not.toBe("   ");
  });

  it("isolates IDs across concurrent scopes", async () => {
    const ids: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) =>
        withCorrelationId(() => {
          // Yield to let other scope run
          setTimeout(() => {
            ids.push(getCorrelationId() ?? "");
            resolve();
          }, 0);
        }, "ID-A"),
      ),
      new Promise<void>((resolve) =>
        withCorrelationId(() => {
          setTimeout(() => {
            ids.push(getCorrelationId() ?? "");
            resolve();
          }, 0);
        }, "ID-B"),
      ),
    ]);
    expect(ids).toContain("ID-A");
    expect(ids).toContain("ID-B");
    expect(ids).toHaveLength(2);
  });

  it("returns undefined outside a scope", () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it("returns the value produced by fn", () => {
    const result = withCorrelationId(() => 42);
    expect(result).toBe(42);
  });
});

describe("generateCorrelationId", () => {
  it("returns a ULID-shaped string", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("returns unique values on each call", () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
  });
});
