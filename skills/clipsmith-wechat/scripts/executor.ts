import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_PROFILE_DIR,
  parseArticleId,
  canonicalizeArticleUrl,
  ensureChromeWithRemoteDebugging,
  ensureAbsolutePath,
  ensureDir,
  captureMhtml,
  triggerLazyImages,
  extractArticleSnapshot,
  downloadImages,
  normalizePublishTime,
  sanitizeTitle,
  writeArticleMarkdown,
  type DownloadArticleInputs,
  type DownloadArticleResult,
} from "./core.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ExecutorContext {
  logger?: (message: string) => void;
  prompt?: (message: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

async function promptInteractive(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// ---------------------------------------------------------------------------
// Folder name
// ---------------------------------------------------------------------------

function buildFolderName(downloadDate: string, title: string, articleId: string): string {
  const safeTitle = sanitizeTitle(title);
  if (safeTitle) {
    return `${downloadDate}-${safeTitle}-${articleId}`;
  }
  return `${downloadDate}-${articleId}`;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function execute(
  inputs: DownloadArticleInputs,
  ctx: ExecutorContext = {}
): Promise<DownloadArticleResult> {
  const log = ctx.logger ?? console.log;

  // --- Resolve inputs ---
  let postUrl = inputs.post_url?.trim() || "";
  if (!postUrl) {
    postUrl = await promptInteractive("WeChat article URL: ");
  }
  if (!postUrl) {
    throw new Error("post_url is required");
  }

  const rawOutputDir = inputs.output_dir?.trim() || "~/Downloads/wechat";
  const outputDir = await ensureAbsolutePath(rawOutputDir);
  const cdpPort = (inputs.cdp_port ?? DEFAULT_CDP_PORT).trim();
  const profileDir = inputs.profile_dir?.trim() || String(DEFAULT_PROFILE_DIR);
  const timeoutMs = inputs.timeout_ms ?? 60000;
  const overwrite = inputs.overwrite ?? false;

  log(`[wechat] article URL: ${postUrl}`);
  log(`[wechat] output dir: ${outputDir}`);

  // --- Start Chrome ---
  await ensureChromeWithRemoteDebugging(cdpPort, profileDir);

  // --- Connect via CDP ---
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const contexts = browser.contexts();
  const browserCtx = contexts[0] ?? (await browser.newContext());

  // Find or open WeChat tab
  let page = browserCtx.pages().find((p) => {
    try { const h = new URL(p.url()).hostname; return h.endsWith(".mp.weixin.qq.com") || h === "mp.weixin.qq.com"; } catch { return false; }
  }) ?? null;
  if (!page) {
    page = await browserCtx.newPage();
    log("[wechat] opened new tab");
  } else {
    log("[wechat] reusing existing WeChat tab");
  }

  // Navigate to article
  log(`[wechat] navigating to ${postUrl}`);
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  // --- Extract article snapshot ---
  log("[wechat] extracting article content...");
  const snapshot = await extractArticleSnapshot(page);

  log(`[wechat] title: ${snapshot.title}`);
  log(`[wechat] account: ${snapshot.accountName}`);
  log(`[wechat] published: ${snapshot.publishedAt}`);
  log(`[wechat] images found: ${snapshot.imageUrls.length}`);

  // --- Resolve article ID ---
  const articleId = parseArticleId(postUrl);

  // --- Build output folder ---
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const publishTime = normalizePublishTime(snapshot.publishedAt) || "unknown";
  const folderName = buildFolderName(today, snapshot.title, articleId);

  const articleDir = resolve(outputDir, folderName);
  await ensureDir(articleDir);
  log(`[wechat] output folder: ${articleDir}`);

  // --- Download images ---
  const { saved: imageFiles, failed } = await downloadImages(
    page,
    snapshot.imageUrls,
    articleDir,
    overwrite
  );

  // --- Capture MHTML ---
  log("[wechat] scrolling to trigger lazy-loaded images...");
  await triggerLazyImages(page);
  log("[wechat] capturing MHTML...");
  const mhtmlPath = resolve(articleDir, "article.mhtml");
  try {
    const mhtmlContent = await captureMhtml(page);
    await writeFile(mhtmlPath, mhtmlContent, "utf-8");
    log(`[wechat] wrote ${mhtmlPath}`);
  } catch (err) {
    log(`[wechat] MHTML capture failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  // --- Write article.md ---
  const mdPath = resolve(articleDir, "article.md");
  await writeArticleMarkdown(mdPath, snapshot, canonicalizeArticleUrl(postUrl), imageFiles, articleDir);
  log(`[wechat] wrote ${mdPath}`);

  const mhtmlExists = await import("node:fs/promises").then((fs) =>
    fs.access(mhtmlPath).then(() => true).catch(() => false)
  );
  const files = [
    ...(mhtmlExists ? [mhtmlPath] : []),
    mdPath,
    ...imageFiles.map((f) => f.path),
  ];

  return {
    output_dir: outputDir,
    article_dir: articleDir,
    article_id: articleId,
    article_url: postUrl,
    publish_time: publishTime,
    article_md_file: mdPath,
    article_mhtml_file: mhtmlExists ? mhtmlPath : undefined,
    image_count: imageFiles.length,
    failed_count: failed.length,
    failed,
    files,
  };
}
