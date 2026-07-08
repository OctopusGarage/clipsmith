# Architecture — clipsmith-ocr

## Stage Model

| Stage | Trigger | Exit condition |
|-------|---------|----------------|
| `validate-env` | Skill invoked | macOS confirmed; pyobjc importable |
| `validate-input` | `validate-env` passed | `image_path` exists, is a file, format is supported |
| `run-ocr` | `validate-input` passed | Vision request completes (result may be empty string) |
| `emit-output` | `run-ocr` completed | Text printed to stdout; file written if `output_text` provided |

## Execution Pattern

1. Validate runtime environment (macOS check, pyobjc import) — fail fast with actionable error if either fails.
2. Validate input file (existence, readability) — fail fast before invoking Vision.
3. Run `VNRecognizeTextRequest` with configured languages and recognition level.
4. Sort observations by reading order (top-to-bottom, left-to-right using Vision bounding-box `y + height` descending, then `x` ascending).
5. Emit joined text to stdout; optionally write to file.

No retry loop — Vision OCR is deterministic and synchronous. Re-runs on the same input always produce the same output.

## Fallback Order

When OCR produces empty output:
1. Verify the image opens correctly in Preview (rules out corruption).
2. Check image resolution — Vision requires minimum ~64×64 px effective text area.
3. Try converting format: `sips -s format png <input> --out <output>` then re-run.
4. If contrast is very low, pre-process to enhance contrast before OCR:
   ```bash
   python3 -c "
   from PIL import Image, ImageEnhance
   img = ImageEnhance.Contrast(Image.open('input.png')).enhance(2.0)
   img.save('input_enhanced.png')
   "
   ```
   (Requires Pillow in the active uv environment; prefer `uv add --project <skillRoot> Pillow` for this optional diagnostic path.)
5. If format is WebP or SVG: convert first, then re-run. Do not attempt OCR directly.

There is no policy-baseline fallback to a different OCR engine — tesseract accuracy for Chinese is significantly lower and is not an acceptable substitute.

## Quality Gates

- **Before `run-ocr`**: `image_path` must be an absolute path to an existing, readable file in a supported format.
- **After `run-ocr`**: if caller expects non-empty text but output is empty, surface a warning rather than silently succeeding — action completion is not task success.
- **After `emit-output`**: if `output_text` was provided, confirm the file was written before returning success.

## Known Edge Cases

- **HEIC from iPhone**: supported natively on macOS 10.15+; no conversion needed.
- **GIF**: only the first frame is processed; multi-frame animation is not recognized.
- **PDF**: Vision.framework does NOT accept PDF directly via file URL in this script. Extract page as image first (`sips` or `qlmanage -t -s 2000 -o /tmp input.pdf`).
- **Rotated images**: Vision attempts to correct orientation using EXIF data, but images without EXIF (e.g., screenshots cropped/resaved) may produce reordered or merged lines — rotate to upright manually if needed.
- **Mixed-script text**: languages list order affects character disambiguation. `zh-Hans,zh-Hant,en` is the correct default for Simplified Chinese documents with embedded English. For Traditional Chinese documents, use `zh-Hant,zh-Hans,en`. Never put `zh-Hant` before `zh-Hans` for Simplified Chinese — Vision uses the first language as primary for disambiguation, which causes incorrect character selection on ambiguous glyphs.
- **Very long images** (e.g., full-page screenshot): Vision processes the whole image in one request — no chunking needed.

## Observability

The script prints errors to `stderr` and exits with code `1` on failure. Stdout is reserved for OCR text only. Callers should capture stderr separately for diagnostics.
