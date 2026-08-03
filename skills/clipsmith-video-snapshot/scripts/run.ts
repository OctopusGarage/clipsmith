import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function stringArg(args: ArgMap, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required --${key}`);
  }
  return value.trim();
}

function optionalString(args: ArgMap, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberArg(args: ArgMap, key: string, fallback: number): number {
  const value = optionalString(args, key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive number`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run.ts --video_path "/path/to/video.mp4" [--output_dir "/path/to/output"] [--mode smart] [--fps 0.5] [--scene 0.3] [--max_gap 1.2]`);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim()}`);
  }
  return result.stderr;
}

function filter(mode: string, fps: number, scene: number, maxGap: number): string {
  if (mode === "fixed") return `fps=${fps},showinfo`;
  return `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${maxGap})+gt(scene\\,${scene})',showinfo`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const videoInput = stringArg(args, "video_path");
  if (/^https?:\/\//i.test(videoInput)) {
    throw new Error("clipsmith-video-snapshot only accepts local video file paths");
  }
  const videoPath = resolve(videoInput);
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  const mode = optionalString(args, "mode") ?? "smart";
  if (!["smart", "fixed"].includes(mode)) {
    throw new Error("--mode must be smart or fixed");
  }
  const fps = numberArg(args, "fps", 0.5);
  const scene = numberArg(args, "scene", 0.3);
  const maxGap = numberArg(args, "max_gap", 1.2);
  const outputDir =
    optionalString(args, "output_dir") ??
    resolve(dirname(videoPath), `${basename(videoPath, extname(videoPath))}_snapshots`);
  const snapshotsDir = resolve(outputDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  for (const name of readdirSync(snapshotsDir)) {
    if (/^snapshot_\d+\.jpg$/.test(name)) {
      unlinkSync(resolve(snapshotsDir, name));
    }
  }

  const pattern = resolve(snapshotsDir, "snapshot_%06d.jpg");
  const stderr = run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    videoPath,
    "-vf",
    filter(mode, fps, scene, maxGap),
    "-fps_mode",
    "vfr",
    "-q:v",
    "3",
    pattern,
  ]);
  const ptsTimes = [...stderr.matchAll(/showinfo.*pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map(
    (match) => Number(match[1])
  );
  const snapshots = readdirSync(snapshotsDir)
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name, index) => ({ file: `snapshots/${name}`, pts_time: ptsTimes[index] ?? null }));
  writeFileSync(
    resolve(outputDir, "snapshot_manifest.json"),
    `${JSON.stringify({ video_path: videoPath, snapshots }, null, 2)}\n`,
    "utf-8"
  );
  console.log(JSON.stringify({ status: "written", output_dir: outputDir, snapshot_count: snapshots.length }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clipsmith-video-snapshot failed: ${message}`);
  process.exitCode = 1;
});
