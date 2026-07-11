#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$ROOT_DIR/scripts"
RUNNER="$SCRIPTS_DIR/run.ts"
EXECUTOR="$SCRIPTS_DIR/executor.ts"
CORE="$SCRIPTS_DIR/core.ts"
EVAL="$SCRIPTS_DIR/eval.mjs"
PLAN="$ROOT_DIR/references/plan.md"
SKILL_MD="$ROOT_DIR/SKILL.md"
SKILL_YAML="$ROOT_DIR/skill.yaml"
EVALS="$ROOT_DIR/evals/wechat-capture-evals.json"
EVAL_PROMPT="$ROOT_DIR/prompts/evaluate-capture.md"
NORMALIZE_PROMPT="$ROOT_DIR/prompts/normalize-article.md"
EVAL_PROFILE="wechat-wang-yangming-heart-study"
EVAL_FIXTURE="$ROOT_DIR/evals/fixtures/$EVAL_PROFILE"
EVAL_REPORT="$ROOT_DIR/evals/ai-evals/$EVAL_PROFILE.md"

printf "Running regression checks for %s\n" "$ROOT_DIR"

[[ -f "$RUNNER" ]] || { echo "Missing run.ts"; exit 1; }
[[ -f "$EXECUTOR" ]] || { echo "Missing executor.ts"; exit 1; }
[[ -f "$CORE" ]] || { echo "Missing core.ts"; exit 1; }
[[ -f "$EVAL" ]] || { echo "Missing eval.mjs"; exit 1; }
[[ -f "$PLAN" ]] || { echo "Missing references/plan.md"; exit 1; }
[[ -f "$SKILL_MD" ]] || { echo "Missing SKILL.md"; exit 1; }
[[ -f "$SKILL_YAML" ]] || { echo "Missing skill.yaml"; exit 1; }
[[ -f "$EVALS" ]] || { echo "Missing evals/wechat-capture-evals.json"; exit 1; }
[[ -f "$EVAL_PROMPT" ]] || { echo "Missing prompts/evaluate-capture.md"; exit 1; }
[[ -f "$NORMALIZE_PROMPT" ]] || { echo "Missing prompts/normalize-article.md"; exit 1; }
[[ -f "$EVAL_FIXTURE/article.md" ]] || { echo "Missing WeChat fixture article.md"; exit 1; }
[[ -f "$EVAL_FIXTURE/post.md" ]] || { echo "Missing WeChat fixture post.md"; exit 1; }
[[ -f "$EVAL_FIXTURE/article.mhtml" ]] || { echo "Missing WeChat fixture article.mhtml"; exit 1; }
[[ -f "$EVAL_FIXTURE/image_01.jpeg" ]] || { echo "Missing WeChat fixture image placeholder"; exit 1; }
[[ -f "$EVAL_REPORT" ]] || { echo "Missing WeChat ai-eval baseline"; exit 1; }

rg -n "MANDATORY|NEVER WRITE YOUR OWN SCRIPT|Quality Evaluation|Success Criteria" "$SKILL_MD" >/dev/null
rg -n "data-src|mmbiz.qpic.cn|article.md|article.mhtml|manual login" "$PLAN" "$SKILL_MD" "$CORE" "$EXECUTOR" >/dev/null
rg -n -- "--post_url|--output_dir|--cdp_port|--profile_dir|--timeout_ms|--overwrite" "$RUNNER" >/dev/null
rg -n "connectOverCDP|extractArticleSnapshot|downloadImages|triggerLazyImages|captureMhtml|writeArticleMarkdown|mp.weixin.qq.com" "$EXECUTOR" "$CORE" >/dev/null
rg -n "$EVAL_PROFILE|expected_article_id|required_phrases|fixture_min_article_chars|require_normalized_post|min_normalized_headings|max_normalized_line_chars" "$EVALS" "$EVAL" >/dev/null
rg -n "article.md|post.md|article.mhtml|deterministic eval|Do not pass|fixture" "$EVAL_PROMPT" >/dev/null
rg -n "article.md|post.md|preserve|headings|Do not summarize away" "$NORMALIZE_PROMPT" >/dev/null
rg -n "verdict: PASS|metadata:|media:|article:|mhtml:|noise:" "$EVAL_REPORT" >/dev/null
node "$EVAL" --help >/dev/null
node "$EVAL" --fixture "$EVAL_PROFILE" --profile "$EVAL_PROFILE" >/dev/null

echo "Regression checks passed"
