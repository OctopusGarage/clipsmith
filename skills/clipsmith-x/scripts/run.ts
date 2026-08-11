#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const __skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function ensureDeps(): void {
  const pkgPath = `${__skillRoot}/package.json`;
  const nmPath = `${__skillRoot}/node_modules`;
  const needsInstall = !existsSync(nmPath) || statSync(pkgPath).mtimeMs > statSync(nmPath).mtimeMs;
  if (!needsInstall) {
    return;
  }

  console.log('[setup] Installing dependencies...');
  const pnpmCheck = spawnSync('pnpm', ['--version'], { stdio: 'pipe' });
  if (pnpmCheck.error || pnpmCheck.status !== 0) {
    console.error('[clipsmith-x] pnpm is required but not found.');
    console.error('  Install: npm install -g pnpm');
    process.exit(1);
  }
  execSync('pnpm install', { cwd: __skillRoot, stdio: 'inherit' });
}

const { values } = parseArgs({
  options: {
    'post-url': { type: 'string', short: 'u' },
    'post_url': { type: 'string' },
    'output-dir': { type: 'string', short: 'o' },
    'output_dir': { type: 'string' },
    'bundle-dir': { type: 'string' },
    'bundle_dir': { type: 'string' },
    'no-auto-inbox': { type: 'boolean', default: false },
    'no_auto_inbox': { type: 'boolean', default: false },
    'print-target': { type: 'boolean', default: false },
    'print_target': { type: 'boolean', default: false },
    'cdp-port': { type: 'string', short: 'p', default: '9222' },
    'cdp_port': { type: 'string' },
    'profile-dir': { type: 'string', short: 'd' },
    'profile_dir': { type: 'string' },
    'timeout-ms': { type: 'string', short: 't' },
    'timeout_ms': { type: 'string' },
    'overwrite': { type: 'boolean', short: 'w', default: false },
    'keep-process-alive': { type: 'boolean', default: false },
    'keep_process_alive': { type: 'boolean', default: false },
    'help': { type: 'boolean', short: 'h', default: false },
  },
});

type ArgKey = keyof typeof values;

function pickString(primary: ArgKey, fallback: ArgKey): string | undefined {
  const primaryValue = values[primary];
  if (typeof primaryValue === 'string') return primaryValue;
  const fallbackValue = values[fallback];
  return typeof fallbackValue === 'string' ? fallbackValue : undefined;
}

if (values.help) {
  console.log(`Usage:
  npx tsx scripts/run.ts --post-url <url> [options]

Output destination (priority order):
  --bundle-dir <path>   Write the final bundle to <path> and run normalize.
                         Explicit; never overridden.
  --no-auto-inbox       Skip inbox auto-detection even when a KB root is reachable.
  (auto)                Detect the KB inbox from $KB_ROOT, cwd, or \`alcove kb list\`
                         and write the bundle there. Falls back to legacy
                         ~/Downloads/x/<id>/ only when no KB root is reachable.

Other options:
  --print-target        Resolve the destination directory and print it without
                         running the capture (dry-run). Use this to verify the
                         auto-pick landed where you expected.
  --overwrite           Replace an existing bundle directory at the target.
  --post-url <url>      Source X post URL (required)
  --output-dir <dir>    Legacy raw-stage directory; ignored when --bundle-dir
                         or auto-inbox kicks in.
  --cdp-port <9222>     Chrome DevTools Protocol port for live capture.
  --profile-dir <dir>   Chrome profile directory (--no-proxy-server profile by default).
  --timeout-ms <ms>     Per-page-load timeout.
  --keep-process-alive  Skip Playwright CDP disconnect (rarely needed).
  --help                Show this message.

Environment:
  KB_ROOT=<path>        Force inbox auto-resolution to start from this KB root.
  KB_NAME=<name>        Pick a specific Alcove KB when multiple are registered.
  KB_NO_AUTO_INBOX=1    Equivalent to passing --no-auto-inbox.`);
  process.exit(0);
}

const postUrl = pickString('post_url', 'post-url');
if (!postUrl) {
  console.error("error: --post-url is required (or set --help)");
  process.exit(2);
}

const bundleDirArg = pickString('bundle_dir', 'bundle-dir');
const noAutoInbox = Boolean(values['no-auto-inbox']) || Boolean(values.no_auto_inbox);
const printTarget = Boolean(values['print-target']) || Boolean(values.print_target);
const timeoutMsStr = pickString('timeout_ms', 'timeout-ms');
const keepProcessAlive =
  Boolean(values.keep_process_alive) || Boolean(values['keep-process-alive']);

// ---------------------------------------------------------------------------
// Resolve target directory
// ---------------------------------------------------------------------------
const { canonicalizePostUrl, parseTweetId, extractHandleFromUrl } = await import('./core.js');
const { resolveAutoInbox } = await import('./inbox-target.js');

const canonicalUrl = canonicalizePostUrl(postUrl);
const tweetId = parseTweetId(canonicalUrl);
let bundleDir = bundleDirArg;
let autoSource: 'env' | 'cwd' | 'alcove' | undefined;

if (!bundleDir && !noAutoInbox) {
  const handle = (() => {
    try { return extractHandleFromUrl(canonicalUrl); } catch { return undefined; }
  })();
  const target = await resolveAutoInbox({
    platform: 'x',
    // Match the existing inbox/x/<handle>-<tweetId>/ convention so the auto
    // path produces the same leaf as a manual --bundle-dir would.
    leaf: handle ? `${handle}-${tweetId}` : tweetId,
    cwd: process.cwd(),
    env: process.env,
  });
  if (target) {
    bundleDir = target.path;
    autoSource = target.source;
  }
}

if (printTarget) {
  // Dry-run: print the resolved target and exit.
  if (bundleDir) {
    console.log(JSON.stringify({
      post_url: canonicalUrl,
      tweet_id: tweetId,
      target: bundleDir,
      source: bundleDirArg ? 'explicit' : (autoSource ?? 'fallback'),
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      post_url: canonicalUrl,
      tweet_id: tweetId,
      target: null,
      source: 'fallback',
      fallback_to: `${process.env.HOME ?? '~'}/Downloads/x/${tweetId}`,
    }, null, 2));
  }
  process.exit(0);
}

const inputs = {
  post_url: postUrl,
  output_dir: pickString('output_dir', 'output-dir'),
  bundle_dir: bundleDir,
  cdp_port: pickString('cdp_port', 'cdp-port'),
  profile_dir: pickString('profile_dir', 'profile-dir'),
  timeout_ms: timeoutMsStr ? parseInt(timeoutMsStr) : undefined,
  overwrite: values.overwrite,
  keep_process_alive: keepProcessAlive,
};

if (bundleDir && !bundleDirArg) {
  console.log(`[run.ts] auto-inbox (${autoSource}) → ${bundleDir}`);
}

ensureDeps();
const { execute } = await import('./executor.js');
const result = await execute(inputs);
console.log(JSON.stringify(result, null, 2));
