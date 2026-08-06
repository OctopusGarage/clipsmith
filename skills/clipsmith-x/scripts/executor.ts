import { chromium, type ChromiumBrowser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureChromeWithRemoteDebugging,
  probeCdp,
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
  detectLoginState,
  checkForRiskSignals,
  normalizePublishTime,
  cleanupPageForArchive,
  type TweetSnapshot,
} from "./core.js";
import {
  fetchSyndicationTweet,
  downloadMedia,
  stripMetadata,
} from "./syndication.js";

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

  // Route the URL by form: explicit /article/ stays an X Note; everything
  // else (including /i/status/... or /handle/status/...) goes to /status/.
  // We never guess /article/ from an unknown URL — X Note article IDs are a
  // separate numeric ID space from tweet snowflake IDs.
  const wantsArticle = /\/article\//.test(postUrl);
  const pageUrl = wantsArticle
    ? postUrl
    : `https://x.com/${handle}/status/${tweetId}`;

  log(`[executor] post URL: ${postUrl}`);
  log(`[executor] navigating to: ${pageUrl}`);

  // Verify CDP before doing any browser work. We never auto-launch Chrome —
  // if no CDP is listening on the configured port, fall through to syndication
  // so the user's normal Chrome stays untouched.
  if (!(await probeCdp(cdpPort))) {
    log(`[executor] no CDP on :${cdpPort} — falling back to syndication`);
    return await executeSyndicationOnly({
      postUrl,
      tweetId,
      handle,
      outputDir: inputs.output_dir,
      log,
    });
  }

  const browser = (await chromium.connectOverCDP(
    `http://localhost:${cdpPort}`
  )) as ChromiumBrowser;
  try {
    // Reuse the user's existing x.com tab if any. Never open a new tab —
    // that would yank focus from whatever the user was already doing.
    const existingPages = browser.contexts()[0]?.pages() ?? [];
    const xPage = existingPages.find((p: Page) => {
      const u = p.url();
      return u.startsWith("https://x.com/") || u.startsWith("https://twitter.com/");
    });
    let page = xPage ?? existingPages[0] ?? (await browser.newPage());

    // Navigate to the canonical post URL. If the existing tab is already
    // there, we leave it alone to avoid a redundant round-trip.
    if (page.url() !== pageUrl) {
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      } catch (err) {
        log(`[executor] navigation failed: ${(err as Error).message}`);
      }
    }

    await checkForRiskSignals(page);

    // Login wall check — runs once, fast. If detected, immediately route to
    // syndication instead of blocking on a manual login prompt. The public
    // syndication endpoint returns the same metadata for any tweet.
    const loginState = await detectLoginState(page);
    if (loginState === "loggedOut") {
      log("[executor] logged out — falling back to syndication");
      return await executeSyndicationOnly({
        postUrl,
        tweetId,
        handle,
        outputDir: inputs.output_dir,
        log,
        keepBrowser: browser,
        page,
      });
    }

    if (wantsArticle) {
      // X Note article URLs: wait for the article view; if it never renders
      // (e.g. page deleted), fall back to /status/.
      try {
        await page.waitForSelector('[data-testid="twitterArticleReadView"]', { timeout: 8000 });
      } catch {
        const statusUrl = `https://x.com/${handle}/status/${tweetId}`;
        if (page.url() !== statusUrl) {
          await page.goto(statusUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        }
      }
    }

    // Wait for tweet article to appear. If it never does (timeline view or
    // privacy wall), skip the live Chrome path and ask syndication instead.
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 8000 });
    } catch {
      log("[executor] tweet article never appeared — trying syndication");
      try {
        const snapshot = await fetchSyndicationTweet(tweetId);
        const noteDir = join(ensureAbsolutePath(inputs.output_dir ?? "~/Downloads/x"), tweetId);
        await ensureDir(noteDir);
        const files: string[] = [];
        const failed: Array<{ url: string; reason: string }> = [];
        let imageCount = 0;
        let videoCount = 0;
        const postType: PostType =
          snapshot.imageUrls.length > 0 || snapshot.videoUrls.length > 0 ? "withMedia" : "textOnly";
        if (snapshot.imageUrls.length > 0) {
          for (let i = 0; i < snapshot.imageUrls.length; i++) {
            const url = snapshot.imageUrls[i];
            const filename = `image_${String(i + 1).padStart(2, "0")}.jpg`;
            const filePath = join(noteDir, filename);
            try {
              const { data, ext } = await downloadMedia(
                `${url}${url.includes("?") ? "&" : "?"}name=orig`
              );
              const { data: clean } = await stripMetadata(data, ext);
              await writeFile(filePath, clean);
              files.push(filePath);
              imageCount++;
            } catch (err) {
              failed.push({ url, reason: (err as Error).message });
            }
          }
        }
        return await finalizeCapture({
          postUrl,
          tweetId,
          snapshot,
          postType,
          sourceLabel: "syndication",
          noteDir,
          files,
          failed,
          imageCount,
          videoCount,
          articleHtmlFile: undefined,
        });
      } catch (err) {
        throw new Error(
          `Could not render tweet ${tweetId} via Chrome and syndication failed: ${(err as Error).message}`
        );
      }
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
    return await finalizeCapture({
      postUrl,
      tweetId,
      snapshot,
      postType,
      sourceLabel: "live",
      noteDir,
      files,
      failed,
      imageCount,
      videoCount,
      articleHtmlFile,
    });
  } finally {
    if (!keepProcessAlive) {
      // Disconnect Playwright's CDP client so Node can exit. The external Chrome
      // process and profile stay alive for the next invocation.
      await browser.close().catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Syndication-only capture — used when the user isn't logged in (or when no
// Chrome is listening at the CDP port). Returns the same shape as the live
// capture path but writes images via direct Node fetch + sharp.
// ---------------------------------------------------------------------------
async function executeSyndicationOnly(args: {
  postUrl: string;
  tweetId: string;
  /** Reserved for downstream use; kept in signature so callers don't
   *  need to special-case this branch. */
  handle: string;
  outputDir?: string;
  log: (msg: string) => void;
  keepBrowser?: ChromiumBrowser;
  page?: Page;
}): Promise<DownloadPostResult> {
  const { postUrl, tweetId, outputDir, log, keepBrowser, page } = args;

  const snapshot = await fetchSyndicationTweet(tweetId);
  const postType: PostType =
    snapshot.imageUrls.length > 0 || snapshot.videoUrls.length > 0 ? "withMedia" : "textOnly";

  const noteDir = join(ensureAbsolutePath(outputDir ?? "~/Downloads/x"), tweetId);
  await ensureDir(noteDir);

  const files: string[] = [];
  const failed: Array<{ url: string; reason: string }> = [];
  let imageCount = 0;
  let videoCount = 0;

  if (snapshot.imageUrls.length > 0) {
    log(`[executor] downloading ${snapshot.imageUrls.length} image(s) via syndication`);
    for (let i = 0; i < snapshot.imageUrls.length; i++) {
      const url = snapshot.imageUrls[i];
      const filename = `image_${String(i + 1).padStart(2, "0")}.jpg`;
      const filePath = join(noteDir, filename);
      try {
        const { data, ext } = await downloadMedia(
          `${url}${url.includes("?") ? "&" : "?"}name=orig`
        );
        const { data: clean } = await stripMetadata(data, ext);
        await writeFile(filePath, clean);
        files.push(filePath);
        imageCount++;
        log(`[executor] saved ${filename} (${(clean.length / 1024).toFixed(0)}KB, exif-stripped)`);
      } catch (err) {
        failed.push({ url, reason: (err as Error).message });
        log(`[executor] image failed: ${(err as Error).message}`);
      }
    }
  }

  if (snapshot.videoUrls.length > 0) {
    log(`[executor] downloading ${snapshot.videoUrls.length} video(s) via syndication`);
    for (let i = 0; i < snapshot.videoUrls.length; i++) {
      const url = snapshot.videoUrls[i];
      const ext = /\.mp4(\?|$)/.test(url) ? "mp4" : "mp4";
      const filename = `video_${String(i + 1).padStart(2, "0")}.${ext}`;
      const filePath = join(noteDir, filename);
      try {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error(`http ${res.status}`);
        await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
        files.push(filePath);
        videoCount++;
      } catch (err) {
        failed.push({ url, reason: (err as Error).message });
      }
    }
  }

  // If the page is sitting on a logged-out redirect, navigate it back home
  // so we don't leave the user's tab on the login screen.
  if (page && keepBrowser) {
    try {
      if (/\/(login|onboarding|signin|signup|authorization)/.test(page.url())) {
        await page.goto("about:blank");
      }
    } catch {
      /* best effort */
    }
  }

  return finalizeCapture({
    postUrl,
    tweetId,
    snapshot,
    postType,
    sourceLabel: "syndication",
    noteDir,
    files,
    failed,
    imageCount,
    videoCount,
    articleHtmlFile: undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared finalizer — writes post.md and capture_source.json, returns the
// DownloadPostResult. Used by both the live Chrome path and the syndication
// fallback so downstream tooling sees a uniform shape.
// ---------------------------------------------------------------------------
async function finalizeCapture(args: {
  postUrl: string;
  tweetId: string;
  snapshot: TweetSnapshot;
  postType: PostType;
  sourceLabel: "live" | "syndication";
  noteDir: string;
  files: string[];
  failed: Array<{ url: string; reason: string }>;
  imageCount: number;
  videoCount: number;
  articleHtmlFile: string | undefined;
}): Promise<DownloadPostResult> {
  const {
    postUrl,
    tweetId,
    snapshot,
    sourceLabel,
    noteDir,
    files,
    failed,
    imageCount,
    videoCount,
    articleHtmlFile,
  } = args;

  const uniqueFiles = await dedupeByContent(files.map((path) => ({ path, url: "" })));

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

  // Sidecar so consumers can tell whether they got a logged-in MHTML or an
  // anonymous syndication fetch.
  await writeFile(
    join(noteDir, "capture_source.json"),
    JSON.stringify(
      {
        source: sourceLabel,
        captured_at: new Date().toISOString(),
        tweet_id: tweetId,
        ...(sourceLabel === "syndication" && {
          note: "captured anonymously via cdn.syndication.twimg.com; logged-in Chrome would yield additional engagement data and an MHTML archive",
        }),
      },
      null,
      2
    ),
    "utf-8"
  ).catch(() => undefined);

  return {
    output_dir: noteDir.replace(/\/[^/]+$/, ""),
    note_dir: noteDir,
    note_id: tweetId,
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
}
