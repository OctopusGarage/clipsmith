---
name: clipsmith-x
description: >-
  Download X (Twitter) post assets — text, images, video — to a local folder
  using browser automation with manual-login session reuse. Use when downloading
  an X post, saving post images, exporting post content, or archiving a tweet.
  Trigger phrases: "download x post", "save tweet", "x post images",
  "x video download", "twitter post assets".
license: MIT
allowed-tools: "Bash(npx:*), Bash(pnpm:*)"
metadata:
  pattern: pipeline
  compatibility: "macOS / Linux; requires Chrome with remote-debugging enabled (port 9222), profile ~/.chrome-labali, and authenticated X session; Node.js ≥ 20 + tsx"
---

# clipsmith-x

> **MANDATORY — load `references/plan.md` before any browser or extraction action begins.**

## ⚠️ NEVER WRITE YOUR OWN SCRIPT

**The download logic is fully implemented. Always invoke the existing script — do NOT write a new one.**

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-x
npx tsx scripts/run.ts \
  --post-url "<url>" \
  --output-dir "$HOME/Downloads/x"
```

The sections below (image extraction, anti-detection, MHTML generation) are **implementation documentation for the script itself**, not instructions for you to re-implement. If the script doesn't exist or can't run, report the error — never substitute with hand-written Playwright code.

## Clipsmith Bundle Normalization

The copied downloader produces a raw post folder with `post.md`, images, optional
video, and optional MHTML. Before finalizing a Clipsmith capture job, run the
`raw-output-to-capture.json` normalization step by converting that raw folder
into a bundle:

1. Keep `post.md` and downloaded assets in the bundle directory.
2. Create `summary.md` from the captured post text.
3. Write `capture.json` with schema `clipsmith.capture_bundle.v1`, platform
   `x`, source/canonical URL, title/author/published metadata when available,
   `content_files` entries for `summary.md` and `post.md`, asset entries for
   downloaded media/MHTML, warnings, and status.
4. Run `clipsmith validate-bundle "<bundle_dir>" --json`.

Do not call `clipsmith capture finalize` until `capture.json` exists and
validation succeeds.

### URL Expansion (t.co Shortlinks)

Tweet links render as t.co shortlinks (e.g., `https://t.co/yr4YXZ6SgU`) — both in `href` attributes and `textContent`. **post.md must output the full resolved URL** (e.g., `https://github.com/anthropics/skills/tree/main/skills/pptx`).

Because Twitter's Content Security Policy (CSP) blocks cross-origin `fetch()` inside `page.evaluate()`, URL expansion must be done in Node.js:

1. Collect all `<a>` element `href` attributes inside `page.evaluate()`
2. Call `fetch(href, { redirect: "follow" })` on `https://t.co/*` links from Node.js to get the final URL
3. Replace each anchor's `textContent` with the resolved URL, then extract full text

This step is integrated into `extractTweetSnapshot()` and **must not be skipped**.

## Required Constraints

- Use browser automation only.
- Do not use X private APIs.
- Reuse manual-login session via unified Chrome CDP startup:
  `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-labali" --no-proxy-server`.
- Prefer semantic extraction from visible page state and loaded resources.
- Download only target post assets: images plus optional post video.
- Generate `post.md` for extracted text metadata.
- Do not generate `manifest.json`.
- Preserve all query parameters for page navigation.

## Anti-Detection Principles

X applies behavioral analysis to detect automation. Violations of these principles may result in account restrictions.

**Core test — apply before every browser action:**
> "Would a real user do this, from this state, at this moment?"
> If no → skip it or slow it down. Re-navigating an already-open post, batch-extracting DOM nodes, issuing fresh HTTP requests for images the browser just loaded, using fixed delays — all fail this test.

**Navigation:**
- If the tab is already on the target post URL, skip `page.goto()` entirely.
- All fixed `waitForTimeout` values must be randomized (e.g., `base + Math.random() * range`).
- After navigating to a post, scroll down briefly to simulate reading, then scroll back up before interacting with images.

**Image acquisition:**
- Never issue new HTTP requests for images — the browser has already downloaded them.
- **Register `page.on("response")` BEFORE calling `page.goto()`** — images load during navigation.
- **Primary image source: DOM extraction from `[data-testid="tweetPhoto"]`** — handles both `<img>` elements (regular tweets) and CSS `background-image` divs (X Notes).
- Fetch each URL via `fetch(url, {cache: 'force-cache'})` in `page.evaluate()`.
- After download: deduplicate by SHA-256 content hash; remove files < 40% of median size.

**MHTML Generation (CDP Page.captureSnapshot):**
- Calls Chrome's built-in `Page.captureSnapshot` command via Playwright CDPSession to generate standard MHTML
- Before archiving, automatically removes UI elements unrelated to post content (login buttons, nav bars, recommended content, etc.)
- `cleanupPageForArchive` removes: LoginForm, signup links, banner nav, sidebarColumn, app-bar, etc.
- Text-only tweets (no images/video) skip MHTML and only generate `post.md`
- X Notes and posts with images/video generate `article.mhtml` + `post.md`

**Video:**
- Before downloading, simulate user engagement: bring the tab to front, click the video element, wait 3–5 seconds (randomized) for buffering.
- Video download uses `page.request.get()`.

**General:**
- Always operate within the user's authenticated Chrome session (CDP reuse) — never launch a headless or separate browser.
- Never manipulate the DOM beyond what a user's own browser JS would do.

## NEVER

- Never launch a new Chrome if CDP is already responding on port 9222.
- Never hijack a non-X browser tab — reuse X tab or open a new X tab.
- Never strip query params from post URL before navigating.
- Never use fixed (non-randomized) delays.
- Never retry after CAPTCHA or rate-limit signal.
- Never report success without verifying output files exist.

## Success Criteria

A run is successful only when all conditions hold:

1. An output folder is created: `<output_dir>/<YYYYMMDD>-<tweet_id>/`
2. `post.md` is generated in the folder with author, text, timestamp, URL.
3. Post image files are saved as `image_01.jpg`, `image_02.jpg`, etc.
4. Post video file is saved as `video.mp4` when the post contains video.
5. `article.mhtml` is generated for X Notes and posts with images/video; text-only tweets omit it.
6. Files are deduplicated by content hash.
7. URL output and logs use canonical `x.com` form.

## Operational Mode

- Default: guided browser flow + semantic extraction + authenticated media download.
- Startup:
  - Check if CDP responds: `curl -s http://localhost:9222/json/version`
  - If CDP NOT responding → auto-launch Chrome immediately: `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-labali" --no-proxy-server`; wait 3s; verify CDP responds
  - If Chrome with remote debugging is already running, reuse it
  - Find existing x.com tab → reuse it; if none → open new tab
  - Check login state; if wall detected → guide user to complete login manually; continue in same session
- Input:
  - After startup, if `post_url` is missing → prompt user interactively
  - If `output_dir` is missing → prompt with default `~/Downloads/x`

## Resources

| When | Must load | Do NOT load |
|------|-----------|-------------|
| Always — at skill invocation start | `references/plan.md` | `references/architecture.md` |
| Extraction returns wrong count or fails | `references/architecture.md` | — |
| Video download unclear | `references/architecture.md` | — |

See Resources table above for conditional loads.
