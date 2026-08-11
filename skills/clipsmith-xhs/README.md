# clipsmith-xhs

Capture Xiaohongshu (XHS) posts into a local folder using the user's
authenticated Chrome CDP session.

## Quick Start

```bash
cd <clipsmith-repo>/skills/clipsmith-xhs
npx tsx scripts/run.ts \
  --post_url "https://www.xiaohongshu.com/explore/<note_id>?xsec_token=..." \
  --output_dir "/absolute/output/dir"
```

Short links from `xhslink.cn` and `xhslink.com` are supported. Keep the original
query parameters for navigation; the output URL is normalized to
`https://www.xiaohongshu.com/explore/<note_id>`.

If `post_url` or `output_dir` is omitted, the runner prompts interactively.

## Output

The raw capture directory contains:

- `post.md`
- downloaded post images
- `ocr.md` generated from post images
- downloaded post video when available
- optional `comments/comments.json` and `comments/comments.md`
- no `manifest.json`

When `--flat true` is not set, the runner creates a dated post subdirectory.
When `--flat true` is set, it writes directly into `--output_dir`.

## Options

| Flag | Default | Notes |
|------|---------|-------|
| `--profile_dir` | `~/.chrome-labali-no-proxy` | Chrome user-data-dir |
| `--cdp_port` | `9223` | Chrome DevTools port |
| `--proxy_mode` | `none` | `none`, `system`, or `custom` |
| `--proxy_server` | unset | Required when `proxy_mode=custom` |
| `--close_browser_on_success` | `false` | Close the connected CDP Chrome only after a fully successful capture |
| `--timeout_ms` | `90000` | Navigation and extraction timeout |
| `--overwrite` | `false` | Replace generated files with the same names |
| `--include_comments` | `false` | Best-effort comment export |
| `--flat` | `false` | Write directly into `output_dir` |

Use `--close_browser_on_success true` only when the CDP Chrome is dedicated to
automation. Failed or partial captures leave Chrome open for inspection.

## Browser Model

XHS uses the shared Clipsmith browser runtime for CDP startup, proxy flags, port
probing, and optional shutdown. The provider-specific code owns XHS navigation,
risk checks, carousel ordering, media download, OCR, and comments.

Default startup:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/.chrome-labali-no-proxy" \
  --no-proxy-server
```

The runner reuses an existing XHS tab when possible. If no XHS tab exists, it
opens one in the same CDP browser.

## Normalize and Validate

For a final Clipsmith bundle:

```bash
uv run clipsmith normalize raw xhs "<raw_dir>" "<bundle_dir>" \
  --source-url "<original_url>" \
  --canonical-url "<canonical_url>" \
  --title "<title>" \
  --captured-at "<iso8601_time>" \
  --json

uv run clipsmith validate-bundle "<bundle_dir>" --json
```

Use `--overwrite` with `normalize raw` when normalizing in place.

## Reliability Notes

- XHS access depends on login state, URL tokens, IP reputation, and platform risk controls.
- Comment export is best-effort and may miss replies, images, or hierarchy.
- Video segment merge requires `ffmpeg`.
- If media is empty, retry with the original full share URL including tokens.
- If a hard risk signal appears, stop and inspect the browser manually.

## Source-Repo Checks

Before reporting provider changes ready:

```bash
bash tests/test_regression.sh
node scripts/eval.mjs \
  --fixture xhs-skill-long-term-asset \
  --profile xhs-skill-long-term-asset
```

Run the fresh OCR eval when OCR behavior changes:

```bash
node scripts/eval.mjs \
  --fixture xhs-skill-long-term-asset \
  --profile xhs-skill-long-term-asset \
  --run_ocr
```
