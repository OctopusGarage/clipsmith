---
name: clipsmith-ocr
description: Run native macOS image OCR through Vision.framework via pyobjc bridge (same engine family used by Preview/Live Text), with Chinese+English recognition defaults and deterministic CLI execution. Use when you need to extract text from local images on macOS — including screenshots, photos, or scanned documents — and want output to stdout or a text file. Also known as image-to-text or read-text-from-image.
license: MIT
allowed-tools: "Bash(npx:*), Bash(python3:*), Bash(pip:*), Bash(uv:*)"
metadata:
  pattern: pipeline
  compatibility: "macOS only (10.15 Catalina or later); requires Python 3 + pyobjc-framework-Vision; Vision.framework provided by macOS"
---

# clipsmith-ocr

Deterministic local OCR executor backed by Apple Vision.framework. No network calls, no third-party cloud, no API keys. Recognition runs on-device using the same ML model as Preview and Live Text.

Two implementation details that affect output and are not in Apple's public docs:
- **Bounding-box coordinate origin is lower-left** (not upper-left like screen coordinates). The script compensates by sorting on `-(y + height)` descending, then `x` ascending to produce correct reading order.
- **Language correction (`setUsesLanguageCorrection_`) is always enabled** — Vision silently applies a language model to fix likely OCR errors based on the primary recognition language. This improves accuracy but can silently "correct" uncommon proper nouns or technical terms to more common alternatives.

## NEVER

- **NEVER pass a remote URL or HTTP path** — Vision.framework requires a local `file://` URI. Remote paths produce empty output with no error raised.
- **NEVER treat empty output as success** — Vision returns an empty string (not an exception) when: image resolution is too low, format is unsupported, or text contrast is insufficient. Always check that output is non-empty when text is expected.
- **NEVER use `fast` mode for Chinese-heavy images** — `fast` drops strokes on dense CJK characters; use `accurate` (default) unless throughput is more important than accuracy.
- **NEVER assume pyobjc is available system-wide** — this skill is a uv project. The execution wrapper (`run.ts`) uses `uv run --project <skillRoot>` to activate or create the correct environment automatically. Never call `ocr-image-macos.py` directly with `python3`; always invoke via `npx tsx scripts/run.ts`.
- **NEVER run `pip install pyobjc-*` system-wide** — if pyobjc is missing, run `uv sync --project <skillRoot>` to restore the skill environment. System-level `pip install` targets the wrong Python and won't be used by `run.ts`.
- **NEVER run on non-macOS** — the script fails fast with an explicit error; do not attempt fallback OCR (tesseract accuracy for Chinese is significantly lower).
- **NEVER put `zh-Hant` before `zh-Hans` in the languages list for Simplified Chinese documents** — Vision uses the first language as the primary for character disambiguation; wrong ordering causes Simplified characters to be interpreted as Traditional variants, producing incorrect output on ambiguous glyphs.

## Before Running — Expert Pre-flight

Before invoking OCR, ask yourself:

- **Format**: Is this image JPEG/PNG/HEIC/TIFF/BMP/GIF? WebP and SVG must be converted first with `sips`.
- **Density**: Is the text Chinese-heavy, handwritten, or in a dense layout? If yes → `accurate` is mandatory, not optional.
- **Path**: Is the path local and absolute (or `~/`-prefixed)? HTTP paths and relative paths without context will silently fail or error.
- **Environment**: The skill manages dependencies through uv. No manual pip install needed — `run.ts` invokes `uv run --project <skillRoot>` which auto-resolves dependencies. If the environment is missing or stale, run `uv sync --project <skillRoot>` once.

## Required Constraints

- Run on macOS only — Vision.framework is not available on Linux or Windows.
- Default recognition languages: `zh-Hans`, `zh-Hant`, `en`.
- Default recognition level: `accurate` — required for dense Chinese text; `fast` is ~10× faster but drops strokes on complex CJK layouts.
- Input must be a local file path — Vision.framework uses a file URL internally.

## Recognition Level Decision

| Scenario | Use |
|----------|-----|
| Chinese text, mixed scripts, handwriting, dense layouts | `accurate` (default) |
| English-only, printed text, speed matters more than accuracy | `fast` |

