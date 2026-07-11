---
name: clipsmith-wechat
description: Browser-only automation skill to export a WeChat public account article into a local folder, including article.mhtml, article.md, and all embedded images.
allowed-tools: "Bash(npx:*), Bash(node:*)"
---

# clipsmith-wechat

> **MANDATORY — load `references/plan.md` before any browser or extraction action begins.**

## ⚠️ NEVER WRITE YOUR OWN SCRIPT

**The download logic is fully implemented. Always invoke the existing script — do NOT write a new one.**

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-wechat
npx tsx scripts/run.ts \
  --post_url "<url>" \
  --output_dir "$HOME/Downloads/wechat"
```

The sections below are **implementation documentation for the script itself**, not instructions for you to re-implement. If the script doesn't exist or can't run, report the error — never substitute with hand-written Playwright code.

## Clipsmith Bundle Normalization

The copied downloader produces a raw article folder with `article.md`,
`article.mhtml`, and images. Before finalizing a Clipsmith capture job, convert
that raw folder into a bundle with the shared normalizer:

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith
uv run clipsmith normalize raw wechat "<raw_dir>" "<bundle_dir>" \
  --source-url "<original_url>" \
  --canonical-url "<canonical_url>" \
  --title "<title>" \
  --author "<account_or_author>" \
  --published-at "<publish_date>" \
  --captured-at "<iso8601_time>" \
  --json
uv run clipsmith validate-bundle "<bundle_dir>" --json
```

The normalizer converts `article.md` to bundle `post.md`, creates or copies
`summary.md`, preserves `ocr.md`/`ocr.txt` as `kind: "ocr-text"` if present,
and writes `capture.json`. It intentionally does not copy `article.mhtml` or
downloaded images into the final bundle because the bundle validator does not
allow arbitrary raw assets.

Do not call `uv run clipsmith capture finalize` until `capture.json` exists and
validation succeeds.

## Quality Evaluation

Use the committed eval profile and fixture before changing prompt, extraction,
image, MHTML, or normalization behavior:

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-wechat
node scripts/eval.mjs \
  --fixture wechat-wang-yangming-heart-study \
  --profile wechat-wang-yangming-heart-study
```

When the live article is reachable, validate the raw output folder directly:

```bash
node scripts/eval.mjs \
  --article_dir "/path/to/wechat/output-folder" \
  --profile wechat-wang-yangming-heart-study
```

For user-owned sources, the committed fixture may preserve full captured
evidence, including `article.md`, `post.md`, `article.mhtml`, and images. For
third-party sources, keep fixtures reduced unless permission is explicit. Use
`prompts/normalize-article.md` to create the structured `post.md`, then use
`prompts/evaluate-capture.md` for agent AI eval and compare against the fixture
baseline `evals/ai-evals/wechat-wang-yangming-heart-study.md` when working in
the source repo. Packaged skill installs may omit eval fixtures and baselines.

## Required Constraints

- Use browser automation only (Playwright over CDP).
- Reuse authenticated Chrome session via CDP startup:
  `open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.chrome-labali-no-proxy" --no-proxy-server`
- Extract article content from WeChat DOM: title, account name, author, publish time, content text, images.
- Images are lazy-loaded via `data-src` — always prefer `data-src` over `src`.
- Download only images from `mmbiz.qpic.cn` (skip avatars from `mmbiz.qlogo.cn`).
- Generate raw `article.md` with metadata and image references, then normalize it
  to a structured `post.md` using `prompts/normalize-article.md` before final
  validation or bundle conversion.
- Do not generate a manifest file.

## WeChat Article Structure

WeChat public account articles (`mp.weixin.qq.com/s/...`) use this DOM structure:

- **Title**: `#activity-name` or `.rich_media_title`
- **Account (WeChat Official Account)**: `#js_name` or `.account_nickname_inner`
- **Publish time**: `#publish_time` (format: `YYYY-MM-DD`)
- **Content**: `#js_content` — the main article body
- **Images**: `#js_content img[data-src]` — lazy-loaded content images

WeChat articles are mostly public pages. Login is only required for member-only or private content.

## Anti-Detection Principles

- If a WeChat tab is already open, reuse it — do not open a new tab or navigate away from other tabs.
- After `page.goto()`, wait 1.5–2.5 seconds (randomized) before extracting.
- Do not issue parallel HTTP requests for images — download sequentially with 200–500ms random delays.

## NEVER

- **Never write a custom Playwright/Node.js script** — the existing `scripts/run.ts` handles all extraction.
- **Never launch a new Chrome instance if CDP is already responding on port 9223.**
- **Never take over a non-WeChat browser tab** — find a WeChat tab to reuse, or open a new tab.
- **Never use `src` alone for WeChat image extraction** — WeChat lazy-loads via `data-src`; missing this yields 0 images.
- **Never retry automatically after a login wall** — pause and prompt the user to log in.
- Never report success if `article.md` was not generated.

## Success Criteria

A run is successful only when all conditions hold:

1. An article output folder is created under the specified local directory.
2. Folder naming format is `<download_date>-<sanitized_title>-<article_id>` (title omitted when empty).
3. `article.md` is generated with title, account, publish time, source URL, and image references.
4. `post.md` is generated as the AI-normalized reading version with readable
   headings, paragraphs, bullets, image captions, and source metadata.
5. All `mmbiz.qpic.cn` images from the article content are saved.
6. Partial image failure is acceptable — report failed URLs without throwing.

## Operational Mode

- Startup:
  - Check if CDP is responding: `curl -s http://localhost:9223/json/version`
  - If not → auto-launch Chrome (no user prompt needed), wait 3s, verify
  - If already running → reuse
- Tab management:
  - Find existing WeChat tab → reuse (navigate to article URL)
  - No WeChat tab → open new tab
- If login wall detected → prompt user to log in manually; wait for confirmation

## Resources

| When | Must load |
|------|-----------|
| Always — at skill invocation start | `references/plan.md` |
| Image extraction returns 0 images | Check `data-src` vs `src`; check if page scrolled enough for lazy load |
