# Architecture

## Overview

`clipsmith-x` uses browser automation via Chrome CDP to extract X post content. It reuses the user's existing Chrome session (authenticated login) without launching a separate browser instance.

## Anti-Detection Principles

**Core test — apply before every browser action:**
> "Would a real user do this, from this state, at this moment?"
> If no → skip it or slow it down. Re-navigating an already-open post, batch-extracting DOM nodes, issuing fresh HTTP requests for images the browser just loaded, using fixed delays — all fail this test.

### Navigation

- If the tab is already on the target post URL, skip `page.goto()` entirely — re-navigating an already-open post is an unnatural action and a clear bot signal.
- All fixed `waitForTimeout` values must be randomized (e.g., `base + Math.random() * range`) — deterministic delays are a bot fingerprint.

### Image Acquisition

- **Register `page.on("response")` BEFORE calling `page.goto()`** — images load during navigation; a listener registered after `goto()` misses the first batch entirely.
- **Primary image source: DOM extraction from `[data-testid="tweetPhoto"] img`** — X renders all post images in a grid.
- Fetch each URL via `fetch(url, {cache: 'force-cache'})` inside `page.evaluate()` — do not issue new outbound requests outside the page context.
- After all images downloaded: deduplicate by SHA-256 content hash; remove files < 40% of median size.

### Video Acquisition

- Before downloading: bring the tab to front, click the video element, wait 3–5 seconds (randomized) for buffering — this is what makes the behavior acceptable.
- Video download uses `page.request.get()` (stream content may not be fully cached); the play simulation above is the behavioral justification.

### General

- Always operate within the user's authenticated Chrome session (CDP reuse) — never launch a headless or separate browser.
- Never manipulate the DOM beyond what a user's own browser JS would do.

## Key Differences from XHS Skill

| | XHS | X |
|--|-----|---|
| Images | Carousel (step-by-step navigation) | Grid (all at once in DOM) |
| Image CDN | `sns-webpic-qc.xhscdn.com` | `pbs.twimg.com` |
| Video CDN | `xhscdn.com` | `video.twimg.com` |
| Post URL scope | `xhslink.com` + `xiaohongshu.com` | `x.com` only |
| Image ordering | Carousel position (ArrowRight navigation) | DOM grid order |
| Post ID location | `/explore/<note_id>` | `/status/<tweet_id>` |

## NEVER

- Never launch a new Chrome if CDP is already responding on port 9222
- Never hijack a non-x.com tab — reuse X tab or open a new X tab
- Never strip query params from post URL before navigating
- Never use fixed (non-randomized) delays
- Never retry after CAPTCHA or rate-limit signal
- Never report success without verifying output files exist
- Never issue new outbound HTTP requests for images the browser already loaded
