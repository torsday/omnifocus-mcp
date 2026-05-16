#!/usr/bin/env tsx
/**
 * One-off audit tool — prints every tool description size, sorted descending,
 * so #814 can target the largest descriptions for trimming. Not registered
 * as a long-lived script; lives here for reproducibility.
 */
import { ALL_TOOL_DESCRIPTIONS } from "../src/tools/allDescriptions.js";
import { estimateTokens } from "../tests/benchmark/token-cost/tokenizer.js";

const rows = Object.entries(ALL_TOOL_DESCRIPTIONS)
  .map(([name, desc]) => ({
    name,
    bytes: Buffer.byteLength(desc, "utf8"),
    tokens: estimateTokens(Buffer.byteLength(desc, "utf8")),
  }))
  .sort((a, b) => b.tokens - a.tokens);

console.log("rank  tokens  bytes  name");
console.log("----  ------  -----  ----");
for (let i = 0; i < Math.min(30, rows.length); i++) {
  const r = rows[i];
  if (!r) continue;
  console.log(
    String(i + 1).padStart(4) +
      "   " +
      String(r.tokens).padStart(5) +
      "   " +
      String(r.bytes).padStart(4) +
      "  " +
      r.name,
  );
}
const total = rows.reduce((s, r) => s + r.tokens, 0);
const top20 = rows.slice(0, 20).reduce((s, r) => s + r.tokens, 0);
console.log("");
console.log(`total: ${rows.length} tools, ~${total} tokens`);
console.log(`top 20: ~${top20} tokens (${Math.round((top20 / total) * 100)}%)`);
