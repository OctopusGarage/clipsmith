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
    [--cdp_port 9223] \\
    [--profile_dir ~/.chrome-labali-no-proxy] \\
    [--timeout_ms 60000] \\
    [--overwrite true|false]`);
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
    cdp_port: optionalString(args, "cdp_port"),
    profile_dir: optionalString(args, "profile_dir"),
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
