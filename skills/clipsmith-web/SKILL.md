---
name: clipsmith-web
description: Capture a generic web article into a Clipsmith bundle using browser or fetch-based extraction available to the agent.
---

# Clipsmith Web Capture

Use this skill for generic web pages when no platform-specific Clipsmith skill
matches.

Run the bundled browser extractor first:

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-web
npx tsx scripts/run.ts \
  --url "<url>" \
  --output_dir "$HOME/Downloads/clipsmith-web"
```

Use `--preserve_full_raw` only when debugging a difficult capture or when the
user explicitly asks for a fuller raw archive. The default output intentionally
keeps raw evidence small.

The script creates a draft bundle directory containing:

- `capture.json`
- `post.md`
- `summary.md`
- `raw/source.html`
- `raw/rendered.txt`
- `raw/metadata.json`

## AI Normalization Step

After the script finishes, read `prompts/extract-article.md`, then inspect the
bundle's `raw/source.html`, `raw/rendered.txt`, and `raw/metadata.json`.

Use the current AI session to rewrite `post.md` into clean, complete article
Markdown:

- remove site chrome, navigation, cookie banners, newsletter prompts, related
  links, social sharing labels, and footer text
- preserve the full article body in order
- preserve article headings, lists, quotes, code blocks, tables, and meaningful
  links
- improve `title`, `canonical_url`, `author`, and `published_at` in
  `capture.json` only when the raw evidence supports the change
- keep raw audit files declared in `capture.json.assets`

Do not invent article text. If the raw files contain only a bot challenge, login
wall, error page, or a short/ambiguous fragment, keep the bundle partial or stop
and report the condition instead of fabricating content.

## Eval Step

After normalization, run the bundle validator and the local web capture eval when
the URL matches a known profile:

```bash
uv run clipsmith validate-bundle "<bundle_dir>" --json
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-web
node scripts/eval.mjs --bundle_dir "<bundle_dir>" --profile "<profile>"
```

Known profiles:

- `anthropic-building-effective-agents` for
  `https://www.anthropic.com/engineering/building-effective-agents`
- `openai-core-dump-epidemiology` for
  `https://openai.com/index/core-dump-epidemiology-data-infrastructure-bug/`

For URLs without a matching deterministic profile, still read
`prompts/evaluate-article.md` and perform the AI eval checklist against
`post.md`, `summary.md`, `capture.json`, `raw/rendered.txt`, and
`raw/metadata.json`. Do not report a bundle ready if validator fails, local eval
fails, or AI eval finds missing article sections, unsupported metadata, or
remaining page chrome.

When maintaining this skill or adding another article-like provider, also follow
the repository-level guardrail in `docs/web-capture-ai-eval.md`. The final
response must include its required `Web capture AI eval: PASS|FAIL` report when
that guardrail applies.

## Bundle Contract

`capture.json` must use schema `clipsmith.capture_bundle.v1`, platform `web`,
the source URL, relative content file references, declared raw audit assets,
warnings, and status. Final web bundles may contain only:

- `capture.json`
- `post.md`
- `summary.md`
- `raw/source.html`
- `raw/rendered.txt`
- `raw/metadata.json`
- optional `raw/source.full.html.gz`
- optional `raw/page.mhtml`
- optional `ocr.md`/`ocr.txt` when OCR text was produced
- separate OCR image files for image OCR captures

If OCR ran at any point, write the raw OCR transcript to `ocr.md` or `ocr.txt`
and declare it in `capture.json.content_files` with `kind: "ocr-text"`; do not
store OCR text only inside `summary.md`.

Before reporting success, always run:

```bash
uv run clipsmith validate-bundle "<bundle_dir>" --json
```

Do not write knowledge records. If the page is login-gated, rate-limited, or
blocked by bot protection, stop and report the condition instead of fabricating
content.
