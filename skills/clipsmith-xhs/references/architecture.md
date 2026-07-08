# Architecture and Standards

## 1) Execution Model

Scripts: `core.ts` (URL parsing, extraction, file writing), `executor.ts` (full workflow orchestration), `run.ts` (CLI entry).

**Key constraints that are non-obvious and must not be violated:**

- **URL navigation**: always use the full original URL with all query params — `xsec_token` and share params are required for XiaoHongShu to render authenticated content server-side. Stripping them silently produces wrong image counts and missing text with no error.
- **Browser session**: if CDP responds on port 9223, reuse that instance. The default `~/.chrome-labali-no-proxy` launch must include `--no-proxy-server`. Launching a second Chrome instance creates a separate unauthenticated session.
- **Tab selection**: find an existing `xiaohongshu.com` tab and navigate it to the post URL. If no XHS tab exists, open a new tab. Never take over non-XHS tabs.
- **Extraction order**: attempt state-intercept first; fall back to DOM only when state returns 0 results (see Extraction Decision Guide).
- **Download context**: use the browser's authenticated request context for all media fetch — not a plain HTTP client.
- **Video output**: if video is segmented (HLS), merge all segments into `video-merged.mp4` and delete segment files; apply this rule even for single-segment HLS to keep output filename consistent.

## 3) Extraction Decision Guide

### State-first vs DOM-fallback

Prefer network-intercepted state (XHR/fetch responses captured during page load) over DOM scraping:

- XiaoHongShu loads images lazily; DOM may be incomplete at `DOMContentLoaded` — images not yet in view are absent from the DOM but present in the intercepted state.
- State intercept captures the full image array in a single structured object; DOM scraping requires scrolling to force lazy load and is slower and less complete.
- Fall back to DOM extraction only when state intercept returns 0 images or fails entirely.

### Login-wall detection heuristics

Signals that indicate a login-gated state (not full content):

- Page URL redirects to `/login` or contains `target=` redirect parameter.
- DOM contains a login button (`button[data-v*]` with text matching "login" or "sign in").
- Image count after extraction is 0 when the URL is a known valid post URL.
- Post text container is empty or contains only placeholder text.

When any login-wall signal is detected, pause extraction and prompt the user to log in before retrying.

## 4) Download Correctness Standards

- Use authenticated browser request context for media fetch.
- Infer file extensions from response content-type first, URL second.
- Keep deterministic file naming (`001.*`, `002.*`, `video-001.*`, ...), and produce `video-merged.mp4` after merge when segmented videos exist.
- Keep only post assets; exclude APIs, avatars, icons, and non-media responses.

## 5) Video Handling

### m3u8 vs direct MP4

XiaoHongShu video posts may deliver video as either:

- **Direct MP4**: a single `.mp4` URL captured in the network intercept — download directly.
- **HLS segments (m3u8)**: a `.m3u8` playlist URL captured in the network intercept — download the segment files listed in the playlist, then merge.

Detection rule: if the intercepted video URL ends with `.m3u8` or contains `/hls/`, treat as HLS. Otherwise treat as direct MP4.

### Merge rule

After downloading all segments:

1. Merge all segment files into `video-merged.mp4` (using `ffmpeg -f concat` or equivalent).
2. Delete all segment files regardless of count — even a single-segment HLS download should be merged and the original deleted, to produce a consistent output filename.
3. The output folder must contain `video-merged.mp4`, not raw segment files.

## 6) Logging and Diagnostics

- Log stage transitions: open, extract, login-wait, download, finalize.
- Emit final counts: discovered, downloaded, failed.
