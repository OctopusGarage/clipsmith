#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/run.ts"

[[ -f "$ROOT_DIR/SKILL.md" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$ROOT_DIR/agents/openai.yaml" ]] || { echo "Missing agents/openai.yaml"; exit 1; }
[[ -f "$ROOT_DIR/quality-gate.json" ]] || { echo "Missing quality-gate.json"; exit 1; }
[[ -f "$ROOT_DIR/skill.yaml" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$RUNNER" ]] || { echo "Missing scripts/run.ts"; exit 1; }

rg -n "magick|exiftool|hidden metadata|visible" "$ROOT_DIR/SKILL.md" >/dev/null
rg -n "input_image|output_image|strict" "$ROOT_DIR/skill.yaml" >/dev/null
rg -n -- "--input_image|--output_image|metadata_report|exiftool|magick" "$RUNNER" >/dev/null
npx tsx "$RUNNER" --help >/dev/null
(npx tsx "$RUNNER" --input_image "https://example.com/image.jpg" --output_image "/tmp/out.jpg" 2>&1 || true) \
  | rg "only accepts local image file paths" >/dev/null
(npx tsx "$RUNNER" --input_image "$ROOT_DIR/missing.jpg" --output_image "/tmp/out.jpg" 2>&1 || true) \
  | rg "Image file not found" >/dev/null

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
magick -size 16x16 xc:white "$tmp_dir/input.jpg"
npx tsx "$RUNNER" --input_image "$tmp_dir/input.jpg" --output_image "$tmp_dir/output.jpg" >/dev/null
[[ -f "$tmp_dir/output.jpg" ]] || { echo "Missing sanitized output"; exit 1; }
[[ -f "$tmp_dir/metadata_report.json" ]] || { echo "Missing metadata report"; exit 1; }
rg '"sensitive_metadata_scan"' "$tmp_dir/metadata_report.json" >/dev/null

echo "Regression checks passed"
