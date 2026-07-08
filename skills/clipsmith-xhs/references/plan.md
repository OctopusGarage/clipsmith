# Workflow Plan

## Stage Decision Table

When a failure or ambiguous situation is encountered, use this table to decide the next action:

| Situation | Action |
|-----------|--------|
| CDP not responding on port 9223 | **Auto-launch Chrome immediately** (no user confirmation needed): `open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.chrome-labali-no-proxy" --no-proxy-server`; sleep 3s; verify `curl http://localhost:9223/json/version`; retry once if still failing |
| Login wall detected before post open | Prompt user to log in; do not proceed until confirmed |
| Login wall detected after post open | Pause extraction; prompt user; retry in the same session |
| Image count 0 after extraction | Check if xsec_token was preserved in navigation URL; reload with full URL |
| Image count still 0 after reload with full URL | Session likely expired — prompt user to re-authenticate in the browser window, then retry extraction in the same session |
| publish_time not found | Use note_id alone for folder name: `unknown-<note_id>` |
| Existing XHS tab found | Reuse it — navigate it to the post URL; do not open a new tab |
| No XHS tab found | Open a new tab; navigate to the post URL |
| Folder already exists at output path | Append `-2`, `-3`, etc. rather than overwriting |
| Video merge fails (ffmpeg not found) | Report error with install command (`brew install ffmpeg`); keep segment files intact for manual merge |

## Extraction Heuristics

- **Image URL recognition — scope is critical**: XHS pages load dozens of feed/recommendation thumbnails alongside post images. Always extract post image URLs from the post viewer container (`.note-slider`), NOT from the whole page. Whole-page interception captures 10–40× too many images.
- **Carousel ordering — step-by-step only, never bulk DOM query**: XHS preloads all carousel slides into the DOM simultaneously. A single `querySelectorAll('.note-slider img')` returns them in DOM/preload order, NOT carousel order — this causes image_01 to end up as the last slide, etc. Correct steps:
  1. After `page.goto()` settles, press `ArrowLeft` up to 20× to reset to slide 1.
  2. Extract the **active slide URL only**: query `.note-slider img` and pick the `src` of the largest/visible image (or the one without a `lazy` attribute). Append to ordered array.
  3. Press `ArrowRight`, wait 400–700ms (randomized), extract active slide URL again. Append to ordered array.
  4. Stop when the new URL equals the first URL (wrap-around detected) or no change after 2 consecutive presses.
  5. The ordered array drives file naming: index 0 → `image_01.jpg`, index 1 → `image_02.jpg`, etc.
  - CDN domains: `sns-webpic-qc.xhscdn.com` (primary), `sns-img-hw.xhscdn.com`, `sns-img-qc.xhscdn.com`. Exclude `sns-avatar-qc.xhscdn.com`.
- **Response interceptor**: still register BEFORE `page.goto()` as a supplemental safety net (catches images before DOM is queryable), but primary source is step-by-step carousel navigation.
- **Carousel navigation**: `page.keyboard.press('ArrowRight')` / `ArrowLeft` is the most reliable method; DOM button selectors (`.note-slider .right-arrow`, `[class*="rightArrow"]`, `.swiper-button-next`) as secondary attempt.
- **Post-download thumbnail deduplication**: XHS preloads carousel slides at multiple resolutions — the same image appears as both a full-res version and a low-res thumbnail with a different CDN URL, so URL-level deduplication misses them. After all images are downloaded, remove any file whose size is less than 40% of the median file size across the set; these are preloaded thumbnails. Example: median 100KB, threshold 40KB — remove any file under 40KB. Log each removed file as `[dedup] removed <filename> (<size>KB, below threshold)`.

| Stage decision: duplicate thumbnail found after download | Remove the smaller file; keep the larger one |
- **Publish time extraction**: prefer `og:article:published_time` meta tag; fallback to DOM `.date` selector; fallback to current timestamp with `unknown-` prefix in folder name.
- **Video detection**: check network intercept for `.m3u8` or `.mp4` URLs before inspecting DOM; if intercept yields nothing, check DOM for `<video src>` attributes.

## Comment Export Caveats

- XHS renders comments dynamically; scroll depth directly affects how many comments are captured — shallow scroll = low coverage.
- Reply threading is unreliable — nested replies may appear as top-level comments in the extracted data.
- Even a successful run may miss 20–40% of comments on high-engagement posts; this is a platform-side limitation, not a bug.
- Comment images are fetched separately after text extraction; a partial failure here should not block the main post download.

## Output Naming Edge Cases

- Post without publish_time: folder = `unknown-<note_id>`
- Folder already exists: append `-2`, `-3`, etc. rather than overwriting
- note_id must always be included in the folder name regardless of whether publish_time is present

## Bugfix Log

| # | File | Location | Bug | Fix |
|---|------|----------|-----|-----|
| 1 | core.ts | `checkForRiskSignals` / `CAPTCHA_HINTS` | "验证码" in `CAPTCHA_HINTS` caused false-positive CAPTCHA detection when the XHS login popup was present — the popup shows "手机验证码" as a login option, which is NOT a challenge | Removed "验证码" and "安全验证" from hard `CAPTCHA_HINTS`; they now only trigger when page body does NOT contain login modal indicators ("手机号登录", "扫码登录", "登录继续查看"). Added `dismissLoginModalIfPresent()` which clicks the modal close button before risk-signal check |
| 2 | executor.ts | before `checkForRiskSignals()` | Login popup blocked extraction but was never dismissed — script aborted with false CAPTCHA error | Added `await dismissLoginModalIfPresent(page)` call before `checkForRiskSignals()` |

**Key insight:** XHS shows a "登录继续查看笔记" modal on cold tab opens. This popup is dismissible — content is fully accessible underneath. Never treat a login modal as a hard stop; dismiss it first and proceed.
