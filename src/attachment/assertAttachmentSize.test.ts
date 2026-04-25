/**
 * Unit tests for `assertAttachmentSize`.
 *
 * Uses vitest's `vi.mock` to intercept `node:fs/promises` so the tests run
 * without creating real files on disk.
 */

import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/index.js";
import { assertAttachmentSize } from "./assertAttachmentSize.js";

// ---------------------------------------------------------------------------
// Mock fs/promises.stat
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

import { stat } from "node:fs/promises";

const mockStat = vi.mocked(stat);

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatResult(sizeBytes: number) {
  return { size: sizeBytes } as Awaited<ReturnType<typeof stat>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertAttachmentSize", () => {
  it("resolves when file is exactly the cap", async () => {
    mockStat.mockResolvedValue(makeStatResult(100 * MB));
    await expect(assertAttachmentSize("/path/to/file.zip", 100)).resolves.toBeUndefined();
  });

  it("resolves when file is just under the cap", async () => {
    mockStat.mockResolvedValue(makeStatResult(100 * MB - 1));
    await expect(assertAttachmentSize("/path/to/file.zip", 100)).resolves.toBeUndefined();
  });

  it("throws ValidationError when file is just over the cap", async () => {
    mockStat.mockResolvedValue(makeStatResult(100 * MB + 1));
    await expect(assertAttachmentSize("/path/to/file.zip", 100)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when file is far over the cap", async () => {
    mockStat.mockResolvedValue(makeStatResult(500 * MB));
    await expect(assertAttachmentSize("/path/to/file.zip", 100)).rejects.toThrow(ValidationError);
  });

  it("error message contains the cap and actual size", async () => {
    mockStat.mockResolvedValue(makeStatResult(200 * MB));
    const err = await assertAttachmentSize("/path/to/file.zip", 100).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("100 MB");
    expect(err.message).toContain("200.00 MB");
  });

  it("error details include fileSizeBytes and capBytes", async () => {
    mockStat.mockResolvedValue(makeStatResult(150 * MB));
    const err = await assertAttachmentSize("/path/to/file.zip", 100).catch((e) => e);
    expect(err.details).toMatchObject({
      fileSizeBytes: 150 * MB,
      capBytes: 100 * MB,
    });
  });

  it("resolves without calling stat when maxMb is 0 (no cap)", async () => {
    mockStat.mockClear();
    await expect(assertAttachmentSize("/path/to/file.zip", 0)).resolves.toBeUndefined();
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("resolves without calling stat when maxMb is negative", async () => {
    mockStat.mockClear();
    await expect(assertAttachmentSize("/path/to/file.zip", -1)).resolves.toBeUndefined();
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("throws ValidationError with file-not-found message when stat rejects", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT: no such file"));
    const err = await assertAttachmentSize("/missing/file.zip", 100).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("not found or not accessible");
    expect(err.message).toContain("/missing/file.zip");
  });

  it("file-not-found error details contain the filePath", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));
    const err = await assertAttachmentSize("/missing/file.zip", 100).catch((e) => e);
    expect(err.details).toMatchObject({ field: "filePath", value: "/missing/file.zip" });
  });

  it("suggestion text mentions the OMNIFOCUS_MAX_ATTACHMENT_MB env var when over cap", async () => {
    mockStat.mockResolvedValue(makeStatResult(200 * MB));
    const err = await assertAttachmentSize("/path/to/file.zip", 100).catch((e) => e);
    expect(err.suggestion).toContain("OMNIFOCUS_MAX_ATTACHMENT_MB");
  });
});
