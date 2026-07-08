# clipsmith-ocr Usage

This skill extracts text from local images on macOS using the native Vision.framework OCR engine (the same engine used by Preview and Live Text), with Chinese and English recognition defaults.

## 1) Install and Update

Install from GitHub:

```bash
npx skills add /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr
```

Update to latest version: run the install command again.

## 2) Prerequisites

macOS only. Dependencies are managed via uv — **no manual pip install needed.**

The skill ships a `pyproject.toml`. The `scripts/run.ts` wrapper automatically invokes `uv run --project <skillRoot>`, which creates or reuses the skill environment and installs pyobjc when needed.

If you see `Missing macOS Vision bridge dependencies`, restore the venv with:

```bash
uv sync --project /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr
```

Do **not** run `pip install pyobjc-*` system-wide — it installs into the wrong Python and won't be picked up by `run.ts`.

## 3) Quick Start

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr
npx tsx scripts/run.ts \
  --image_path "/path/to/image.jpg"
```

Optional flags:
- `--output_text "/path/to/result.txt"` — write OCR text to file instead of stdout only
- `--languages "zh-Hans,zh-Hant,en"` — comma-separated language list (default: `zh-Hans,zh-Hant,en`)
- `--recognition_level accurate` — `accurate` (default) or `fast`

## 4) What It Does

1. Validates runtime is macOS.
2. Opens the input image file.
3. Submits a Vision OCR request with the configured languages and recognition level.
4. Returns recognized text in reading order, preserving line breaks.
5. Prints text to stdout; if `--output_text` is provided, also writes to file.

## 5) Limitations

1. **macOS only** — Vision.framework is not available on Linux or Windows.
2. **Language coverage** — recognition quality depends on the system Vision model; uncommon scripts may have lower accuracy.
3. **No cloud calls** — fully offline; accuracy is bounded by the on-device model.

## 6) Troubleshooting

- `Missing macOS Vision bridge dependencies`: run `uv sync --project /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-ocr`. Do NOT use pip install.
- Empty output: check that the image contains visible text and is not corrupted.
- Poor accuracy: try switching to `--recognition_level accurate` (default) or adjusting `--languages` to match the dominant script.
