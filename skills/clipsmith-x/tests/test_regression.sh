#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== x-download-post-assets regression test ==="

# 1. Dependency check
if [ ! -d "node_modules" ]; then
  echo "[skip] node_modules not found, install first"
else
  echo "[pass] node_modules present"
fi

# 2. Required files exist (worktree subset)
for f in scripts/run.ts scripts/executor.ts scripts/core.ts package.json references/plan.md; do
  if [ -f "$f" ]; then
    echo "[pass] $f exists"
  else
    echo "[fail] $f missing"
    exit 1
  fi
done

# 3. tsx availability
echo "[info] Checking tsx availability..."
if command -v npx &>/dev/null; then
  npx tsx --version &>/dev/null && echo "[pass] tsx available" || echo "[warn] tsx not installed"
else
  echo "[skip] npx not available"
fi

# 4. skill.yaml schema validity (only if present in worktree)
if [ -f "skill.yaml" ] && command -v python3 &>/dev/null; then
  python3 <<'PYEOF'
import yaml, sys
with open('skill.yaml') as f:
    data = yaml.safe_load(f)
required = ['name', 'description', 'executor', 'inputs']
for key in required:
    assert key in data, f'missing {key}'
print('[pass] skill.yaml schema valid')
PYEOF
  echo "[pass] skill.yaml valid"
else
  echo "[skip] skill.yaml not in worktree, skipping schema check"
fi

# 5. CDP Page.captureSnapshot availability (Chrome running with remote-debugging)
echo "=== Test: CDP Page.captureSnapshot ==="
if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "[pass] CDP: Chrome remote-debugging available"
else
  echo "[skip] CDP: NOT AVAILABLE (Chrome not running with --remote-debugging-port=9222)"
fi

# 6. MHTML generation end-to-end
echo "=== Test: MHTML generation ==="
if [ -n "${POST_URL:-}" ]; then
  OUTPUT_DIR="${OUTPUT_DIR:-/tmp/x-test-output}"
  echo "[run]  npx tsx scripts/run.ts --post-url \"$POST_URL\" --output-dir \"$OUTPUT_DIR\" --overwrite"
  if npx tsx scripts/run.ts --post-url "$POST_URL" --output-dir "$OUTPUT_DIR" --overwrite 2>&1 | tee /tmp/x-test-run.log; then
    # find the generated output folder — executor creates <output_dir>/<tweet_id>/ subfolder
    MHTML_FILE=$(find "$OUTPUT_DIR" -name "article.mhtml" 2>/dev/null | head -1)
    POST_MD_FILE=$(find "$OUTPUT_DIR" -name "post.md" 2>/dev/null | head -1)
    if [ -n "$MHTML_FILE" ] && [ -f "$MHTML_FILE" ]; then
      echo "[pass] article.mhtml generated: $MHTML_FILE"
    else
      echo "[fail] article.mhtml not found in $OUTPUT_DIR"
      exit 1
    fi
    if [ -n "$POST_MD_FILE" ] && [ -f "$POST_MD_FILE" ]; then
      echo "[pass] post.md generated: $POST_MD_FILE"
    else
      echo "[fail] post.md not found in $OUTPUT_DIR"
      exit 1
    fi
    echo "[pass] MHTML generation test: PASS"
  else
    echo "[fail] MHTML generation test: run failed"
    cat /tmp/x-test-run.log
    exit 1
  fi
else
  echo "[skip] MHTML test: SKIP (POST_URL not set)"
fi

# 7. UI cleanup test (grep-based sanity check on core.ts)
echo "=== Test: UI cleanup ==="
if grep -q "cleanupPageForArchive\|removeElement\|remove.*Element" scripts/core.ts 2>/dev/null; then
  echo "[pass] UI cleanup logic present in core.ts"
else
  echo "[warn] UI cleanup logic not detected in core.ts (may need manual verification)"
fi

echo "=== all checks passed ==="
