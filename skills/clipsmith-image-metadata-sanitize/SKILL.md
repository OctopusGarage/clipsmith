---
name: clipsmith-image-metadata-sanitize
description: Strip and verify hidden metadata from a local image file. Use when an image needs EXIF, GPS, author, device, or tracking metadata removed without changing visible pixel content.
---

# Clipsmith Image Metadata Sanitize

Regenerate one local image with ImageMagick, strip hidden metadata, and scan the
result for suspicious metadata keys or values. This skill does not OCR, blur,
crop, mosaic, mask, or otherwise redact visible image content.

## Execution

```bash
cd <clipsmith-repo>/skills/clipsmith-image-metadata-sanitize
npx tsx scripts/run.ts \
  --input_image "/path/to/input.jpg" \
  --output_image "$HOME/Downloads/sanitized.jpg"
```

Optional:

- `--strict` exits non-zero when suspicious hidden metadata remains.

Output:

- sanitized image at `--output_image`
- `metadata_report.json` beside the output image
- console diagnostics with before/after size, dimensions, hash, EXIF count, and
  sensitive metadata scan status

## Constraints

- Accept local image paths only.
- Require `magick` and `exiftool` in `PATH`.
- Never overwrite or delete the source image.
- Treat the scan as hidden-metadata-only. A PASS does not mean visible content is
  safe to publish.

## Success Criteria

1. Source image exists.
2. Output image is written to a separate path.
3. Metadata is stripped during re-encode.
4. `metadata_report.json` is written.
5. Sensitive metadata scan reports `PASS` or `REVIEW_REQUIRED`.
