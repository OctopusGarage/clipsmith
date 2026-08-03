import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  npx tsx scripts/run.ts --video_path "/path/to/video.mp4" [--output_dir "/path/to/output"] [--audio_format m4a]`);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function ffprobe(videoPath: string): any {
  const stdout = run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  return JSON.parse(stdout);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const videoInput = requiredString(args, "video_path");
  if (/^https?:\/\//i.test(videoInput)) {
    throw new Error("clipsmith-video-audio only accepts local video file paths");
  }
  const videoPath = resolve(videoInput);
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  const audioFormat = optionalString(args, "audio_format") ?? "m4a";
  if (!["m4a", "wav"].includes(audioFormat)) {
    throw new Error("--audio_format must be m4a or wav");
  }
  const outputDir =
    optionalString(args, "output_dir") ??
    resolve(dirname(videoPath), `${basename(videoPath, extname(videoPath))}_audio`);
  mkdirSync(outputDir, { recursive: true });

  const metadata = ffprobe(videoPath);
  const audioStreams = (metadata.streams ?? []).filter(
    (stream: any) => stream?.codec_type === "audio"
  );
  if (audioStreams.length === 0) {
    throw new Error("No audio stream found in source video");
  }

  const outputPath = resolve(outputDir, `audio.${audioFormat}`);
  const codecArgs =
    audioFormat === "wav"
      ? ["-vn", "-acodec", "pcm_s16le"]
      : ["-vn", "-c:a", "aac", "-b:a", "128k"];
  run("ffmpeg", ["-hide_banner", "-y", "-i", videoPath, ...codecArgs, outputPath]);
  writeFileSync(
    resolve(outputDir, "metadata.json"),
    `${JSON.stringify({ ffprobe: metadata, audio_file: outputPath }, null, 2)}\n`,
    "utf-8"
  );
  console.log(JSON.stringify({ status: "written", audio_file: outputPath, output_dir: outputDir }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clipsmith-video-audio failed: ${message}`);
  process.exitCode = 1;
});
