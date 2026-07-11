#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVAL_PROFILE="kingson-agent-runtime-skill-ai"
FIXTURE="$ROOT_DIR/evals/fixtures/$EVAL_PROFILE"
EVAL_REPORT="$ROOT_DIR/evals/ai-evals/$EVAL_PROFILE.md"

printf "Running regression checks for %s\n" "$ROOT_DIR"

[[ -f "$ROOT_DIR/scripts/run.ts" ]] || { echo "Missing scripts/run.ts"; exit 1; }
[[ -f "$ROOT_DIR/scripts/eval.mjs" ]] || { echo "Missing scripts/eval.mjs"; exit 1; }
[[ -f "$ROOT_DIR/prompts/extract-article.md" ]] || { echo "Missing prompts/extract-article.md"; exit 1; }
[[ -f "$ROOT_DIR/prompts/evaluate-article.md" ]] || { echo "Missing prompts/evaluate-article.md"; exit 1; }
[[ -f "$ROOT_DIR/evals/web-capture-evals.json" ]] || { echo "Missing evals/web-capture-evals.json"; exit 1; }
[[ -f "$FIXTURE/capture.json" ]] || { echo "Missing fixture capture.json"; exit 1; }
[[ -f "$FIXTURE/post.md" ]] || { echo "Missing fixture post.md"; exit 1; }
[[ -f "$FIXTURE/summary.md" ]] || { echo "Missing fixture summary.md"; exit 1; }
[[ -f "$FIXTURE/raw/source.html" ]] || { echo "Missing fixture raw/source.html"; exit 1; }
[[ -f "$FIXTURE/raw/rendered.txt" ]] || { echo "Missing fixture raw/rendered.txt"; exit 1; }
[[ -f "$FIXTURE/raw/metadata.json" ]] || { echo "Missing fixture raw/metadata.json"; exit 1; }
[[ -f "$EVAL_REPORT" ]] || { echo "Missing web ai-eval baseline"; exit 1; }

rg -n "$EVAL_PROFILE|summary_required_phrases|min_headings|max_line_chars" "$ROOT_DIR/evals/web-capture-evals.json" "$ROOT_DIR/scripts/eval.mjs" >/dev/null
rg -n "site chrome|table of contents|duplicate title|summary.md|capture.json" "$ROOT_DIR/prompts/extract-article.md" "$ROOT_DIR/prompts/evaluate-article.md" >/dev/null
rg -n "verdict: PASS|metadata:|coverage:|structure:|summary:|noise:" "$EVAL_REPORT" >/dev/null

node "$ROOT_DIR/scripts/eval.mjs" --help >/dev/null
node "$ROOT_DIR/scripts/eval.mjs" --bundle_dir "$FIXTURE" --profile "$EVAL_PROFILE" >/dev/null

echo "Regression checks passed"
