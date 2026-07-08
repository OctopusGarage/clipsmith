# plan.md

## Architecture

See `../ARCHITECTURE.md`.

## Download Flow

See `../WORKFLOW.md`.

## Dependencies

- `@playwright/test` ^1.52.0 - Browser automation
- `node:fs/promises` - File I/O

---

### t.co URL Expansion

Twitter renders links as t.co shortlinks (e.g., `https://t.co/yr4YXZ6SgU`) — both in `href` attributes and `textContent`. **post.md must contain the full resolved URL** (e.g., `https://github.com/anthropics/skills/tree/main/skills/pptx`).

Because Twitter's Content Security Policy (CSP) blocks cross-origin `fetch()` inside `page.evaluate()`, URL resolution must happen in Node.js:

```typescript
// Step 1: collect all hrefs inside page.evaluate()
const tcoHrefs: string[] = [];
Array.from(textEl.querySelectorAll("a")).forEach((a) => {
  const href = a.getAttribute("href") ?? "";
  if (href) tcoHrefs.push(href);
});

// Step 2: resolve t.co links from Node.js (not from browser context)
const tcoMap: Record<string, string> = {};
for (const href of tcoHrefs) {
  if (href.startsWith("https://t.co/") && !tcoMap[href]) {
    try {
      const resp = await fetch(href, { redirect: "follow" });
      tcoMap[href] = resp.url; // resp.url is the final resolved URL after redirects
    } catch {
      tcoMap[href] = href;
    }
  }
}

// Step 3: replace anchor textContent with resolved URLs, then extract text
text = await page.evaluate((params) => {
  // replace each anchor's textContent with params.tcoMap[href]
  return textEl.textContent?.trim() ?? "";
}, { tcoMap });
```

This logic is integrated into `extractTweetSnapshot()` in `core.ts`. **Do not skip or simplify this step.**

---

### Three Post Types

`detectPostType(page)` inspects the DOM to choose the correct pipeline:

| Type | Detection | Pipeline |
|------|-----------|---------|
| `article` | `[data-testid="twitterArticleReadView"]` exists | Clean external + internal elements → generate MHTML → extract images from MHTML |
| `withMedia` | Tweet has `[data-testid="tweetPhoto"]` or `<video>` | Clean external only → download images/video directly from CDN (no MHTML) |
| `textOnly` | Tweet has no images or video | Extract text, write `post.md` only; no MHTML |

**Note**: X Note article URLs use `/username/article/<id>`, not `/username/status/<id>`. Both `parseTweetId()` and `extractHandleFromUrl()` must match both patterns.

---

### Page Cleanup Strategy

Before archiving, remove UI elements unrelated to post content:

**External (always applied):**
| Selector | Description |
|----------|-------------|
| `[data-testid="LoginForm"]` | Login form |
| `a[href*="/login"]` | Login link |
| `a[href*="/i/flow/signup"]` | Signup link |
| `header[role="banner"]` | Top nav bar |
| `nav[role="navigation"]` | Nav menu |
| `[data-testid="sidebarColumn"]` | Right sidebar |
| `[data-testid="app-bar"]` | App bar |
| `[aria-label*="Who to follow"]` | Follow suggestions |
| `[aria-label*="Trending"]` | Trending topics |
| `[data-testid="twitterArticleTopBar"]` | Article top bar |
| `[data-testid="postRTCover"]` | Bottom prompt area |
| `[data-testid="BottomBar"]` | Bottom bar |

**Internal (only for `article` type):**
| Selector | Description |
|----------|-------------|
| `[data-testid="twitterArticleReadView"] [class*="r-1cmwbt1"]` | Author section |
| `[data-testid="twitterArticleReadView"] [aria-label*="replies"]` | Stats bar |
| `[data-testid="twitterArticleReadView"] [role="status"]` | Upgrade prompt |
| `[data-testid="twitterArticleReadView"] [role="separator"]` | Separator lines |
| `[data-testid="twitterArticleReadView"] [data-testid="UserCell"]` | Recommended users |

---

### CDP Page.captureSnapshot

Generate standard MHTML via Playwright CDPSession — calls Chrome's built-in command:

```typescript
const cdpSession = await page.context().newCDPSession(page);
const { data } = await cdpSession.send('Page.captureSnapshot', { withResources: true });
// data is the MHTML string
```

Used for: X Notes (`article` type).
Not used for: `withMedia` (CDN download) or `textOnly` (no archive needed).

---

### Bugfix Log (2026-04-14)

| # | File | Line | Bug | Fix |
|---|------|------|-----|-----|
| 1 | executor.ts | 201 | `noteId` referenced before declaration (TDZ) | Changed to `tweetId` |
| 2 | executor.ts | 334 | `browser.close()` in finally block — closes Chrome CDP after each run, causing "Target page, context or browser has been closed" on next run | Removed `browser.close()` entirely — Chrome stays open and is reused |
| 3 | core.ts | 528 | Non-article tweets returned `text: ""` (hardcoded empty) — tweet text never extracted | Extract `tweetText` from `[data-testid="tweetText"]` and return it |
| 4 | core.ts:737 | `getExt()` called `.pathname.split(".").pop()` on Twitter CDN URLs like `.../media/xxx?format=jpg&name=medium` — no path extension, returns undefined | Check `searchParams.get("format")` first; only fall back to pathname |
| 5 | executor.ts | 161 | `fetch(articleUrl)` to detect X Notes unreliable — X.com is a SPA, returns 200 for any URL; X Note posts incorrectly fell through to status URL and were detected as `withMedia` instead of `article` | Removed fetch check; always navigate to `/article/<id>` first — existing browser-side fallback (line ~194) falls back to `/status/<id>` if article view never renders |

**Key insight:** The script's `browser.close()` was the root cause of the "repeated re-opening" problem. Once removed, Chrome CDP stays alive at `:9222` and subsequent runs reuse it instantly — no new tabs, no re-login.

### DOM Change (2026-04): `tweetText` data-testid may not exist

X sometimes renders posts in **timeline view** (`isTimeline=true`) — the article has no `tweetText` child and the full content is hidden. The fix:

1. Detect timeline vs single-post view by checking `article.closest('[data-testid="cellInnerDiv"]')`
2. If in timeline: click `article a[href*="/{tweetId}"]` to expand into single-post view
3. If `tweetText` missing even after expand: use `TreeWalker` to walk all text nodes in the article, filtering out nav/metadata strings

---

### Quick Download Script

For simple single-post downloads, use `scripts/download.mts` instead of `run.ts`:

```bash
node scripts/download.mts "https://x.com/USER/status/123456"
# or with custom output dir:
node scripts/download.mts "https://x.com/USER/status/123456" ~/my-posts
```

- Connects to existing Chrome at `localhost:9222` — never closes it
- Output: `<output-dir>/<tweet_id>/post.md` + `image_01.jpg`, etc.
- Safe to run repeatedly — reuses existing tab if URL matches
