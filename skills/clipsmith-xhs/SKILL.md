---
name: clipsmith-xhs
description: >-
  Download XiaoHongShu (XHS / xiaohongshu) post assets — images, video, text
  metadata — to a local folder using browser automation with manual-login
  session reuse. Use when downloading a XHS post, saving post images, exporting
  post content, or archiving a note. Trigger phrases: "download xhs",
  "xiaohongshu post", "xhs images", "save post", "xhs note",
  "xiaohongshu download".
license: MIT
allowed-tools: "Bash(npx:*), Bash(pnpm:*)"
metadata:
  pattern: pipeline
  compatibility: "macOS / Linux; requires Chrome with remote-debugging enabled (port 9223), profile ~/.chrome-labali-no-proxy, and authenticated XiaoHongShu session; Node.js ≥ 18 + tsx"
---

# clipsmith-xhs

> **MANDATORY — load `references/plan.md` before any browser or extraction action begins.**

## ⚠️ NEVER WRITE YOUR OWN SCRIPT

**The download logic is fully implemented. Always invoke the existing script — do NOT write a new one.**

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-xhs
npx tsx scripts/run.ts \
  --post_url "<url>" \
  --output_dir "$HOME/Downloads/xhs"
```

The sections below (carousel logic, DOM extraction, anti-detection) are **implementation documentation for the script itself**, not instructions for you to re-implement. If the script doesn't exist or can't run, report the error — never substitute with hand-written Playwright code.

## Clipsmith Bundle Normalization

The copied downloader produces a raw post folder with `post.md`, images, optional
video, and optional comments. Before finalizing a Clipsmith capture job, run the
`raw-output-to-capture.json` normalization step by converting that raw folder
into a bundle:

1. Keep `post.md` in the bundle directory; do not copy downloaded media,
   comments, or comment images into the final bundle.
2. Create `summary.md` from the captured post text and OCR/comment context when
   available.
3. Write `capture.json` with schema `clipsmith.capture_bundle.v1`, platform
   `xhs`, source/canonical URL, title/author/published metadata when available,
   `content_files` entries for `summary.md` and `post.md`, an empty `assets`
   array, warnings, and status.
4. Run `clipsmith validate-bundle "<bundle_dir>" --json`.

Do not call `clipsmith capture finalize` until `capture.json` exists and
validation succeeds.

## Required Constraints

- Use browser automation only.
- Do not use Xiaohongshu private APIs.
- Reuse manual-login session via unified Chrome CDP startup:
  `open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.chrome-labali-no-proxy" --no-proxy-server`.
- Prefer semantic extraction from visible page state and loaded resources.
- Download only target post assets: images plus optional post video.
- Generate `post.md` for extracted text metadata.
- Export comments only when `include_comments=true`, and write `comments/comments.json` + `comments/comments.md`.
- Download comment images into `comments/images/`.
- Comment export is not guaranteed to be complete — if extraction yields zero comments on a post known to have them, retain all image/video downloads, set `comments_count=0`, and report the partial result without throwing.
- Do not generate `manifest.json`.
- If multiple video segments are downloaded, merge them into one file and delete segment files.
- Preserve all original query parameters (especially `xsec_token`, `xsec_source`, `share_id`) for page navigation — Xiaohongshu uses these tokens to render authenticated content; stripping them causes incomplete page rendering (wrong image count, missing text).
- Normalize post URL to canonical format (`https://www.xiaohongshu.com/explore/<note_id>`) for output only: folder naming, `post.md` source field, and logs. Do not strip params before navigating.

## Anti-Detection Principles

XiaoHongShu applies behavioral analysis to detect automation. Violations of these principles have caused account rate-limiting in the past — do not remove or bypass them.

**Core test — apply before every browser action:**
> "Would a real user do this, from this state, at this moment?"
> If no → skip it or slow it down. Re-navigating an already-open post, batch-extracting DOM nodes, issuing fresh HTTP requests for images the browser just loaded, using fixed delays — all fail this test.

