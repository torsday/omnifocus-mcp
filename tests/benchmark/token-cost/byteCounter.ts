/**
 * UTF-8 byte counting for the token-cost benchmark suite (#771).
 *
 * `JSON.stringify(value).length` returns *code units*, which over-counts
 * surrogate pairs and under-counts multi-byte UTF-8 sequences for any
 * non-ASCII content the LLM round-trips. The suite drives mostly-ASCII
 * fixtures, but the helper lives here so that any future fixture with
 * notes containing emoji or non-Latin characters measures correctly.
 *
 * `Buffer.byteLength(s, "utf8")` is the canonical Node way to size a
 * string at the wire — that's what the MCP transport actually writes.
 */

/** UTF-8 byte length of a JSON-stringifiable value. */
export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** UTF-8 byte length of a string. */
export function stringByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