## Supported Image Formats

Vision.framework accepts: **JPEG, PNG, HEIC/HEIF, TIFF, BMP, GIF (first frame only)**.

Does **NOT** accept: WebP, SVG, raw camera formats.

> If input is WebP or SVG, convert first:
> ```bash
> sips -s format png input.webp --out input.png
> ```
> **After OCR completes, delete the converted file immediately** — it is a temporary artifact. Only the original image and final bundle files should remain.

## Runtime Inputs

**Required:** `image_path` — absolute or `~/`-relative path to a local image file.
**Optional:**
- `output_text` — path to write OCR result; stdout only if omitted.
- `languages` — comma-separated BCP-47 codes (default: `zh-Hans,zh-Hant,en`).
- `recognition_level` — `accurate` (default) or `fast`.

## Clipsmith Bundle Normalization

The OCR runner extracts text to stdout or `output_text`. Before finalizing a
Clipsmith capture job, run the `raw-output-to-capture.json` normalization step
by creating a bundle directory containing:

- `post.md` with the OCR text.
- `summary.md`.
- The original OCR image as a separate file when it should be preserved.
- `capture.json` with schema `clipsmith.capture_bundle.v1`, platform
  `image-ocr`, the local source path, `content_files` entries for
  `post.md` and `summary.md`, `assets` entries only for OCR image files with
  kind `ocr-image`, warnings, and status.

Run `clipsmith validate-bundle "<bundle_dir>" --json` before finalizing.

## Execution

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr
npx tsx scripts/run.ts \
  --image_path "/path/to/image.jpg" \
  [--output_text "/path/to/result.txt"] \
  [--languages "zh-Hans,zh-Hant,en"] \
  [--recognition_level accurate]
```

The wrapper invokes `uv run --project <skillRoot> python scripts/ocr-image-macos.py` internally. uv creates or reuses the skill environment and installs pyobjc from `pyproject.toml` when needed. **Never call `ocr-image-macos.py` directly.**

To use the full skill root path:
```bash
SKILL=/Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr
npx tsx "$SKILL/scripts/run.ts" --image_path "/path/to/image.jpg"
```

## Failure Modes and Remedies

| Symptom | Likely Cause | Remedy |
|---------|-------------|--------|
| Empty output, no error | Image below ~64×64 px, wrong format, low contrast | Upscale or convert; verify format is in supported list |
| `Missing macOS Vision bridge dependencies` | uv environment missing or stale | Run `uv sync --project <skillRoot>` — **never** `pip install` system-wide |
| `Image file not found` | Path wrong or `~` not expanded | Use absolute path; script calls `expanduser()` automatically |
| `Vision request execution failed` | Corrupted image file | Verify file opens in Preview; try re-exporting |
| Garbled or merged lines | Low-DPI scan or rotated image | Increase DPI or rotate to upright before OCR |
| Script fails before OCR (import error, module not found) | Called `python3` directly instead of via `run.ts` | Always use `npx tsx <skillRoot>/scripts/run.ts`; or `uv sync --project <skillRoot>` if the uv environment is missing |

## Resources

| File | Purpose |
|------|---------|
| `references/architecture.md` | Strategy layer: stage model, fallback order, quality gates, edge cases |
| `scripts/ocr-image-macos.py` | Core OCR implementation via Vision.framework |
| `scripts/run.ts` | Execution entry point (input parsing, delegation) |

**MANDATORY — load `references/architecture.md` when:**
- OCR returns empty output and the cause is unclear
- Input format is unsupported or needs conversion
- You need the fallback order, stage model, or known edge case handling (HEIC, GIF, PDF, rotated images)

**Do NOT load** `references/architecture.md` for standard successful runs — the information above is sufficient.

## Success Criteria

A run is successful only when all conditions hold:

1. Script validates runtime is macOS.
2. Input image exists, is readable, and has a supported format.
3. Vision request completes without API error.
4. OCR text is printed to stdout (may be empty if image contains no recognizable text).
5. If `output_text` is provided, text file is written successfully.
