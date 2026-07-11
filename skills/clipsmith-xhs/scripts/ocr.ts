import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SUPPORTED_DIRECT_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
  ".gif",
]);
const SUPPORTED_INPUT_EXTENSIONS = new Set([...SUPPORTED_DIRECT_EXTENSIONS, ".webp"]);

export interface OcrRunInput {
  imagePath: string;
  outputText: string;
  languages: string;
  recognitionLevel: string;
}

export interface PrepareImageInput {
  imagePath: string;
  tmpDir: string;
}

export interface ImageOcrResult {
  ocrMdFile: string;
  ocrCount: number;
  warnings: string[];
}

export interface WriteImageOcrMarkdownOptions {
  noteDir: string;
  imagePaths: string[];
  languages?: string;
  recognitionLevel?: string;
  runOcr?: (input: OcrRunInput) => Promise<void>;
  prepareImage?: (input: PrepareImageInput) => Promise<string>;
}

export async function writeImageOcrMarkdown(
  options: WriteImageOcrMarkdownOptions
): Promise<ImageOcrResult> {
  const languages = options.languages ?? "zh-Hans,zh-Hant,en";
  const recognitionLevel = options.recognitionLevel ?? "accurate";
  const runOcr = options.runOcr ?? runOcrWithClipsmithSkill;
  const prepareImage = options.prepareImage ?? prepareImageForVision;
  const tmpDir = await mkdtemp(join(tmpdir(), "clipsmith-xhs-ocr-"));
  const warnings: string[] = [];
  const sections: string[] = ["# OCR", "", `Source: ${options.noteDir}`, ""];
  let ocrCount = 0;

  try {
    await mkdir(options.noteDir, { recursive: true });
    for (let index = 0; index < options.imagePaths.length; index += 1) {
      const imagePath = options.imagePaths[index];
      const label = `Image ${String(index + 1).padStart(3, "0")} - ${basename(imagePath)}`;
      const outputText = join(tmpDir, `${randomUUID()}.txt`);
      let text = "";

      try {
        const preparedImagePath = await prepareImage({ imagePath, tmpDir });
        await runOcr({
          imagePath: preparedImagePath,
          outputText,
          languages,
          recognitionLevel,
        });
        text = (await readFile(outputText, "utf-8")).trim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${basename(imagePath)} OCR failed: ${message}`);
      }

      if (text) {
        ocrCount += 1;
      }
      sections.push(`## ${label}`, "", text || "_No OCR text detected._", "");
    }

    const ocrMdFile = resolve(options.noteDir, "ocr.md");
    await writeFile(ocrMdFile, `${sections.join("\n")}\n`, "utf-8");
    return { ocrMdFile, ocrCount, warnings };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function prepareImageForVision(input: PrepareImageInput): Promise<string> {
  const extension = extname(input.imagePath).toLowerCase();
  if (SUPPORTED_DIRECT_EXTENSIONS.has(extension)) {
    return input.imagePath;
  }
  if (extension !== ".webp") {
    throw new Error(`unsupported OCR image format: ${extension || "(none)"}`);
  }
  if (process.platform !== "darwin") {
    throw new Error("WebP OCR conversion requires macOS sips");
  }
  const convertedPath = join(input.tmpDir, `${basename(input.imagePath, extension)}.png`);
  await execFileAsync("sips", ["-s", "format", "png", input.imagePath, "--out", convertedPath]);
  return convertedPath;
}

async function runOcrWithClipsmithSkill(input: OcrRunInput): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("clipsmith-ocr requires macOS Vision.framework");
  }

  const ocrSkillRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "clipsmith-ocr"
  );
  const ocrRunner = resolve(ocrSkillRoot, "scripts", "run.ts");
  try {
    await access(ocrRunner);
  } catch {
    throw new Error(`clipsmith-ocr runner not found: ${ocrRunner}`);
  }

  await execFileAsync(
    "npx",
    [
      "tsx",
      ocrRunner,
      "--image_path",
      input.imagePath,
      "--output_text",
      input.outputText,
      "--languages",
      input.languages,
      "--recognition_level",
      input.recognitionLevel,
    ],
    { cwd: ocrSkillRoot, maxBuffer: 10 * 1024 * 1024 }
  );
}

function parseArgs(argv: string[]): Record<string, string | string[] | boolean> {
  const args: Record<string, string | string[] | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = !next || next.startsWith("--") ? true : next;
    if (value !== true) {
      index += 1;
    }
    if (key === "image_path") {
      const existing = args[key];
      args[key] = Array.isArray(existing)
        ? [...existing, String(value)]
        : existing
          ? [String(existing), String(value)]
          : [String(value)];
      continue;
    }
    args[key] = value;
  }
  return args;
}

async function imagesFromDir(imagesDir: string): Promise<string[]> {
  const entries = await readdir(imagesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(imagesDir, entry.name))
    .filter((path) => SUPPORTED_INPUT_EXTENSIONS.has(extname(path).toLowerCase()))
    .sort();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  npx tsx scripts/ocr.ts --note_dir <note_dir> --image_path <image> [--image_path <image>...]
  npx tsx scripts/ocr.ts --note_dir <note_dir> --images_dir <images_dir>`);
    return;
  }

  const noteDir = typeof args.note_dir === "string" ? args.note_dir : "";
  if (!noteDir) {
    throw new Error("Missing required --note_dir");
  }

  const explicitImages = Array.isArray(args.image_path)
    ? args.image_path.map((item) => resolve(item))
    : [];
  const imagesDir = typeof args.images_dir === "string" ? args.images_dir : "";
  const imagePaths = imagesDir
    ? [...explicitImages, ...(await imagesFromDir(imagesDir))]
    : explicitImages;
  if (imagePaths.length === 0) {
    throw new Error("Provide at least one --image_path or --images_dir");
  }

  const result = await writeImageOcrMarkdown({
    noteDir: resolve(noteDir),
    imagePaths,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`xhs ocr failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
