import { chromium, type ChromiumBrowser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureChromeWithRemoteDebugging,
  captureMhtml,
  saveMhtmlToFile,
  extractMhtmlImages,
  extractTweetSnapshot,
  browseAndCaptureImages,
  downloadVideos,
  simulateVideoPlay,
  writePostMarkdown,
  ensureAbsolutePath,
  ensureDir,
  parseTweetId,
  canonicalizePostUrl,
  extractHandleFromUrl,
  isLoginRequired,
  checkForRiskSignals,
  waitForManualLogin,
  normalizePublishTime,
  cleanupPageForArchive,
} from "./core.js";

// ---------------------------------------------------------------------------
// Post type
// ---------------------------------------------------------------------------
export type PostType = "article" | "withMedia" | "textOnly";

export async function detectPostType(page: Page): Promise<PostType> {
  return page.evaluate(() => {
    const isArticle = !!document.querySelector('[data-testid="twitterArticleReadView"]');
    if (isArticle) return "article";
    const tweetArticle = document.querySelector(
      'article[data-testid="tweet"]'
    ) as HTMLElement | null;
    if (!tweetArticle) return "textOnly";
    const hasPhotos = tweetArticle.querySelectorAll('[data-testid="tweetPhoto"]').length > 0;
    const hasVideo = !!tweetArticle.querySelector("video");
    return hasPhotos || hasVideo ? "withMedia" : "textOnly";
  }) as Promise<PostType>;
}

// ---------------------------------------------------------------------------
// Executor context
// ---------------------------------------------------------------------------
export interface ExecutorContext {
  log: (msg: string) => void;
  cdpPort: string;
  profileDir: string;
  proxyMode?: string;
  proxyServer?: string;
}

// ---------------------------------------------------------------------------
// Input / Output types (re-exported / mirrored from core for consumers)
// ---------------------------------------------------------------------------
export interface DownloadPostInputs {
  post_url?: string;
  output_dir?: string;
  profile_dir?: string;
  cdp_port?: string;
  timeout_ms?: number;
  overwrite?: boolean;
  keep_process_alive?: boolean;
}

export interface DownloadPostResult {
  output_dir: string;
  note_dir: string;
  note_id: string;
  post_url: string;
  publish_time: string;
  post_md_file: string;
  article_html_file?: string;
  image_count: number;
  video_count: number;
  failed_count: number;
  failed: Array<{ url: string; reason: string }>;
  files: string[];
}

