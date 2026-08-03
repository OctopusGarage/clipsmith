#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/run.ts"

[[ -f "$ROOT_DIR/SKILL.md" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$ROOT_DIR/agents/openai.yaml" ]] || { echo "Missing agents/openai.yaml"; exit 1; }
[[ -f "$ROOT_DIR/quality-gate.json" ]] || { echo "Missing quality-gate.json"; exit 1; }
[[ -f "$ROOT_DIR/skill.yaml" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$RUNNER" ]] || { echo "Missing scripts/run.ts"; exit 1; }

rg -n "ffmpeg|ffprobe|audio|Never overwrite" "$ROOT_DIR/SKILL.md" >/dev/null
rg -n "video_path|audio_format|output_dir" "$ROOT_DIR/skill.yaml" >/dev/null
rg -n -- "--video_path|--audio_format|ffprobe|ffmpeg|audio.m4a" "$RUNNER" >/dev/null
npx tsx "$RUNNER" --help >/dev/null
(npx tsx "$RUNNER" --video_path "https://example.com/video.mp4" 2>&1 || true) \
  | rg "only accepts local video file paths" >/dev/null
(npx tsx "$RUNNER" --video_path "$ROOT_DIR/missing.mp4" 2>&1 || true) \
  | rg "Video file not found" >/dev/null

echo "Regression checks passed"
