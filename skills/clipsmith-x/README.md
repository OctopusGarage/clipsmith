# clipsmith-x

Browser-automation skill to download X (Twitter) post assets — text, images, and video — to a local folder.

## Quick Start

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-x
npx tsx scripts/run.ts \
  --post-url "https://x.com/<user>/status/<tweet_id>" \
  --output-dir "~/Downloads/x"
```

## Features

- **Text**: Extracts author, timestamp, and full tweet text into `post.md`; t.co shortlinks are automatically expanded to full URLs
- **Images**: Downloads all post images with deduplication
- **Video**: Downloads post video when present
- **Browser reuse**: Uses your existing authenticated Chrome session via CDP

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--post-url` | prompt | Full x.com post URL |
| `--output-dir` | `~/Downloads/x` | Target folder |
| `--profile-dir` | `~/.chrome-labali` | Chrome profile |
| `--cdp-port` | `9222` | Chrome DevTools port |
| `--timeout-ms` | `90000` | Navigation timeout |
| `--overwrite` | `false` | Overwrite existing files |

## Requirements

- macOS or Linux
- Chrome with remote debugging enabled on port 9222
- Node.js ≥ 20
- pnpm

## Setup

Chrome must be open with remote debugging. One-time setup:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-labali" \
  --no-proxy-server
```

Then log into x.com in that Chrome window.
