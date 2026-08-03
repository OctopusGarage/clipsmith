---
name: clipsmith-video-audio
description: Extract an audio sidecar from a local video file with ffmpeg. Use when you need the voice/audio track from a video before transcription.
---

# Clipsmith Video Audio

Extract one audio file from a local video. This skill does not transcribe audio,
create snapshots, run OCR, or write capture bundles.

## Execution

```bash
cd <clipsmith-repo>/skills/clipsmith-video-audio
npx tsx scripts/run.ts \
  --video_path "/path/to/video.mp4" \
  --output_dir "$HOME/Downloads/clipsmith-video-audio" \
  --audio_format m4a
```

Output:

- `audio.m4a` by default, or `audio.wav` with `--audio_format wav`
- `metadata.json` with `ffprobe` evidence

## Constraints

- Accept local video paths only.
- Use `ffprobe` to verify that an audio stream exists.
- Use `ffmpeg` for extraction.
- Never overwrite or delete the source video.
- If there is no audio stream, fail with a clear error.

## Success Criteria

1. Source video exists.
2. `ffprobe` detects at least one audio stream.
3. Audio output file is written.
4. `metadata.json` is written.
