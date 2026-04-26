/**
 * Type shim for `ping.js`.
 *
 * The tsup `scriptInlinerPlugin` rewrites this import at build time so the
 * default export is the raw OmniJS script source as a UTF-8 string. This
 * `.d.ts` teaches TypeScript the same shape so `OmniJsTransport` can
 * `import` it without a missing-module error.
 *
 * Each OmniJS script gets its own sibling `.d.ts` file rather than a wildcard
 * declaration so the import surface is greppable and explicit.
 *
 * @see src/scripts/scriptLoader.ts
 */

declare const source: string;
export default source;
