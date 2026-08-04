import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ArgMap = Record<string, string | boolean>;

const SENSITIVE_KEY_PATTERN =
  /GPS|Latitude|Longitude|Location|Address|Author|Artist|Creator|Owner|Description|Comment|Copyright|Rights|Serial|IMEI|UUID|UniqueID|com\.apple\.quicktime\.location/i;
const SENSITIVE_VALUE_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(\+?[0-9][0-9 ()-]{7,}[0-9])/i;
const WATERMARK_FILTER =
  "scale=trunc(iw*0.98/2)*2:trunc(ih*0.98/2)*2,scale=trunc(iw/0.98/2)*2:trunc(ih/0.98/2)*2";
const IGNORED_METADATA_KEY_PATTERN =
  /^(SourceFile|File Name|Directory|File Size|File Modification Date\/Time|File Access Date\/Time|File Inode Change Date\/Time|File Permissions|File Type|File Type Extension|MIME Type|Handler Description|Sample Group Description|Major Brand|Minor Version|Compatible Brands|Matrix Structure|Media Header Version|Media Create Date|Media Modify Date|Track Header Version|Track Create Date|Track Modify Date|Time Scale|Movie Header Version|Create Date|Modify Date)\s*:/i;

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

function requiredString(args: ArgMap, key: string): string {
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

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run.ts --input_video "/path/to/input.mp4" --output_video "/path/to/output.mp4" [--mode metadata-only] [--strict]`);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout;
}

function optionalRun(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  return result.stdout || result.stderr || "";
}

function ensureCommand(command: string, versionArg = "-version"): void {
  const result = spawnSync(command, [versionArg], { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Missing dependency: ${command}`);
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ffprobeJson(path: string): any {
  return JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]));
}

function exifDump(path: string): string {
  return optionalRun("exiftool", ["-a", "-u", "-g1", path]);
}

function fileSize(path: string): number {
  return readFileSync(path).byteLength;
}

function dimensions(probe: any): string {
  const video = (probe.streams ?? []).find((stream: any) => stream?.codec_type === "video");
  if (!video?.width || !video?.height) return "unknown";
  return `${video.width}x${video.height}`;
}

function snapshot(path: string): Record<string, string | number> {
  const probe = ffprobeJson(path);
  const dump = exifDump(path);
  return {
    file_size_bytes: fileSize(path),
    duration_seconds: probe.format?.duration ?? "unknown",
    dimensions: dimensions(probe),
    exif_line_count: dump.trim() ? dump.trim().split(/\r?\n/).length : 0,
    sha256: sha256(path),
  };
}

function scanMetadata(dump: string): { status: "PASS" | "REVIEW_REQUIRED"; key_hits: string[]; value_hits: string[] } {
  const lines = dump
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !IGNORED_METADATA_KEY_PATTERN.test(line));
  const keyHits = [...new Set(lines.filter((line) => SENSITIVE_KEY_PATTERN.test(line)))].sort();
  const valueHits = [...new Set(lines.filter((line) => SENSITIVE_VALUE_PATTERN.test(line)))].sort();
  return {
    status: keyHits.length || valueHits.length ? "REVIEW_REQUIRED" : "PASS",
    key_hits: keyHits,
    value_hits: valueHits,
  };
}

function outputArgs(inputPath: string): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-write_tmcd",
    "0",
  ];
}

function sanitizeVideo(inputVideo: string, outputVideo: string, mode: string): void {
  if (mode === "metadata-only") {
    run("ffmpeg", [...outputArgs(inputVideo), "-crf", "23", outputVideo]);
    return;
  }

  const intermediate = `${outputVideo}.intermediate-pass.mp4`;
  try {
    run("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      inputVideo,
      "-vf",
      WATERMARK_FILTER,
      "-c:v",
      "libx264",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      intermediate,
    ]);
    run("ffmpeg", [...outputArgs(intermediate), "-vf", WATERMARK_FILTER, "-crf", "28", outputVideo]);
  } finally {
    if (existsSync(intermediate)) unlinkSync(intermediate);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  ensureCommand("ffmpeg");
  ensureCommand("ffprobe");
  ensureCommand("exiftool", "-ver");

  const inputRaw = requiredString(args, "input_video");
  if (/^https?:\/\//i.test(inputRaw)) {
    throw new Error("clipsmith-video-metadata-sanitize only accepts local video file paths");
  }
  const inputVideo = resolve(inputRaw);
  const outputVideo = resolve(requiredString(args, "output_video"));
  const strict = Boolean(args.strict);
  const mode = optionalString(args, "mode") ?? "metadata-only";

  if (!["metadata-only", "watermark-resistant"].includes(mode)) {
    throw new Error("--mode must be metadata-only or watermark-resistant");
  }
  if (!existsSync(inputVideo)) {
    throw new Error(`Video file not found: ${inputVideo}`);
  }
  if (inputVideo === outputVideo) {
    throw new Error("Output video must be a separate path; refusing to overwrite input");
  }

  mkdirSync(dirname(outputVideo), { recursive: true });
  const before = snapshot(inputVideo);
  sanitizeVideo(inputVideo, outputVideo, mode);
  const after = snapshot(outputVideo);
  const probe = ffprobeJson(outputVideo);
  const scan = scanMetadata(exifDump(outputVideo));
  const report = {
    status: "written",
    mode,
    input_video: inputVideo,
    output_video: outputVideo,
    before,
    after,
    sensitive_metadata_scan: scan,
    ffprobe: probe,
  };

  writeFileSync(resolve(dirname(outputVideo), "metadata_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(report, null, 2));

  if (strict && scan.status !== "PASS") {
    throw new Error("Strict mode gate failed: suspicious hidden metadata detected");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clipsmith-video-metadata-sanitize failed: ${message}`);
  process.exitCode = 1;
});
