import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { execFile, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import type { CDPSession, Page } from "playwright";

const execFileAsync = promisify(execFile);

export const DEFAULT_CDP_PORT = "9223";
export const DEFAULT_PROFILE_DIR = resolve(homedir(), ".chrome-labali-no-proxy");

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface DownloadArticleInputs {
  post_url?: string;
  output_dir?: string;
  profile_dir?: string;
  cdp_port?: string;
  timeout_ms?: number;
  overwrite?: boolean;
}

export interface ArticleSnapshot {
  title: string;
  author: string;
  accountName: string;
  publishedAt: string;
  digest: string;
  content: string;
  imageUrls: string[];
  coverImageUrl: string;
}

export interface DownloadFailure {
  url: string;
  error: string;
}

export interface DownloadArticleResult {
  output_dir: string;
  article_dir: string;
  article_id: string;
  article_url: string;
  publish_time: string;
  article_md_file: string;
  article_mhtml_file?: string;
  image_count: number;
  failed_count: number;
  failed: DownloadFailure[];
  files: string[];
}

// ---------------------------------------------------------------------------
// URL Parsing
// ---------------------------------------------------------------------------

export function parseArticleId(articleUrl: string): string {
  // Short form: https://mp.weixin.qq.com/s/HyIMBXw1GkqWJ5VlaH86rg
  const shortMatch = articleUrl.match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]+)/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }
  // Long form: https://mp.weixin.qq.com/s?__biz=...&mid=12345&idx=1&sn=...
  try {
    const url = new URL(articleUrl);
    const mid = url.searchParams.get("mid");
    const idx = url.searchParams.get("idx") || "1";
    if (mid) {
      return `${mid}_${idx}`;
    }
  } catch {
    // fallback
  }
  throw new Error(`Unable to parse article id from URL: ${articleUrl}`);
}

export function canonicalizeArticleUrl(articleUrl: string): string {
  return articleUrl.trim();
}

// ---------------------------------------------------------------------------
// String Utilities
// ---------------------------------------------------------------------------

