import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run.ts --audio_path "/path/to/audio.m4a" --transcript_cmd "whisper {audio} --output_format txt --output_dir {output_dir}" [--output_dir "/path/to/output"]`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const audioInput = stringArg(args, "audio_path");
  if (/^https?:\/\//i.test(audioInput)) {
    throw new Error("clipsmith-audio-transcript only accepts local audio file paths");
  }
  const audioPath = resolve(audioInput);
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }
  const outputDir =
    optionalString(args, "output_dir") ??
    resolve(dirname(audioPath), `${basename(audioPath, extname(audioPath))}_transcript`);
  mkdirSync(outputDir, { recursive: true });
  const outputText = resolve(outputDir, "transcript.txt");
  const command = stringArg(args, "transcript_cmd")
    .replaceAll("{audio}", shellQuote(audioPath))
    .replaceAll("{output_dir}", shellQuote(outputDir))
    .replaceAll("{output_text}", shellQuote(outputText));

  const result = spawnSync(command, { shell: true, encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`transcription command failed: ${result.stderr.trim()}`);
  }
  if (!existsSync(outputText)) {
    writeFileSync(outputText, result.stdout.trim() ? `${result.stdout.trim()}\n` : "", "utf-8");
  }
  const transcript = readFileSync(outputText, "utf-8").trim();
  writeFileSync(
    resolve(outputDir, "transcript.md"),
    `# Transcript\n\nSource: ${audioPath}\n\n${transcript}\n`,
    "utf-8"
  );
  writeFileSync(
    resolve(outputDir, "metadata.json"),
    `${JSON.stringify({ audio_path: audioPath, transcript_cmd: stringArg(args, "transcript_cmd") }, null, 2)}\n`,
    "utf-8"
  );
  console.log(JSON.stringify({ status: "written", transcript: outputText, output_dir: outputDir }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clipsmith-audio-transcript failed: ${message}`);
  process.exitCode = 1;
});