// ---------------------------------------------------------------------------
// Content deduplication by SHA-256
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex of a buffer. */
async function sha256(buf: Buffer): Promise<string> {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Drop files smaller than `thresholdFrac` of the median size, and dedup
 * by SHA-256 of file content.
 */
async function dedupeByContent(
  files: Array<{ path: string; url: string }>,
  thresholdFrac = 0.1
): Promise<Array<{ path: string; url: string }>> {
  if (files.length <= 1) return files;

  const withStats = await Promise.all(
    files.map(async (f) => {
      const { size } = await stat(f.path);
      return { ...f, size };
    })
  );

  const sizes = withStats.map((f) => f.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const cutoff = median * thresholdFrac;

  const kept: Array<{ path: string; url: string }> = [];
  // Use a plain object instead of Set to avoid potential Set-shadowing issues
  // in strict TypeScript environments without ES2015 lib.
  const seen: Record<string, boolean> = {};

  for (const f of withStats) {
    if (f.size < cutoff) continue; // drop too-small files
    const buf = await readFileBuf(f.path);
    const hash = await sha256(buf);
    if (!seen[hash]) {
      seen[hash] = true;
      kept.push({ path: f.path, url: f.url });
    }
  }

  return kept;
}

async function readFileBuf(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function execute(
  inputs: DownloadPostInputs,
  context?: ExecutorContext
): Promise<DownloadPostResult> {
  const log = context?.log ?? console.log;
  const cdpPort = inputs.cdp_port ?? context?.cdpPort ?? "9222";
  const profileDir = inputs.profile_dir ?? context?.profileDir ?? "~/.chrome-labali";
  const proxyMode = context?.proxyMode;
  const proxyServer = context?.proxyServer;
  const overwrite = inputs.overwrite ?? false;
  const timeoutMs = inputs.timeout_ms ?? 60_000;
  const keepProcessAlive = inputs.keep_process_alive ?? false;

  const postUrl = canonicalizePostUrl(inputs.post_url ?? "");
  if (!postUrl) throw new Error("post_url is required");
  const tweetId = parseTweetId(postUrl);
  const handle = extractHandleFromUrl(postUrl);

  // Always try article URL first — browser-side logic (below) falls back to
  // status URL if the article view never renders (regular tweet, not X Note).
  // fetch()-based detection is unreliable: X.com is a SPA and returns 200 for
  // any valid URL regardless of whether the content is an article or a tweet.
  const pageUrl = postUrl.includes("/article/")
    ? postUrl
    : `https://x.com/${handle}/article/${tweetId}`;

  log(`[executor] post URL: ${postUrl}`);
  log(`[executor] navigating to: ${pageUrl}`);

  // Chrome startup / CDP connection
  await ensureChromeWithRemoteDebugging(cdpPort, profileDir, log, proxyMode, proxyServer);

  const browser = (await chromium.connectOverCDP(
    `http://localhost:${cdpPort}`
  )) as ChromiumBrowser;
  try {
    // Reuse existing X.com tab — avoids new tab + login state loss
    const existingPages = browser.contexts()[0]?.pages() ?? [];
    const xPage = existingPages.find(
      (p: Page) => p.url().startsWith("https://x.com/") || p.url().startsWith("https://twitter.com/")
    );
    let page = xPage ?? (await browser.newPage());

    // Always navigate to target URL to ensure we load the correct post
    if (page.url() !== pageUrl) {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }

    await checkForRiskSignals(page);

    if (await isLoginRequired(page)) {
      log("[executor] login required — waiting for manual login");
      await waitForManualLogin(page, "Login required to view post");
    }

    // Twitter renders content client-side; wait for the tweet/article element to appear
    const currentUrl = page.url();
    if (currentUrl.includes("/article/")) {
      // For X Note article URLs: wait for article view, fallback to status page
      try {
        await page.waitForSelector('[data-testid="twitterArticleReadView"]', { timeout: 8000 });
      } catch {
        // Article URL not found — X redirected to status URL, try that
        const statusUrl = `https://x.com/${handle}/status/${tweetId}`;
        if (page.url() !== statusUrl) {
          await page.goto(statusUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        }
      }
    }
    // Wait for tweet article to appear (covers status URL and article→status fallback)
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 8000 });
    } catch {
      log("[executor] warning: tweet article element not found — proceeding anyway");
    }

    const postType = await detectPostType(page);
    log(`[executor] post type: ${postType}`);

    const snapshot = await extractTweetSnapshot(page, tweetId);

    const noteId = tweetId;
    const noteDir = join(
      ensureAbsolutePath(inputs.output_dir ?? "~/Downloads/x"),
      noteId
    );
    await ensureDir(noteDir);

    const files: string[] = [];
    const failed: Array<{ url: string; reason: string }> = [];
    let imageCount = 0;
    let videoCount = 0;
    let articleHtmlFile: string | undefined;

    // Route: textOnly
    if (postType === "textOnly") {
      log("[executor] textOnly — skipping MHTML generation");
      if (snapshot.imageUrls.length > 0) {
        const result = await browseAndCaptureImages(page, snapshot.imageUrls, noteDir, overwrite);
        imageCount = result.saved.length;
        failed.push(...result.failed);
        files.push(...result.saved.map((f) => f.path));
      }
    } else if (postType === "article") {
      // Route: X Note — full cleanup + MHTML + extract embedded images
      log(`[executor] article — generating MHTML archive`);
      await cleanupPageForArchive(page, "article");

      const mhtml = await captureMhtml(page, page.url());
      const mhtmlPath = join(noteDir, "article.mhtml");
      await saveMhtmlToFile(mhtml, mhtmlPath);
      articleHtmlFile = mhtmlPath;
      files.push(mhtmlPath);
      log(`[executor] MHTML saved: ${mhtmlPath}`);

      const mhtmlImages = await extractMhtmlImages(mhtml, noteDir);
      imageCount = mhtmlImages.length;
      log(`[executor] extracted ${imageCount} images from MHTML`);

      // Additional image download for any images MHTML missed
      const extraImages = await browseAndCaptureImages(
        page,
        snapshot.imageUrls,
        noteDir,
        overwrite
      );
      for (const img of extraImages.saved) {
        if (!files.includes(img.path)) {
          files.push(img.path);
        }
      }
      failed.push(...extraImages.failed);
    } else {
      // Route: withMedia (regular tweet with images/video)
      // 仅清理外部干扰元素，直接下载图片/视频，不生成 MHTML
      log(`[executor] withMedia — downloading media directly`);
      await cleanupPageForArchive(page, "withMedia");

      // Download images via browser cache (CDN srcset → highest resolution)
      if (snapshot.imageUrls.length > 0) {
        const imgResult = await browseAndCaptureImages(page, snapshot.imageUrls, noteDir, overwrite);
        imageCount = imgResult.saved.length;
        failed.push(...imgResult.failed);
        files.push(...imgResult.saved.map((f) => f.path));
        log(`[executor] downloaded ${imageCount} image(s) from CDN`);
      }

      // Download video
      if (snapshot.videoUrls.length > 0) {
        await simulateVideoPlay(page);
        const videoResult = await downloadVideos(page, snapshot.videoUrls, noteDir, overwrite);
        videoCount = videoResult.saved.length;
        failed.push(...videoResult.failed);
        files.push(...videoResult.saved.map((v) => v.path));
        log(`[executor] downloaded ${videoCount} video(s)`);
      }
    }

    // Content deduplication — dedupByContent already dedupes by SHA-256;
    // uniqueFiles gives us the final set of paths to report.
    const uniqueFiles = await dedupeByContent(
      files.map((path) => ({ path, url: "" }))
    );

    // Write post markdown
    const postMdFile = await writePostMarkdown({
      noteDir,
      sourceUrl: postUrl,
      title: snapshot.articleTitle ?? "",
      text: snapshot.text ?? "",
      publishedAt: normalizePublishTime(snapshot.publishedAt),
      authorHandle: snapshot.authorHandle,
      authorName: snapshot.authorName,
      likeCount: snapshot.likeCount,
      retweetCount: snapshot.retweetCount,
      replyCount: snapshot.replyCount,
    });
    log(`[executor] post.md written: ${postMdFile}`);

    return {
      output_dir: ensureAbsolutePath(inputs.output_dir ?? "~/Downloads/x"),
      note_dir: noteDir,
      note_id: noteId,
      post_url: postUrl,
      publish_time: normalizePublishTime(snapshot.publishedAt),
      post_md_file: postMdFile,
      article_html_file: articleHtmlFile,
      image_count: imageCount,
      video_count: videoCount,
      failed_count: failed.length,
      failed,
      files: uniqueFiles.map((f) => f.path),
    };
  } finally {
    if (!keepProcessAlive) {
      // Disconnect Playwright's CDP client so Node can exit. The external Chrome
      // process and profile stay alive for the next invocation.
      await browser.close().catch(() => undefined);
    }
  }
}
