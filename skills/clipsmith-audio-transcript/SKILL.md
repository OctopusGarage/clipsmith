---
name: clipsmith-audio-transcript
description: Convert a local audio file to text by running an explicit local transcription command. Use after extracting audio from video.
---

# Clipsmith Audio Transcript

Transcribe a local audio file by invoking a caller-provided local command. This
skill does not extract audio from video, create snapshots, run OCR, or write
capture bundles.

## Execution

```bash
cd <clipsmith-repo>/skills/clipsmith-audio-transcript
npx tsx scripts/run.ts \
  --audio_path "/path/to/audio.m4a" \
  --output_dir "$HOME/Downloads/clipsmith-audio-transcript" \
  --transcript_cmd "whisper {audio} --output_format txt --output_dir {output_dir}"
```

The command template may use:

- `{audio}`: absolute audio path
- `{output_dir}`: output directory
- `{output_text}`: expected text output path

If the command writes stdout but does not create `{output_text}`, stdout is saved
to `transcript.txt`.

## Constraints

- Accept local audio paths only.
- Require an explicit transcription command.
- Do not call network APIs or hardcode a provider SDK.
- Do not modify the source audio file.

## Success Criteria

1. Source audio exists.
2. Transcription command exits with status 0.
3. `transcript.txt` and `transcript.md` are written.
