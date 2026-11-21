---
name: clipsmith-web
description: Capture a generic web article into a Clipsmith bundle using browser or fetch-based extraction available to the agent.
---

# Clipsmith Web Capture

Use this skill for generic web pages when no platform-specific Clipsmith skill
matches.

Check the skill's runtime and browser mode before capture:

```bash
cd <clipsmith-repo>/skills/clipsmith-web
npx --no-install tsx scripts/browser.ts get
npx --no-install tsx scripts/browser.ts check
```

If the runtime is missing, run `npm ci` once in this skill directory before
retrying. Do not reinstall dependencies during active captures.

`check` verifies that Playwright and the configured browser are reachable. Missing
runtime dependencies are a local setup failure, not a website challenge.

For an existing normal Chrome remote-debugging session, explicitly configure its
loopback endpoint (use the port of the session actually available):

```bash
npx tsx scripts/browser.ts set http://127.0.0.1:9222
```

The command saves a non-secret browser preference under the user configuration
directory. `get` inspects it and `reset` restores the headless default. An explicit
`CLIPSMITH_WEB_CDP_URL` overrides the saved endpoint. Do not guess a port, reuse
an unrelated browser, inspect cookies, or print browser credentials. CDP mode uses
the existing context and its browser identity. Successful operations close their
own tab and disconnect without stopping Chrome. Normal Chrome is allowed a bounded wait for automatic verification to finish.
A remaining verification challenge leaves that tab open for inspection and interaction before retrying. A configured but unavailable endpoint
fails visibly rather than silently changing browser mode.

Then run the bundled browser extractor:

```bash
cd <clipsmith-repo>/skills/clipsmith-web
npx tsx scripts/run.ts \
  --url "<url>" \
  --output_dir "$HOME/Downloads/clipsmith-web"
```

The extractor prefers explicit article-body and TOC-content containers so related-link sidebars
cannot truncate the body. Text shorter than 500 characters is marked `partial`
for review. A challenge in an isolated headless browser does not prove that normal
Chrome is blocked. Inspect the same URL in the available normal browser; if it
opens successfully, configure CDP and retry capture and discovery. If the actual
normal-browser page asks for verification, interact with that visible page using
available browser tools. Report a manual blocker only after inspecting the real
page and verifying that agent interaction cannot complete it. Do not retry the
same isolated headless session and call that a normal-browser check.

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
cd <clipsmith-repo>/skills/clipsmith-web
node scripts/eval.mjs --bundle_dir "<bundle_dir>" --profile "<profile>"
```

Known profiles:

- `anthropic-building-effective-agents` for
  `https://www.anthropic.com/engineering/building-effective-agents`
- `openai-core-dump-epidemiology` for
  `https://openai.com/index/core-dump-epidemiology-data-infrastructure-bug/`
- `kingson-agent-runtime-skill-ai` for
  `https://kingson4wu.github.io/zh/posts/20260328-agent-agent-runtime-skill-ai/`

The `kingson-agent-runtime-skill-ai` profile is a user-owned fixture that guards
Chinese article cleanup, heading preservation, table formatting, summary
quality, and removal of blog chrome such as tags, share controls, and repeated
table-of-contents text.

For URLs without a matching deterministic profile, still read
`prompts/evaluate-article.md` and perform the AI eval checklist against
`post.md`, `summary.md`, `capture.json`, `raw/rendered.txt`, and
`raw/metadata.json`. Do not report a bundle ready if validator fails, local eval
fails, or AI eval finds missing article sections, unsupported metadata, or
remaining page chrome.

When maintaining this skill or adding another article-like provider, also follow
the guardrail in `prompts/evaluate-article.md` and compare known profiles with
the source-repo baselines in `evals/ai-evals/` when they are present. Packaged
skill installs may omit eval fixtures and baselines. The final response must
include its required `Web capture AI eval: PASS|FAIL` report when that guardrail
applies.

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

Do not write knowledge records. If the configured normal-browser page remains
login-gated, rate-limited, or blocked after the inspection and interaction above,
preserve the evidence and report that specific remaining condition. Never
fabricate content or infer a normal-browser blocker from headless failure alone.


For source maintenance, install locked dependencies with `npm ci`, install
Chromium with `npx playwright install chromium` when absent, and run `npm test`.
Local HTTP fixtures cover body extraction, partial bundles, and verification
challenge diagnostics without contacting external websites.


Blog discovery uses the same browser preference and lifecycle:

```bash
npx tsx scripts/discover.ts "https://example.com/blog" "/posts/"
```

It returns JSON article candidates from the main content, excluding navigation.
Alcove delegates browser discovery here rather than maintaining a separate
browser session strategy. A new skill installation needs `npm ci` in its own
skill directory; copying skill files intentionally omits `node_modules`.
