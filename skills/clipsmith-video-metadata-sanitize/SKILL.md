---
name: clipsmith-video-metadata-sanitize
description: Strip and verify hidden metadata from a local video file. Use when a video needs container, EXIF, chapter, author, location, or tracking metadata removed without modifying capture providers.
---

# Clipsmith Video Metadata Sanitize

Re-encode one local video with FFmpeg, remove hidden metadata and chapters, and
scan the result for suspicious metadata keys or values. This skill does not
transcribe audio, create snapshots, run OCR, write capture bundles, or redact
visible frame content.

## Execution

```bash
cd <clipsmith-repo>/skills/clipsmith-video-metadata-sanitize
npx tsx scripts/run.ts \
  --input_video "/path/to/input.mp4" \
  --output_video "$HOME/Downloads/sanitized.mp4"
```

Optional:

- `--mode metadata-only` is the default local re-encode and metadata strip.
- `--mode watermark-resistant` enables stronger two-pass re-encode with mild
  scale perturbation and higher compression. Use it only when the quality
  trade-off is acceptable.
- `--strict` exits non-zero when suspicious hidden metadata remains.

Output:

- sanitized MP4 at `--output_video`
- `metadata_report.json` beside the output video
- console diagnostics with before/after size, duration, dimensions, hash, EXIF
  count, ffprobe tags, and sensitive metadata scan status

## Constraints

- Accept local video paths only.
- Require `ffmpeg`, `ffprobe`, and `exiftool` in `PATH`.
- Never overwrite or delete the source video.
- Do not attach this to provider capture automatically.
- Treat the scan as hidden-metadata-only. It is practical-risk reduction, not
  guaranteed forensic erasure or visible-content desensitization.

## Success Criteria

1. Source video exists.
2. Output video is written to a separate path.
3. Metadata and chapters are stripped during re-encode.
4. `metadata_report.json` is written.
5. Sensitive metadata scan reports `PASS` or `REVIEW_REQUIRED`.
