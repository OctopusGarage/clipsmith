import { existsSync, statSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DownloadArticleInputs } from "./core.js";

const __skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function ensureDeps(): void {
  const pkgPath = `${__skillRoot}/package.json`;
  const nmPath = `${__skillRoot}/node_modules`;
  const needsInstall =
    !existsSync(nmPath) || statSync(pkgPath).mtimeMs > statSync(nmPath).mtimeMs;
  if (needsInstall) {
    console.log("[setup] Installing dependencies...");
    const pnpmCheck = spawnSync("pnpm", ["--version"], { stdio: "pipe" });
    if (pnpmCheck.error || pnpmCheck.status !== 0) {
      console.error("[labali] pnpm is required but not found.");
      console.error("  Install: npm install -g pnpm");
      process.exit(1);
    }
    execSync("pnpm install", { cwd: __skillRoot, stdio: "inherit" });
  }
}

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function optionalString(args: ArgMap, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function parseBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function optionalNumber(args: ArgMap, key: string): number | undefined {
  const value = optionalString(args, key);
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Invalid number for --${key}: ${value}`);
  return n;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run.ts \\
    --post_url "https://mp.weixin.qq.com/s/<article_id>" \\
    --output_dir "$HOME/Downloads/wechat" \\
    [--bundle_dir /path/to/inbox/wechat/wechat-<id>] \\
    [--browser_mode headless|headed|cdp] \\
    [--keep_open true|false] \\
    [--slow_mo_ms 50] \\
    [--cdp_port 9223] \\
    [--profile_dir ~/.clipsmith/browser-profiles/wechat] \\
    [--timeout_ms 60000] \\
    [--overwrite true|false]

Default browser mode is headless: the skill launches a non-visual browser for
the capture and closes it when the capture finishes. Use headed for visible
short-lived debugging, or cdp to attach to an existing Chrome on --cdp_port.

When --bundle_dir is provided, the skill writes a finalized capture bundle
(capture.json, post.md, summary.md, assets/) to that exact directory and
runs clipsmith normalize for you — no second command needed. Without it,
the skill writes a raw download (article.md + images + article.mhtml) under
--output_dir, same as before.`);
}

async function main(): Promise<void> {
  ensureDeps();
  const { execute } = await import("./executor.js");

  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const args = parseArgs(rawArgs);

  const inputs: DownloadArticleInputs = {
    post_url: optionalString(args, "post_url"),
    output_dir: optionalString(args, "output_dir"),
    bundle_dir: optionalString(args, "bundle_dir") ?? optionalString(args, "bundle-dir"),
    cdp_port: optionalString(args, "cdp_port"),
    profile_dir: optionalString(args, "profile_dir"),
    browser_mode: optionalString(args, "browser_mode") ?? optionalString(args, "browser-mode"),
    keep_open: parseBoolean(args["keep_open"] ?? args["keep-open"], false),
    slow_mo_ms: optionalNumber(args, "slow_mo_ms") ?? optionalNumber(args, "slow-mo-ms"),
    timeout_ms: optionalNumber(args, "timeout_ms"),
    overwrite: parseBoolean(args["overwrite"], false),
  };

  try {
    const result = await execute(inputs);
    console.log("\n[wechat] Download complete:");
    console.log(`  Folder:     ${result.article_dir}`);
    console.log(`  article.md: ${result.article_md_file}`);
    if (result.article_mhtml_file) {
      console.log(`  article.mhtml: ${result.article_mhtml_file}`);
    }
    console.log(`  Images:     ${result.image_count}`);
    if (result.failed_count > 0) {
      console.warn(`  Failed:  ${result.failed_count}`);
      for (const f of result.failed) {
        console.warn(`    - ${f.url}: ${f.error}`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("[wechat] Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
