---
name: clipsmith-video-snapshot
description: Extract timestamped image snapshots from a local video with ffmpeg. Use clipsmith-ocr separately when OCR is needed for the snapshots.
---

# Clipsmith Video Snapshot

Extract snapshots from a local video. This skill does not extract audio,
transcribe speech, run OCR, or write capture bundles.

For text in snapshots, run `clipsmith-ocr` on the generated image files after
this skill completes.

## Execution

```bash
cd <clipsmith-repo>/skills/clipsmith-video-snapshot
npx tsx scripts/run.ts \
  --video_path "/path/to/video.mp4" \
  --output_dir "$HOME/Downloads/clipsmith-video-snapshot" \
  --mode smart
```

Output:

- `snapshots/snapshot_000001.jpg`, etc.
- `snapshot_manifest.json`

## Constraints

- Accept local video paths only.
- Use `ffmpeg` `showinfo` timestamps where available.
- Do not run Vision OCR directly; delegate OCR to `clipsmith-ocr`.
- Never overwrite or delete the source video.

## Success Criteria

1. Source video exists.
2. Snapshot extraction command exits successfully.
3. Snapshot files and `snapshot_manifest.json` are written.
