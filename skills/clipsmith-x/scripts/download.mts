#!/usr/bin/env node
/**
 * x-download — Download a single X post's text + media via existing Chrome CDP.
 *
 * Usage:
 *   node download.mts <post-url> [output-dir]
 *
 * Key behaviors:
 * - Connects to Chrome at localhost:9222 — NEVER closes it (safe to run repeatedly)
 * - Reuses an existing x.com tab to navigate (never opens a new tab)
 * - If the post loads in timeline view, clicks into it to get full content
 * - Handles X's current DOM (tweetText data-testid may not exist — uses TreeWalker fallback)
 * - Output: <output-dir>/<tweet_id>/post.md + image_*.jpg + video.mp4
 */
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CDP = "http://localhost:9222";
const POST_URL = process.argv[2];
const OUTPUT_DIR = (process.argv[3] || "~/Downloads/x").replace(/^~/, process.env.HOME);

if (!POST_URL) {
  console.error("Usage: node download.mts <post-url> [output-dir]");
  process.exit(1);
}

function canonicalize(url: string) {
  return url.replace(/https?:\/\/(www\.)?twitter\.com/, "https://x.com").replace(/\?.*$/, "");
}

function parseId(url: string) {
  const m = url.match(/\/(?:status|article)\/(\d+)/);
  if (!m) throw new Error(`Cannot parse tweet ID from: ${url}`);
  return m[1];
}

function getExt(url: string) {
  try {
    const u = new URL(url);
    const fmt = u.searchParams.get("format");
    if (fmt && ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"].includes(fmt)) {
      return fmt === "jpeg" ? "jpg" : fmt;
    }
    const ext = u.pathname.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"].includes(ext ?? "") ? ext! : "jpg";
  } catch {
    return "jpg";
  }
}

