#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/run.ts"

[[ -f "$ROOT_DIR/SKILL.md" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$ROOT_DIR/agents/openai.yaml" ]] || { echo "Missing agents/openai.yaml"; exit 1; }
[[ -f "$ROOT_DIR/quality-gate.json" ]] || { echo "Missing quality-gate.json"; exit 1; }
[[ -f "$ROOT_DIR/skill.yaml" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$RUNNER" ]] || { echo "Missing scripts/run.ts"; exit 1; }

rg -n "ffmpeg|ffprobe|exiftool|metadata-only|watermark-resistant" "$ROOT_DIR/SKILL.md" >/dev/null
rg -n "input_video|output_video|mode|strict" "$ROOT_DIR/skill.yaml" >/dev/null
rg -n -- "--input_video|--output_video|metadata_report|ffprobe|ffmpeg|watermark-resistant" "$RUNNER" >/dev/null
npx tsx "$RUNNER" --help >/dev/null
(npx tsx "$RUNNER" --input_video "https://example.com/video.mp4" --output_video "/tmp/out.mp4" 2>&1 || true) \
  | rg "only accepts local video file paths" >/dev/null
(npx tsx "$RUNNER" --input_video "$ROOT_DIR/missing.mp4" --output_video "/tmp/out.mp4" 2>&1 || true) \
  | rg "Video file not found" >/dev/null

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
ffmpeg -hide_banner -y \
  -f lavfi -i testsrc=size=32x32:rate=5 \
  -f lavfi -i sine=frequency=1000:duration=1 \
  -t 1 -pix_fmt yuv420p "$tmp_dir/input.mp4" >/dev/null 2>&1
npx tsx "$RUNNER" --input_video "$tmp_dir/input.mp4" --output_video "$tmp_dir/output.mp4" >/dev/null
[[ -f "$tmp_dir/output.mp4" ]] || { echo "Missing sanitized output"; exit 1; }
[[ -f "$tmp_dir/metadata_report.json" ]] || { echo "Missing metadata report"; exit 1; }
rg '"sensitive_metadata_scan"' "$tmp_dir/metadata_report.json" >/dev/null

echo "Regression checks passed"
