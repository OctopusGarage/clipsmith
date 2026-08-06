#!/usr/bin/env node
/**
 * x-download — Download a single X post's text + media.
 *
 * Thin wrapper around executor.ts. All capture logic (Chrome CDP reuse,
 * login-wall detection → syndication fallback, asset sanitization, etc.)
 * lives in executor.ts and is shared with run.ts so both entry points
 * have identical behavior.
 *
 * Usage:
 *   node scripts/download.mts <post-url> [output-dir]
 *
 * <output-dir> defaults to ~/Downloads/x.  No Chrome is launched; if no
 * Chrome is listening at :9222, the capture falls back to the anonymous
 * syndication endpoint automatically.
 */
const POST_URL = process.argv[2];
const OUTPUT_DIR = process.argv[3];

if (!POST_URL) {
  console.error("Usage: node scripts/download.mts <post-url> [output-dir]");
  process.exit(1);
}

const { execute } = await import("./executor.js");
const result = await execute({ post_url: POST_URL, output_dir: OUTPUT_DIR });
console.log(JSON.stringify(result, null, 2));
