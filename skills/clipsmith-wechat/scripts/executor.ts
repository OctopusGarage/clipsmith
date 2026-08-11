import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_PROFILE_DIR,
  parseArticleId,
  canonicalizeArticleUrl,
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
import { defaultBrowserMode, openBrowserSession } from "./browser-session.js";
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
  const bundleDir = inputs.bundle_dir?.trim()
    ? await ensureAbsolutePath(inputs.bundle_dir.trim())
    : undefined;
  const cdpPort = (inputs.cdp_port ?? DEFAULT_CDP_PORT).trim();
  const profileDir = inputs.profile_dir?.trim() || String(DEFAULT_PROFILE_DIR);
  const timeoutMs = inputs.timeout_ms ?? 60000;
  const overwrite = inputs.overwrite ?? false;

  log(`[wechat] article URL: ${postUrl}`);
  log(`[wechat] output dir: ${outputDir}`);
  if (bundleDir) log(`[wechat] bundle dir: ${bundleDir}`);

  const browserMode = defaultBrowserMode(inputs.browser_mode);
  if (browserMode !== "cdp") {
    await ensureDir(profileDir);
  }
  const session = await openBrowserSession({
    mode: browserMode,
    profileDir,
    cdpPort,
    keepOpen: inputs.keep_open ?? false,
    slowMo: inputs.slow_mo_ms,
    log,
  });

  try {
    const browserCtx = session.context;

    // Find or open WeChat tab
    let page = browserCtx.pages().find((p) => {
      try {
        const h = new URL(p.url()).hostname;
        return h.endsWith(".mp.weixin.qq.com") || h === "mp.weixin.qq.com";
      } catch {
        return false;
      }
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
    // Three modes:
    //   (1) --bundle-dir was passed: write into that exact path as a raw dir;
    //       `clipsmith normalize raw` will rewrite it in-place at the end. Skip
    //       the YYYYMMDD-prefix wrapping, because the caller already chose the
    //       destination name (e.g. inbox/wechat/wechat-<id>/).
    //   (2) Default: write into <output_dir>/YYYYMMDD-<title>-<id>/.
    //   (3) Output dir = bundle dir: same as (2); caller gets a raw download.
    // In bundle mode the MHTML is dropped (out of bundle scope per normalizer).
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const publishTime = normalizePublishTime(snapshot.publishedAt) || "unknown";

    let articleDir: string;
    let mhtmlEnabled: boolean;
    if (bundleDir) {
      articleDir = bundleDir;
      mhtmlEnabled = false; // bundles don't carry MHTML
    } else {
      const folderName = buildFolderName(today, snapshot.title, articleId);
      articleDir = resolve(outputDir, folderName);
      mhtmlEnabled = true;
    }
    await ensureDir(articleDir);
    log(`[wechat] output folder: ${articleDir}`);

    // --- Download images ---
    const { saved: imageFiles, failed } = await downloadImages(
      page,
      snapshot.imageUrls,
      articleDir,
      overwrite
    );

    // --- Capture MHTML (raw mode only; bundles don't carry MHTML) ---
    let mhtmlPath: string | undefined;
    if (mhtmlEnabled) {
      log("[wechat] scrolling to trigger lazy-loaded images...");
      await triggerLazyImages(page);
      log("[wechat] capturing MHTML...");
      mhtmlPath = resolve(articleDir, "article.mhtml");
      try {
        const mhtmlContent = await captureMhtml(page);
        await writeFile(mhtmlPath, mhtmlContent, "utf-8");
        log(`[wechat] wrote ${mhtmlPath}`);
      } catch (err) {
        log(`[wechat] MHTML capture failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        mhtmlPath = undefined;
      }
    }

    // --- Write article.md ---
    const mdPath = resolve(articleDir, "article.md");
    await writeArticleMarkdown(mdPath, snapshot, canonicalizeArticleUrl(postUrl), imageFiles, articleDir);
    log(`[wechat] wrote ${mdPath}`);

    const mhtmlExists = mhtmlPath
      ? await import("node:fs/promises").then((fs) =>
          fs.access(mhtmlPath!).then(() => true).catch(() => false)
        )
      : false;
    const files = [
      ...(mhtmlExists && mhtmlPath ? [mhtmlPath] : []),
      mdPath,
      ...imageFiles.map((f) => f.path),
    ];

    // --- Normalize raw → bundle ---
    // When --bundle-dir is set, run `clipsmith normalize raw wechat` to convert
    // this raw folder into a proper capture bundle (capture.json, post.md,
    // summary.md, assets/). The normalize step accepts raw_dir == bundle_dir.
    if (bundleDir) {
      try {
        await runClipsmithNormalize({
          provider: "wechat",
          rawDir: articleDir,
          bundleDir,
          sourceUrl: postUrl,
          canonicalUrl: canonicalizeArticleUrl(postUrl),
          title: snapshot.title,
          author: snapshot.accountName
            ? `${snapshot.accountName}${snapshot.author && snapshot.author !== snapshot.accountName ? ` / ${snapshot.author}` : ""}`
            : snapshot.author,
          publishedAt: normalizePublishTime(snapshot.publishedAt),
          capturedAt: new Date().toISOString(),
          overwrite,
          log,
        });
        log(`[wechat] bundle written → ${bundleDir}`);
      } catch (err) {
        log(`[wechat] normalize failed: ${err instanceof Error ? err.message : err}`);
        throw err;
      }
    }

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
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// `clipsmith normalize` runner — invoked when --bundle-dir is set so the skill
// does the full ingest in one call instead of producing a raw download and
// leaving callers to run a second command.
// ---------------------------------------------------------------------------
async function runClipsmithNormalize(args: {
  provider: string;
  rawDir: string;
  bundleDir: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  author: string;
  publishedAt: string;
  capturedAt: string;
  overwrite: boolean;
  log: (msg: string) => void;
}): Promise<void> {
  const cliArgs = [
    "normalize", "raw",
    args.provider,
    args.rawDir,
    args.bundleDir,
    "--source-url", args.sourceUrl,
    "--canonical-url", args.canonicalUrl,
    "--title", args.title,
    "--author", args.author,
    "--published-at", args.publishedAt,
    "--captured-at", args.capturedAt,
    "--status", "complete",
  ];
  if (args.overwrite) cliArgs.push("--overwrite");
  cliArgs.push("--json");

  await new Promise<void>((resolveP, rejectP) => {
    // `uv run` keeps the existing toolchain-driven workflow instead of
    // requiring clipsmith to be on PATH directly.
    const child = spawn("uv", ["run", "clipsmith", ...cliArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (chunk) => args.log(`[normalize] ${String(chunk).trim()}`));
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", rejectP);
    child.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`clipsmith normalize exited ${code}: ${stderr.trim()}`));
    });
  });
}
