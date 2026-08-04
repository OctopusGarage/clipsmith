import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ArgMap = Record<string, string | boolean>;

const SENSITIVE_KEY_PATTERN =
  /GPS|Latitude|Longitude|Address|Location|Owner|Author|Creator|Artist|By-line|Copyright|Rights|Serial|IMEI|Identifier|UserComment|Comment|XPAuthor|XPComment|MakerNote/i;
const SENSITIVE_VALUE_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(\+?[0-9][0-9 ()-]{7,}[0-9])/i;
const IGNORED_METADATA_KEY_PATTERN =
  /^(SourceFile|File Name|Directory|File Size|File Modification Date\/Time|File Access Date\/Time|File Inode Change Date\/Time|File Permissions|File Type|File Type Extension|MIME Type)\s*:/i;

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

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/run.ts --input_image "/path/to/input.jpg" --output_image "/path/to/output.jpg" [--strict]`);
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

function ensureCommand(command: string, versionArg = "--version"): void {
  const result = spawnSync(command, [versionArg], { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Missing dependency: ${command}`);
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function dimensions(path: string): string {
  return run("magick", ["identify", "-format", "%wx%h", path]).trim();
}

function exifDump(path: string): string {
  return optionalRun("exiftool", ["-a", "-u", "-g1", path]);
}

function exifJson(path: string): unknown {
  const stdout = optionalRun("exiftool", ["-json", "-a", "-u", "-g1", path]);
  try {
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

function fileSize(path: string): number {
  return readFileSync(path).byteLength;
}

function snapshot(path: string): Record<string, string | number> {
  const dump = exifDump(path);
  return {
    file_size_bytes: fileSize(path),
    dimensions: dimensions(path),
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  ensureCommand("magick");
  ensureCommand("exiftool", "-ver");

  const inputImage = resolve(requiredString(args, "input_image"));
  const outputImage = resolve(requiredString(args, "output_image"));
  const strict = Boolean(args.strict);

  if (/^https?:\/\//i.test(requiredString(args, "input_image"))) {
    throw new Error("clipsmith-image-metadata-sanitize only accepts local image file paths");
  }
  if (!existsSync(inputImage)) {
    throw new Error(`Image file not found: ${inputImage}`);
  }
  if (inputImage === outputImage) {
    throw new Error("Output image must be a separate path; refusing to overwrite input");
  }

  mkdirSync(dirname(outputImage), { recursive: true });
  const before = snapshot(inputImage);
  run("magick", [inputImage, "-resize", "99%", "-resize", "101%", "-strip", "-quality", "90", outputImage]);
  const after = snapshot(outputImage);
  const scan = scanMetadata(exifDump(outputImage));
  const report = {
    status: "written",
    input_image: inputImage,
    output_image: outputImage,
    before,
    after,
    sensitive_metadata_scan: scan,
    exif_json: exifJson(outputImage),
  };

  writeFileSync(resolve(dirname(outputImage), "metadata_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(report, null, 2));

  if (strict && scan.status !== "PASS") {
    throw new Error("Strict mode gate failed: suspicious hidden metadata detected");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clipsmith-image-metadata-sanitize failed: ${message}`);
  process.exitCode = 1;
});