export function sanitizeTitle(title: string): string {
  return title
    .replace(/[\\/:"*?<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function normalizePublishTime(input: string): string {
  const text = input.trim();
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  // Timestamp
  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const ms = text.length === 13 ? num : num * 1000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// FS Utilities
// ---------------------------------------------------------------------------

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function ensureAbsolutePath(inputPath: string): Promise<string> {
  if (inputPath.startsWith("~")) {
    return resolve(homedir(), inputPath.slice(2));
  }
  return resolve(inputPath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chrome / CDP Startup
// ---------------------------------------------------------------------------

export async function ensureChromeWithRemoteDebugging(
  cdpPort: string,
  profileDir: string
): Promise<void> {
  const versionUrl = `http://localhost:${cdpPort}/json/version`;
  try {
    const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "2", versionUrl]);
    if (stdout.includes("webSocketDebuggerUrl") || stdout.includes("Browser")) {
      return; // already running
    }
  } catch {
    // not running — launch
  }

  const resolvedProfile = profileDir.startsWith("~")
    ? resolve(homedir(), profileDir.slice(2))
    : profileDir;

  console.log(`[chrome] Launching Chrome with remote debugging on port ${cdpPort}...`);
  spawnSync("open", [
    "-na",
    "Google Chrome",
    "--args",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${resolvedProfile}`,
    "--no-proxy-server",
  ]);

  // Wait for Chrome to start
  await new Promise((r) => setTimeout(r, 3000));

  // Verify
  try {
    const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "5", versionUrl]);
    if (!stdout.includes("webSocketDebuggerUrl") && !stdout.includes("Browser")) {
      throw new Error("Chrome did not start with remote debugging enabled.");
    }
  } catch {
    throw new Error(
      `Chrome remote debugging is not responding on port ${cdpPort}. ` +
        `Please start Chrome manually:\n` +
        `open -na "Google Chrome" --args --remote-debugging-port=${cdpPort} --user-data-dir=${resolvedProfile} --no-proxy-server`
    );
  }
}

// ---------------------------------------------------------------------------
// Prompt Helper
// ---------------------------------------------------------------------------

export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// ---------------------------------------------------------------------------
// WeChat DOM Extraction
// ---------------------------------------------------------------------------

export async function extractArticleSnapshot(page: Page): Promise<ArticleSnapshot> {
  // Pass as string to avoid esbuild __name injection leaking into page context
  return page.evaluate(`(function extractWechatArticle() {
    var getText = function(selector) {
      var el = document.querySelector(selector);
      return el ? (el.textContent || "").trim() : "";
    };
    var getMeta = function(property) {
      var el = document.querySelector('meta[property="' + property + '"]');
      return el ? (el.content || "").trim() : "";
    };
    var title =
      getText("#activity-name") ||
      getText(".rich_media_title") ||
      getMeta("og:title") ||
      document.title;
    var accountName =
      getText("#js_name") ||
      getText(".account_nickname_inner") ||
      getMeta("og:site_name");
    var author = getText("#js_author_name") || getText(".author") || accountName;
    var publishedAt =
      getText("#publish_time") ||
      getText("em#publish_time") ||
      getMeta("article:published_time");
    var digest = getMeta("og:description");
    var coverImageUrl = getMeta("og:image");
    var contentEl = document.querySelector("#js_content");
    var content = contentEl ? (contentEl.textContent || "").replace(/\\s+/g, " ").trim() : "";
    var imageUrls = [];
    if (contentEl) {
      var imgs = contentEl.querySelectorAll("img");
      imgs.forEach(function(img) {
        var src = img.getAttribute("data-src") || img.getAttribute("src") || "";
        if (src && !src.startsWith("data:") && src.includes("mmbiz") && imageUrls.indexOf(src) === -1) {
          imageUrls.push(src);
        }
      });
    }
    return { title: title, author: author, accountName: accountName, publishedAt: publishedAt, digest: digest, content: content, imageUrls: imageUrls, coverImageUrl: coverImageUrl };
  })()`);
}

// ---------------------------------------------------------------------------
// MHTML Capture
// ---------------------------------------------------------------------------

/**
 * Scroll through the full article to trigger WeChat's lazy-loaded images
 * (data-src → src swap) before capturing MHTML.
 */
export async function triggerLazyImages(page: Page): Promise<void> {
  const totalHeight: number = await page.evaluate("document.body.scrollHeight") as number;
  const step = 400;
  let pos = 0;
  while (pos < totalHeight) {
    await page.evaluate((y: number) => window.scrollTo(0, y), pos);
    await page.waitForTimeout(120 + Math.random() * 80);
    pos += step;
  }
  // Scroll to bottom then back to top
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(500);
  // Wait for all images in #js_content to finish loading
  await page.evaluate(`(function() {
    var imgs = Array.from(document.querySelectorAll('#js_content img'));
    return Promise.all(imgs.map(function(img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve) {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));
  })()`).catch(() => undefined);
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(300);
}

export async function captureMhtml(page: Page): Promise<string> {
  const cdpSession: CDPSession = await page.context().newCDPSession(page);
  try {
    const { data } = await cdpSession.send(
      "Page.captureSnapshot",
      { withResources: true } as Record<string, unknown>
    );
    return data as string;
  } finally {
    await cdpSession.detach();
  }
}

// ---------------------------------------------------------------------------
// Image Download
// ---------------------------------------------------------------------------

export async function downloadImages(
  page: Page,
  imageUrls: string[],
  outputDir: string,
  overwrite: boolean
): Promise<{ saved: Array<{ path: string; url: string }>; failed: DownloadFailure[] }> {
  const saved: Array<{ path: string; url: string }> = [];
  const failed: DownloadFailure[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const idx = String(i + 1).padStart(2, "0");

    // Determine extension from URL or default to jpg
    let ext = extname(new URL(url).pathname).toLowerCase();
    if (!ext || ext.length > 5) {
      // Check wx_fmt query param
      const wxFmt = new URL(url).searchParams.get("wx_fmt");
      ext = wxFmt ? `.${wxFmt}` : ".jpg";
    }
    // Normalize webp
    if (ext === ".webp") ext = ".webp";

    const filename = `image_${idx}${ext}`;
    const filePath = resolve(outputDir, filename);

    if (!overwrite && (await fileExists(filePath))) {
      console.log(`[skip] ${filename} already exists`);
      saved.push({ path: filePath, url });
      continue;
    }

    try {
      // Use page.evaluate fetch — images are accessible since we're in an authenticated browser context
      const buffer = await page.evaluate(
        ([imgUrl]: [string]) =>
          fetch(imgUrl)
            .then((r) => {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.arrayBuffer();
            })
            .then((ab) => Array.from(new Uint8Array(ab))),
        [url]
      );

      await writeFile(filePath, Buffer.from(buffer));
      saved.push({ path: filePath, url });
      console.log(`[image] saved ${filename} (${buffer.length} bytes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[image] failed ${filename}: ${msg}`);
      failed.push({ url, error: msg });
    }

    // Small delay between downloads
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
  }

  return { saved, failed };
}

// ---------------------------------------------------------------------------
// Markdown Writer
// ---------------------------------------------------------------------------

export async function writeArticleMarkdown(
  filePath: string,
  snapshot: ArticleSnapshot,
  articleUrl: string,
  imageFiles: Array<{ path: string; url: string }>,
  outputDir: string
): Promise<void> {
  const lines: string[] = [];

  lines.push(`# ${snapshot.title}`);
  lines.push("");
  lines.push(`**公众号：** ${snapshot.accountName}`);
  if (snapshot.author && snapshot.author !== snapshot.accountName) {
    lines.push(`**作者：** ${snapshot.author}`);
  }
  if (snapshot.publishedAt) {
    lines.push(`**发布时间：** ${snapshot.publishedAt}`);
  }
  lines.push(`**来源：** ${articleUrl}`);
  if (snapshot.digest) {
    lines.push("");
    lines.push(`> ${snapshot.digest}`);
  }
  lines.push("");

  if (imageFiles.length > 0) {
    lines.push("## 图片");
    lines.push("");
    for (const { path } of imageFiles) {
      const filename = path.split("/").pop() || path;
      lines.push(`![${filename}](./${filename})`);
    }
    lines.push("");
  }

  if (snapshot.content) {
    lines.push("## 正文");
    lines.push("");
    lines.push(snapshot.content);
    lines.push("");
  }

  await writeFile(filePath, lines.join("\n"), "utf-8");
}
