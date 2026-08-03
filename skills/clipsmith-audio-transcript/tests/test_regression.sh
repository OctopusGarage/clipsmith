#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/run.ts"

[[ -f "$ROOT_DIR/SKILL.md" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$ROOT_DIR/agents/openai.yaml" ]] || { echo "Missing agents/openai.yaml"; exit 1; }
[[ -f "$ROOT_DIR/quality-gate.json" ]] || { echo "Missing quality-gate.json"; exit 1; }
[[ -f "$ROOT_DIR/skill.yaml" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$RUNNER" ]] || { echo "Missing scripts/run.ts"; exit 1; }

rg -n "audio-to-text|transcript|transcription command|Do not extract" "$ROOT_DIR/agents/openai.yaml" "$ROOT_DIR/SKILL.md" >/dev/null
rg -n "audio_path|transcript_cmd|output_dir" "$ROOT_DIR/skill.yaml" >/dev/null
rg -n -- "--audio_path|--transcript_cmd|transcript.txt|transcript.md" "$RUNNER" >/dev/null
npx tsx "$RUNNER" --help >/dev/null
(npx tsx "$RUNNER" --audio_path "https://example.com/audio.m4a" --transcript_cmd "echo should-not-run" 2>&1 || true) \
  | rg "only accepts local audio file paths" >/dev/null
(npx tsx "$RUNNER" --audio_path "$ROOT_DIR/missing.m4a" --transcript_cmd "echo should-not-run" 2>&1 || true) \
  | rg "Audio file not found" >/dev/null

echo "Regression checks passed"