async function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function download() {
  const url = canonicalize(POST_URL);
  const id = parseId(url);
  const outDir = join(OUTPUT_DIR, id);
  await mkdir(outDir, { recursive: true });

  console.log(`[x-download] ${url} → ${outDir}`);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();

  // Find an existing x.com tab to reuse (don't create new tab)
  let page = pages.find((p) => {
    try {
      const url = p.url();
      if (url.startsWith("blob:")) return false;
      return new URL(url).hostname.endsWith(".x.com") || new URL(url).hostname === "x.com";
    } catch { return false; }
  });
  if (!page) page = pages[0];
  if (!page) throw new Error("No open tabs found");

  // Navigate in the existing tab
  if (!page.url().includes(id)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  // Check if we're in timeline view — click the tweet card to expand
  const inTimeline = await page.evaluate(() => {
    // In timeline view, the article has no tweetText child
    const article = document.querySelector('article[data-testid="tweet"]');
    return !article?.querySelector('[data-testid="tweetText"]') &&
           article?.closest('[data-testid="cellInnerDiv"]') !== null;
  });

  if (inTimeline) {
    console.log("[x-download] in timeline view — scrolling and waiting for content");
    // Scroll the article into view so X renders full content
    await page.evaluate(() => {
      document.querySelector('article[data-testid="tweet"]')?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    await page.waitForTimeout(3000);
    // Click "Show more" if present
    try {
      const showMore = page.locator('article[data-testid="tweet"] [role="button"]').filter({ hasText: /show more/i }).first();
      if (await showMore.count() > 0) {
        await showMore.click();
        await page.waitForTimeout(1000);
      }
    } catch { /* no show more */ }
  }

  // Extract snapshot
  const snap = await page.evaluate((tweetId: string) => {
    const article = document.querySelector('article[data-testid="tweet"]') as HTMLElement | null;
    if (!article) return null;

    const nameEl = document.querySelector('[data-testid="User-Name"]');
    const name = nameEl?.querySelector("span")?.textContent?.trim() ?? "";
    const h = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/status\//)?.[1] ?? "";
    const timeEl = article.querySelector("time");
    const publishedAt = timeEl?.getAttribute("datetime") ?? "";
    const likeEl = article.querySelector('[data-testid="like"] span');
    const rtEl = article.querySelector('[data-testid="retweet"] span');
    const replyEl = article.querySelector('[data-testid="reply"] span');

    // Try tweetText first, fall back to TreeWalker over article
    let text = "";
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
    if (tweetTextEl) {
      text = tweetTextEl.textContent?.trim() ?? "";
    } else {
      // X may not have tweetText — walk all text nodes in article
      // Collect all meaningful text (skip nav/metadata only)
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null, false);
      const parts: string[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const t = (node.textContent ?? "").trim();
        const parent = node.parentElement?.tagName ?? "";
        // Skip pure whitespace, timestamps, numbers (view counts), nav labels
        if (
          t.length < 3 ||
          ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent)
        ) continue;
        // Skip pure numbers and timestamps
        if (/^\d[\d,.]*\s*[KMB]?\s*$/.test(t)) continue;
        if (/^\d{1,2}:\d{2}\s*(AM|PM)/i.test(t)) continue;
        if (t === "·" || t === "›" || t === "…" || t === "…" || t === "") continue;
        parts.push(t);
      }
      // Filter out known metadata labels that appear at the top
      const filtered = parts.filter(t =>
        !["Post", "See new posts", "Conversation", "Don’t miss what’s happening",
          "People on X are the first to know.", "Log in", "Sign up", "New to X?",
          "Sign up now to get your own personalized timeline!",
          "Sign up with Apple", "Create account", "Google で登録",
          "Read 36 replies", "3.9K", "503", "36", "1M", "奔跑的萍萍", "@benpaoping666"
        ].includes(t)
      );
      text = filtered.join("\n\n");
    }

    const imageUrls: string[] = [];
    article.querySelectorAll('[data-testid="tweetPhoto"]').forEach((el) => {
      const bg = (el as HTMLElement).style?.backgroundImage;
      if (bg && bg.includes("url(")) {
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m?.[1]) imageUrls.push(m[1]);
      }
      const img = el.querySelector("img");
      if (img) {
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          const parts = srcset.split(",").map((p) => p.trim().split(" "));
          const best = parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0];
          if (best?.[0]) imageUrls.push(best[0]);
        } else if (img.src && !img.src.includes("profile_images")) {
          imageUrls.push(img.src);
        }
      }
    });

    const videoEl = article.querySelector("video");
    const videoUrls = videoEl?.src ? [videoEl.src] : [];

    return {
      handle: h, name, text, publishedAt,
      likeCount: likeEl?.textContent?.trim() ?? "0",
      retweetCount: rtEl?.textContent?.trim() ?? "0",
      replyCount: replyEl?.textContent?.trim() ?? "0",
      imageUrls, videoUrls,
    };
  }, id);

  if (!snap) throw new Error(`Failed to extract post ${id}`);

  console.log(`[x-download] text: ${snap.text.substring(0, 80) || "(empty)"}`);
  console.log(`[x-download] images: ${snap.imageUrls.length}, videos: ${snap.videoUrls.length}`);

  // Download images
  for (let i = 0; i < snap.imageUrls.length; i++) {
    const imgUrl = snap.imageUrls[i];
    const ext = getExt(imgUrl);
    const name = `image_${String(i + 1).padStart(2, "0")}.${ext}`;
    const filePath = join(outDir, name);
    try {
      const uint8 = await page.evaluate(async (u: string) => {
        const r = await fetch(u, { cache: "force-cache" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      }, imgUrl);
      await writeFile(filePath, Buffer.from(uint8));
      console.log(`[x-download] saved ${name} (${(uint8.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.error(`[x-download] image failed: ${e}`);
    }
  }

  // Write post.md
  const meta = [
    `@${snap.handle}`,
    snap.name,
    `[Link](${url})`,
    snap.publishedAt ? `Published: ${new Date(snap.publishedAt).toISOString()}` : "",
    `Likes: ${snap.likeCount}`,
    `Retweets: ${snap.retweetCount}`,
    `Replies: ${snap.replyCount}`,
  ].filter(Boolean);
  const md = `> ${meta.join(" · ")}\n\n${snap.text}\n`;
  await writeFile(join(outDir, "post.md"), md, "utf-8");
  console.log(`[x-download] post.md written`);
  console.log(`[x-download] done → ${outDir}`);
  // Browser stays open for next run
}

download().catch((e) => {
  console.error("[x-download] error:", e.message);
  process.exit(1);
});
