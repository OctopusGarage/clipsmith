# clipsmith-xhs Usage

This skill downloads Xiaohongshu post assets into a local folder with browser automation.

Current output policy:
- Save `post.md`
- Save post images
- Save post video when available
- Optionally export comments (`comments.json` + `comments.md`) with `--include_comments true` (**experimental, completeness/accuracy not guaranteed**)
- Comment export is written under a dedicated `comments/` subdirectory
- If video is split into multiple segments, merge to one `video-merged.mp4` and remove segment files
- Do **not** save `manifest.json`

## 1) Install and Update

Install from GitHub:

```bash
npx skills add /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-xhs
```

Update to latest version: run the install command again.

## 2) Quick Start

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-xhs
npx tsx scripts/run.ts \
  --post_url "https://www.xiaohongshu.com/explore/<note_id>?xsec_token=...&xsec_source=pc_user" \
  --output_dir "/absolute/output/dir"
```

Optional flags:
- `--profile_dir ~/.chrome-labali-no-proxy`
- `--cdp_port 9223`
- `--proxy_mode none|system|custom`
- `--proxy_server http://127.0.0.1:7890`
- `--timeout_ms 90000`
- `--overwrite true|false`
- `--include_comments true|false`

If `post_url` or `output_dir` is omitted, the script prompts interactively.

## 3) Runtime Flow

1. Launch/reuse Chrome with CDP (`open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir=... --no-proxy-server`).
2. Connect via CDP.
3. Open Xiaohongshu home and check login state.
4. If login is required, pause and wait for manual login.
5. Open target post URL.
6. Extract post data from page state (primary) and DOM fallback.
7. Normalize output URL to canonical form: `https://www.xiaohongshu.com/explore/<note_id>`.
8. Create folder named `<publish_time>-<note_id>`.
9. Download images and videos.
10. If multiple videos exist, merge to `video-merged.mp4` and clean temporary files.
11. Write `post.md`.
12. If `include_comments=true`, extract comments and write `comments/comments.json` + `comments/comments.md`.
13. If comment images exist, download them into `comments/images/`.

## 4) Technical Method

Execution stack:
- Browser startup: system command (`open -na "Google Chrome" ... --remote-debugging-port=<port>`)
- CDP communication: Playwright `connectOverCDP`
- Data extraction:
  - Primary: `window.__INITIAL_STATE__.note.noteDetailMap`
  - Fallback: fixed DOM selectors and filtered media URL heuristics
- Comment extraction:
  - Primary: best-effort structured scan from `window.__INITIAL_STATE__`
  - Fallback: comment DOM selectors with user/userId and reply relation fields
  - Pagination strategy: scroll + click visible "more/expand/reply/next" elements to load additional comments/replies
- Comment assets:
  - Download comment images into `comments/images/`
- Media download: authenticated request context from browser session
- Video merge: `ffmpeg` concat (`copy` first, then re-encode fallback)

## 5) Output Structure

Example:

```text
<output_dir>/
  <publish_time>-<note_id>/
    001.webp
    002.webp
    video-merged.mp4   (if video exists)
    post.md
    comments/          (if --include_comments true)
      comments.json
      comments.md
      images/
        001.webp
        002.webp
```

## 6) Limitations and Fragility

This skill is robust for current pages, but not fully inference-driven. Main risks:

1. Frontend state schema drift
- Primary extractor depends on `__INITIAL_STATE__.note.noteDetailMap` layout.
- If Xiaohongshu changes schema, extraction can fail.

2. DOM fallback is selector-based
- Fallback uses fixed selectors and text pattern rules.
- Major UI changes may break fallback quality.

3. Login gate and anti-bot changes
- Login detection is heuristic (URL/text).
- Anti-bot / access policy changes can cause 404/redirect/empty extraction.

4. Canonical URL access variability
- Canonical `/explore/<note_id>` may not be directly openable in some sessions/regions.
- Runtime navigates with input URL but reports canonical URL in output.

5. Video segmentation/codec constraints
- Multi-part videos require local `ffmpeg`.
- Without `ffmpeg`, segmented videos cannot be auto-merged.

6. Comment export is not fully reliable (important)
- Comment extraction is best-effort and may miss some top-level/reply comments, reply relations, images, or emoji assets.
- UI/risk-control/lazy-load changes can still cause partial or mis-grouped comment output.

## 7) Troubleshooting

- If download returns empty media:
  - Confirm browser is logged in to Xiaohongshu.
  - Re-run with full source URL (including token) for navigation.
- If videos are split but not merged:
  - Install `ffmpeg` and ensure it is in `PATH`.
- If output contains stale files:
  - Re-run with `--overwrite true`.

## 8) Notes for Maintenance

When page structure changes, prioritize:
1. Fixing `__INITIAL_STATE__` extraction path
2. Keeping DOM fallback minimal and defensive
3. Preserving output contract (`post.md`, images, merged video, no manifest)