**Navigation:**
- If the tab is already on the target post URL, skip `page.goto()` entirely — re-navigating an already-open post is an unnatural action and a clear bot signal.
- All fixed `waitForTimeout` values must be randomized (e.g., `base + Math.random() * range`) — deterministic delays are a bot fingerprint.
- After navigating to a post, scroll down briefly to simulate reading the text, then scroll back up before interacting with images.

**Image acquisition:**
- Never issue new HTTP requests for images — the browser has already downloaded them.
- **Register `page.on("response")` BEFORE calling `page.goto()`** — images load during navigation; a listener registered after `goto()` misses the first batch entirely.
- **Primary image source: DOM-scoped extraction from `.note-slider`**, NOT whole-page response interception. XHS pages load 10–40× more feed/recommendation images than the post itself; intercepting all xhscdn responses produces the wrong count. Correct flow:
  1. After page settles, press `ArrowLeft` repeatedly (up to 20×) until no new image appears — this resets the carousel to slide 1 regardless of prior state.
  2. Read the **currently visible** slide image URL from `.note-slider img` (the active/largest `src`, not all preloaded imgs) and append it to an ordered list.
  3. Press `ArrowRight` once, wait, then read the new current slide URL. Repeat until the URL is the same as the first URL (carousel wrapped) or no change after 2 consecutive presses.
  4. This ordered list is the authoritative image sequence — file names (`image_01`, `image_02`, …) must match this order.
  5. Fetch each URL via `fetch(url, {cache: 'force-cache'})` in `page.evaluate()`.
  - **Do NOT do a bulk upfront query of all `.note-slider img` elements** — XHS preloads all slides into the DOM simultaneously, so a single querySelectorAll returns them in DOM order (which is not carousel order), causing the naming to be scrambled.
- Response listener (`page.on("response")`) may still run as a supplemental net, but DOM extraction is the authoritative source.
- If neither path yields images, report failure — do not fall back to `page.request.get()`.
- **Deduplicate by image hash, not just by URL** — XHS CDN URLs for the same image at different quality levels share the same hash prefix before `!` (e.g. `sns-webpic-qc.xhscdn.com/.../HASH!nd_dft_wlteh_webp_3` and `...HASH!nd_dft_wlteh_webp_1` are the same image). Extract the hash segment and keep only the URL whose downloaded file is largest. Alternatively, after all downloads complete, remove any file whose size is less than 40% of the median file size — these are preloaded thumbnails, not content images.
- Carousel navigation: `page.keyboard.press('ArrowRight')` first (most reliable); DOM selectors (`.note-slider .right-arrow`, `[class*="rightArrow"]`, `.swiper-button-next`) as fallback.

**Video:**
- Before downloading, simulate user engagement: bring the tab to front, click the video/play button, wait 3–5 seconds for buffering.
- Video download still uses `page.request.get()` (stream content is not fully cached); the play simulation above is what makes this behaviorally acceptable.

**General:**
- Always operate within the user's authenticated Chrome session (CDP reuse) — never launch a headless or separate browser.
- Never read `window.__INITIAL_STATE__` or manipulate the DOM in ways that go beyond what a user's own browser JS would do.

## NEVER

