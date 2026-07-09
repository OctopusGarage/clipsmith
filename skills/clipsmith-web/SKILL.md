---
name: clipsmith-web
description: Capture a generic web article into a Clipsmith bundle using browser or fetch-based extraction available to the agent.
---

# Clipsmith Web Capture

Use this skill for generic web pages when no platform-specific Clipsmith skill
matches.

Run the bundled generic extractor first:

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-web
npx tsx scripts/run.ts \
  --url "<url>" \
  --output_dir "$HOME/Downloads/clipsmith-web"
```

The script creates a bundle directory containing:

- `capture.json`
- `post.md`
- `summary.md`

`capture.json` must use schema `clipsmith.capture_bundle.v1`, platform `web`,
the source URL, relative content file references, an empty `assets` array,
warnings, and status. Final bundles may contain only `capture.json`, `post.md`,
`summary.md`, optional `ocr.md`/`ocr.txt` when OCR text was produced, plus
separate OCR image files for image OCR captures. If OCR ran at any point, write
the raw OCR transcript to `ocr.md` or `ocr.txt` and declare it in
`capture.json.content_files` with `kind: "ocr-text"`; do not store OCR text only
inside `summary.md`.

Before reporting success, run:

```bash
clipsmith validate-bundle "<bundle_dir>" --json
```

Do not write knowledge records. If the page is login-gated, rate-limited, or
blocked by bot protection, stop and report the condition instead of fabricating
content.
