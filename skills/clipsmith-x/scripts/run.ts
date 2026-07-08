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
    'cdp-port': { type: 'string', short: 'p', default: '9222' },
    'cdp_port': { type: 'string' },
    'profile-dir': { type: 'string', short: 'd' },
    'profile_dir': { type: 'string' },
    'timeout-ms': { type: 'string', short: 't' },
    'timeout_ms': { type: 'string' },
    'overwrite': { type: 'boolean', short: 'w', default: false },
    'help': { type: 'boolean', short: 'h', default: false },
  },
});

function pickString(primary: string, fallback: string): string | undefined {
  const primaryValue = values[primary];
  if (typeof primaryValue === 'string') {
    return primaryValue;
  }
  const fallbackValue = values[fallback];
  if (typeof fallbackValue === 'string') {
    return fallbackValue;
  }
  return undefined;
}

if (values.help) {
  console.log(`Usage: npx tsx scripts/run.ts --post-url <url> [--output-dir <dir>] [--overwrite]`);
  process.exit(0);
}

const timeoutMs = pickString('timeout_ms', 'timeout-ms');
const inputs = {
  post_url: pickString('post_url', 'post-url'),
  output_dir: pickString('output_dir', 'output-dir'),
  cdp_port: pickString('cdp_port', 'cdp-port'),
  profile_dir: pickString('profile_dir', 'profile-dir'),
  timeout_ms: timeoutMs ? parseInt(timeoutMs) : undefined,
  overwrite: values.overwrite,
};

ensureDeps();
const { execute } = await import('./executor.js');
const result = await execute(inputs);
console.log(JSON.stringify(result, null, 2));