- **Never write a custom Playwright/Node.js script to perform the download** — the existing `scripts/run.ts` already handles all carousel navigation, image extraction, deduplication, and metadata. Writing a new script bypasses all tested logic and produces incomplete results (e.g. only 1 image instead of all slides).
- Never leave multiple video segment files in the output folder after a successful run — merge segments and delete the originals.
- Never report success if `post.md` was not generated.
- Never report success based on action completion alone — verify output folder structure and required files exist.
- **Never strip xsec_token or share params before navigating** — XiaoHongShu uses these tokens server-side to render authenticated content; a URL without them silently produces wrong image counts and missing text, with no error.
- **Never launch a new Chrome instance if CDP is already responding on port 9223** — launching a second instance creates a separate session, loses the authenticated profile, and forces re-login.
- **Never take over a non-XiaoHongShu browser tab** — if an existing XHS tab is found, reuse it by navigating it to the post URL; if no XHS tab exists, open a new tab. Never hijack tabs belonging to other pages (e.g., Gmail, dev tools). The correct behavior is always: XHS tab → navigate it to post URL; no XHS tab → open new tab.
- **Never issue new outbound HTTP requests for post images** — use response interception or browser cache reads only; falling back to `page.request.get()` for images is a bot signal.
- **Never use fixed (non-randomized) delays** — deterministic timing is a bot fingerprint; all waits must include a random component.
- **Never retry automatically after a hard risk signal** (CAPTCHA, rate-limit message, account anomaly) — stop immediately, preserve all downloaded files, log the signal type and last successfully processed item, and surface the error to the user for manual intervention.
- **Never treat a login modal as a hard stop** — XHS shows a "登录继续查看笔记" dismissible popup on cold tab opens; content is fully accessible underneath. The script calls `dismissLoginModalIfPresent()` before risk-signal checks. Do NOT confuse this modal with an actual login wall. "验证码" in page text is only a CAPTCHA signal when the login modal indicators ("手机号登录", "扫码登录") are absent.

## Success Criteria

A run is successful only when all conditions hold:

1. A post output folder is created under the specified local directory.
2. Folder naming format is `<download_date>-<sanitized_title>-<note_id>` (title omitted when empty); `<download_date>` is today's date (YYYYMMDD), not the post's publish time.
3. `post.md` is generated in the folder.
4. Post image files are saved in the folder.
5. Post video files are saved when the post contains video.
6. If multiple video files are generated, they are merged into one and segment files are removed.
7. When `include_comments=true`, comments are exported under `comments/` with `comments.json` and `comments.md`.
8. When comment images exist, they are downloaded under `comments/images/`.
9. URL output and logs use canonical `/explore/<note_id>` form without token query.

Comment export failure behavior:
- If extraction yields zero comments on a post known to have them: retain all downloaded files, return `comments_count=0`, do not throw. Partial coverage of hierarchy/reply linking is acceptable and expected.

## Operational Mode

- Default mode: guided browser flow + semantic extraction + authenticated media download.
- Optional mode: add semantic comment extraction, comment image download, and write `comments/comments.json` + `comments/comments.md` when `include_comments=true`.
- Startup guidance:
  - check if CDP is responding: `curl -s http://localhost:9223/json/version`
  - if CDP is NOT responding → **auto-launch Chrome immediately** (no user prompt needed):
    `open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.chrome-labali-no-proxy" --no-proxy-server`
    then wait 3 seconds and verify CDP responds before proceeding.
  - if Chrome with remote debugging is already running on the CDP port, reuse it — do not launch a new instance,
  - connect via CDP port,
  - if an existing Xiaohongshu tab is found, reuse it — do not open a new tab or navigate away from any other active tab,
  - if no Xiaohongshu tab exists, open a new tab,
  - check whether login is required,
  - if required, guide user to complete manual login in the same window,
  - if already logged in, skip login wait.
- Input guidance:
  - after startup/login check, if `post_url` is missing, prompt user to input post URL interactively,
  - if `output_dir` is missing, prompt user to input target folder (with default).
- If login is required:
  - keep browser open,
  - ask user to complete login manually,
  - continue in the same session after confirmation.
- On partial download failures:
  - keep successfully downloaded files,
  - return result with explicit failure count.

## Resources

| When | Must load | Do NOT load |
|------|-----------|-------------|
| Always — at skill invocation start | `references/plan.md` | `references/architecture.md` |
| Extraction returns wrong count or fails | `references/architecture.md` | — |
| Video merge or comment export unclear | `references/architecture.md` | — |

See Resources table above for conditional loads.
