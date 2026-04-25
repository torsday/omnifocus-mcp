/**
 * Unit tests for `assertAttachmentPath`.
 *
 * Mocks `node:fs/promises` so tests run without touching the real filesystem.
 * The symlink-escape attack is simulated by having `realpath` return a path
 * that differs from the input (as it would when resolving a symlink).
 */

import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/index.js";
import { assertAttachmentPath } from "./assertAttachmentPath.js";

vi.mock("node:fs/promises", () => ({
  realpath: vi.fn(),
}));

import { realpath } from "node:fs/promises";

const mockRealpath = vi.mocked(realpath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAs(path: string) {
  mockRealpath.mockResolvedValue(path);
}

function rejectWith(err: Error) {
  mockRealpath.mockRejectedValue(err);
}

const HOME = "/Users/alice";
const ALLOWED = [HOME];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertAttachmentPath", () => {
  describe("benign paths", () => {
    it("resolves for a file directly in home", async () => {
      resolveAs(`${HOME}/file.pdf`);
      await expect(assertAttachmentPath(`${HOME}/file.pdf`, ALLOWED)).resolves.toBeUndefined();
    });

    it("resolves for a file in a subdirectory of home", async () => {
      resolveAs(`${HOME}/Documents/report.pdf`);
      await expect(
        assertAttachmentPath(`${HOME}/Documents/report.pdf`, ALLOWED),
      ).resolves.toBeUndefined();
    });

    it("resolves when allowlist has multiple entries and path matches second", async () => {
      resolveAs("/tmp/scratch/file.txt");
      await expect(
        assertAttachmentPath("/tmp/scratch/file.txt", [HOME, "/tmp/scratch"]),
      ).resolves.toBeUndefined();
    });
  });

  describe("symlink-escape attack", () => {
    it("rejects when realpath resolves outside the allowlist", async () => {
      // Symlink inside HOME points to /etc/passwd
      resolveAs("/etc/passwd");
      await expect(assertAttachmentPath(`${HOME}/symlink-to-passwd`, ALLOWED)).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects when realpath resolves into /System", async () => {
      resolveAs("/System/Library/Frameworks/something.framework");
      await expect(assertAttachmentPath(`${HOME}/evil-link`, ALLOWED)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("hard-blocked prefixes", () => {
    it("rejects /System/ paths even if they are in the allowlist", async () => {
      resolveAs("/System/CoreServices/Finder.app");
      await expect(
        assertAttachmentPath("/System/CoreServices/Finder.app", ["/System"]),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects /Library/ paths", async () => {
      resolveAs("/Library/Application Support/something");
      await expect(
        assertAttachmentPath("/Library/Application Support/something", ["/Library"]),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects /private/System/ paths", async () => {
      resolveAs("/private/System/secret");
      await expect(assertAttachmentPath("/private/System/secret", ["/private"])).rejects.toThrow(
        ValidationError,
      );
    });

    it("does NOT reject /SystemExtensions (not a blocked prefix)", async () => {
      resolveAs(`${HOME}/SystemExtensions-backup`);
      await expect(
        assertAttachmentPath(`${HOME}/SystemExtensions-backup`, ALLOWED),
      ).resolves.toBeUndefined();
    });
  });

  describe("prefix-safety (no false positives on similar names)", () => {
    it("rejects /home/alicebob even when allowlist contains /home/alice", async () => {
      resolveAs("/home/alicebob/file.txt");
      await expect(
        assertAttachmentPath("/home/alicebob/file.txt", ["/home/alice"]),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("file not found", () => {
    it("throws ValidationError when realpath rejects", async () => {
      rejectWith(new Error("ENOENT: no such file"));
      const err = await assertAttachmentPath("/missing/file.pdf", ALLOWED).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toContain("cannot be resolved");
    });

    it("error details contain the original filePath", async () => {
      rejectWith(new Error("ENOENT"));
      const err = await assertAttachmentPath("/missing/file.pdf", ALLOWED).catch((e) => e);
      expect(err.details).toMatchObject({ field: "filePath", value: "/missing/file.pdf" });
    });
  });

  describe("error quality", () => {
    it("out-of-scope error mentions OMNIFOCUS_ATTACHMENT_PATHS in suggestion", async () => {
      resolveAs("/etc/hosts");
      const err = await assertAttachmentPath("/etc/hosts", ALLOWED).catch((e) => e);
      expect(err.suggestion).toContain("OMNIFOCUS_ATTACHMENT_PATHS");
    });

    it("out-of-scope error details include resolvedPath and allowedPaths", async () => {
      resolveAs("/etc/hosts");
      const err = await assertAttachmentPath("/etc/hosts", ALLOWED).catch((e) => e);
      expect(err.details).toMatchObject({
        resolvedPath: "/etc/hosts",
        allowedPaths: ALLOWED,
      });
    });

    it("blocked-system-dir error mentions the blocked prefix in the message", async () => {
      resolveAs("/Library/LaunchDaemons/evil.plist");
      const err = await assertAttachmentPath("/Library/LaunchDaemons/evil.plist", ALLOWED).catch(
        (e) => e,
      );
      expect(err.message).toContain("blocked system directory");
    });
  });
});
