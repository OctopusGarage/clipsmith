#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$ROOT_DIR/scripts"
RUNNER="$SCRIPTS_DIR/run.ts"
EXECUTOR="$SCRIPTS_DIR/executor.ts"
CORE="$SCRIPTS_DIR/core.ts"
OCR="$SCRIPTS_DIR/ocr.ts"
EVAL="$SCRIPTS_DIR/eval.mjs"
ARCH="$ROOT_DIR/references/architecture.md"
PLAN="$ROOT_DIR/references/plan.md"
SKILL_MD="$ROOT_DIR/SKILL.md"
SKILL_YAML="$ROOT_DIR/skill.yaml"
EVALS="$ROOT_DIR/evals/xhs-capture-evals.json"
EVAL_PROMPT="$ROOT_DIR/prompts/evaluate-capture.md"
EVAL_FIXTURE="$ROOT_DIR/evals/fixtures/xhs-skill-long-term-asset"
EVAL_REPORT="$ROOT_DIR/evals/ai-evals/xhs-skill-long-term-asset.md"

printf "Running regression checks for %s\n" "$ROOT_DIR"

[[ -f "$RUNNER" ]] || { echo "Missing run.ts"; exit 1; }
[[ -f "$EXECUTOR" ]] || { echo "Missing executor.ts"; exit 1; }
[[ -f "$CORE" ]] || { echo "Missing core.ts"; exit 1; }
[[ -f "$OCR" ]] || { echo "Missing ocr.ts"; exit 1; }
[[ -f "$EVAL" ]] || { echo "Missing eval.mjs"; exit 1; }
[[ -f "$ARCH" ]] || { echo "Missing references/architecture.md"; exit 1; }
[[ -f "$PLAN" ]] || { echo "Missing references/plan.md"; exit 1; }
[[ -f "$SKILL_MD" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$SKILL_YAML" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$EVALS" ]] || { echo "Missing evals/xhs-capture-evals.json"; exit 1; }
[[ -f "$EVAL_PROMPT" ]] || { echo "Missing prompts/evaluate-capture.md"; exit 1; }
[[ -f "$EVAL_FIXTURE/images/001.webp" ]] || { echo "Missing XHS fixture image 001.webp"; exit 1; }
[[ -f "$EVAL_FIXTURE/images/002.webp" ]] || { echo "Missing XHS fixture image 002.webp"; exit 1; }
[[ -f "$EVAL_FIXTURE/post.md" ]] || { echo "Missing XHS fixture post.md"; exit 1; }
[[ -f "$EVAL_FIXTURE/ocr.md" ]] || { echo "Missing XHS fixture ocr.md"; exit 1; }
[[ -f "$EVAL_REPORT" ]] || { echo "Missing XHS ai-eval baseline"; exit 1; }

rg -n "Layer Contract|Success Criteria|Operational Mode" "$SKILL_MD" >/dev/null
rg -n "Layered Boundaries|Execution Model|Download Correctness Standards" "$ARCH" >/dev/null
rg -n "manual login|post.md|interactively|home page|remote-debugging-port=9223|chrome-labali-no-proxy|no-proxy-server|explore/<note_id>|video|merge" "$PLAN" "$SKILL_MD" "$EXECUTOR" "$CORE" >/dev/null

rg -n -- "--post_url|--output_dir|--profile_dir|--cdp_port|--timeout_ms|--overwrite|--include_comments" "$RUNNER" >/dev/null
rg -n "请输入小红书帖子链接|请输入本地保存目录" "$EXECUTOR" >/dev/null
rg -n "connectOverCDP|ensureChromeWithRemoteDebugging|waitForManualLogin|downloadImages|downloadVideos|collectCommentImageUrls|mergeVideosAndCleanup|writePostMarkdown|writeImageOcrMarkdown|extractPostComments|writeCommentsJson|writeCommentsMarkdown|canonicalizePostUrl|normalizePublishTime|xiaohongshu.com" "$EXECUTOR" "$CORE" "$OCR" >/dev/null
rg -n "xhs-skill-long-term-asset|expected_note_id|required_ocr_phrases|forbid_summary" "$EVALS" "$EVAL" >/dev/null
rg -n "ocr.md|run_ocr|Do not pass|fixture" "$EVAL_PROMPT" >/dev/null
rg -n "verdict: PASS|metadata:|media:|ocr:|content:|noise:" "$EVAL_REPORT" >/dev/null
node "$EVAL" --help >/dev/null
node "$EVAL" --fixture xhs-skill-long-term-asset --profile xhs-skill-long-term-asset >/dev/null
npx tsx "$OCR" --help >/dev/null
if [[ "$(uname -s)" == "Darwin" ]]; then
  node "$EVAL" --fixture xhs-skill-long-term-asset --profile xhs-skill-long-term-asset --run_ocr >/dev/null
fi
npx tsx --test "$ROOT_DIR/tests/ocr.test.ts"

echo "Regression checks passed"
