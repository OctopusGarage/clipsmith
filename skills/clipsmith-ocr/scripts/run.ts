import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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

function requiredString(args: ArgMap, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required --${key}`);
  }
  return value.trim();
}

function optionalString(args: ArgMap, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function printUsage(): void {
  console.log(`Usage:\n  npx tsx scripts/run.ts \\\n    --image_path "/path/to/image.jpg" \\\n    [--output_text "/path/to/result.txt"] \\\n    [--languages "zh-Hans,zh-Hant,en"] \\\n    [--recognition_level accurate]`);
}

function buildPythonCmd(scriptPath: string): { cmd: string; leadArgs: string[] } {
  const runner = (process.env.LABALI_PYTHON_RUNNER ?? "uv").trim();
  if (runner === "system") {
    return { cmd: "python3", leadArgs: [scriptPath] };
  }
  const uvCheck = spawnSync("uv", ["--version"], { stdio: "pipe" });
  if (uvCheck.error || uvCheck.status !== 0) {
    console.error("[labali] uv is required but not found.");
    console.error("  Install: curl -LsSf https://astral.sh/uv/install.sh | sh");
    console.error("  Or use your existing Python: export LABALI_PYTHON_RUNNER=system");
    process.exit(1);
  }
  return { cmd: "uv", leadArgs: ["run", "--project", __skillRoot, "python", scriptPath] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const imagePath = requiredString(args, "image_path");
  const outputText = optionalString(args, "output_text");
  const languages = optionalString(args, "languages");
  const recognitionLevel = optionalString(args, "recognition_level");

  const scriptPath = `${__skillRoot}/scripts/ocr-image-macos.py`;
  const scriptArgs = ["--image-path", imagePath];

  if (outputText) scriptArgs.push("--output-text", outputText);
  if (languages) scriptArgs.push("--languages", languages);
  if (recognitionLevel) scriptArgs.push("--recognition-level", recognitionLevel);

  const { cmd, leadArgs } = buildPythonCmd(scriptPath);
  const result = spawnSync(cmd, [...leadArgs, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
  });

  if (typeof result.status === "number" && result.status !== 0) {
    process.exitCode = result.status;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`macOS image OCR failed: ${message}`);
  process.exitCode = 1;
});
