import { type Page, CDPSession } from "playwright";
import { writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const DEFAULT_CDP_PORT = "9222";
export const DEFAULT_PROFILE_DIR = "~/.chrome-labali";

// ---------------------------------------------------------------------------
// UI Cleanup Selectors for Archive
// ---------------------------------------------------------------------------

// 所有帖子类型通用：页面级外部干扰元素（header、sidebar、BottomBar 等）
const EXTERNAL_CLEANUP_SELECTORS = [
  // 登录/注册
  '[data-testid="LoginForm"]',
  'a[href*="/login"]',
  'a[href*="/i/flow/signup"]',
  '[data-testid="signup"]',
  '[data-testid="signin"]',
  // 顶部导航栏
  'header[role="banner"]',
  'nav[role="navigation"]',
  // 分享/互动按钮栏（普通推文外层）
  '[data-testid="tweetButtonInline"]',
  '[data-testid="app-bar-close"]',
  '[data-testid="app-bar"]',
  // 右侧推荐/趋势栏
  '[data-testid="sidebarColumn"]',
  '[aria-label*="Who to follow"]',
  '[aria-label*="Trending"]',
  // X Notes 顶部工具栏
  '[data-testid="twitterArticleTopBar"]',
  // 底部粘贴区域
  '[data-testid="postRTCover"]',
  // 底部提示（登录后可评论等）
  '[data-testid="loginPrompt"]',
  // 底部横幅（Don't miss what's happening / People on X are the first to know）
  '[data-testid="BottomBar"]',
];

// 仅 X Note 帖子内部需清理的元素（普通推文不清理 article 内部）
const ARTICLE_INTERNAL_CLEANUP_SELECTORS = [
  // 作者区（头像 + 昵称 + Follow 按钮 + 发布时间）
  '[data-testid="twitterArticleReadView"] [class*="r-1cmwbt1"]',
  // 互动统计栏（点赞/转发/回复数）
  '[data-testid="twitterArticleReadView"] [aria-label*="replies"]',
  // Upgrade to Premium 提示
  '[data-testid="twitterArticleReadView"] [role="status"]',
  // 分隔线
  '[data-testid="twitterArticleReadView"] [role="separator"]',
  // 推荐用户
  '[data-testid="twitterArticleReadView"] [data-testid="UserCell"]',
];

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------
export interface DownloadPostInputs {
  post_url?: string;
  output_dir?: string;
  profile_dir?: string;
  cdp_port?: string;
  timeout_ms?: number;
  overwrite?: boolean;
}

export interface TweetSnapshot {
  tweetId: string;
  authorHandle: string;
  authorName: string;
  text: string;
  publishedAt: string;
  likeCount: string;
  retweetCount: string;
  replyCount: string;
  imageUrls: string[];
  videoUrls: string[];
  /** True when the post is an X Note (long-form article) */
  isArticle: boolean;
  /** Article title for X Notes; empty for regular tweets */
  articleTitle: string;
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
// Step 1: UI Cleanup
// ---------------------------------------------------------------------------

/**
 * 页面清理：删除与帖子内容无关的 UI 元素，以便生成干净的存档。
 *
 * @param page       Playwright Page 实例
 * @param postType   'article' | 'withMedia' | 'textOnly'
 *                   - article:    清理外部元素 + article 内部元素
 *                   - withMedia:  仅清理外部元素（不清理普通推文 article 内部）
 *                   - textOnly:   不需要清理（MHTML 不生成）
 */
export async function cleanupPageForArchive(page: Page, postType: string): Promise<void> {
  // 始终清理外部干扰元素
  for (const selector of EXTERNAL_CLEANUP_SELECTORS) {
    const count = await page.evaluate((sel) => {
      const els = document.querySelectorAll(sel);
      els.forEach((el) => el.remove());
      return els.length;
    }, selector);
    if (count > 0) {
      console.log(`[cleanup] removed ${count}x "${selector}"`);
    }
  }
  // 仅 X Note（article）需要额外清理 article 内部元素
  if (postType === "article") {
    for (const selector of ARTICLE_INTERNAL_CLEANUP_SELECTORS) {
      const count = await page.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        els.forEach((el) => el.remove());
        return els.length;
      }, selector);
      if (count > 0) {
        console.log(`[cleanup] removed ${count}x "${selector}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: CDP Page.captureSnapshot MHTML 捕获
// ---------------------------------------------------------------------------

/**
 * 使用 CDP Page.captureSnapshot 命令生成 MHTML 格式的页面快照。
 * 包含所有内联资源（图片、CSS、字体），可直接在浏览器中打开。
 *
 * @param page  Playwright Page 实例
 * @param sourceUrl  Content-Location 中使用的原始 URL
 * @returns MHTML 字符串
 */
export async function captureMhtml(page: Page, sourceUrl: string): Promise<string> {
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

/**
 * 将 MHTML 内容写入文件。
 */
export async function saveMhtmlToFile(mhtmlContent: string, filePath: string): Promise<void> {
  await writeFile(filePath, mhtmlContent, "utf-8");
}

// ---------------------------------------------------------------------------
// Step 3: 从 MHTML 提取 base64 图片
// ---------------------------------------------------------------------------

export interface MhtmlImage {
  path: string;
  contentType: string;
}

/**
 * 从 MHTML 内容中提取所有内嵌的 base64 图片，保存到指定目录。
 * 返回保存的文件路径和 content-type 列表。
 *
 * Chrome CDP Page.captureSnapshot 输出的 MHTML 图片部分格式：
 *   Content-Type: image/xxx\r\n
 *   Content-Transfer-Encoding: base64\r\n
 *   Content-Location: <url>\r\n
 *   \r\n
 *   <base64 data>
 */
export async function extractMhtmlImages(
  mhtmlContent: string,
  noteDir: string
): Promise<MhtmlImage[]> {
  const extracted: MhtmlImage[] = [];
  // Chrome CDP MHTML 图片格式：Content-Type → Content-Transfer-Encoding → Content-Location → \r\n\r\n → base64 → \r\n------boundary
  const imagePartRegex =
    /Content-Type: (image\/[^\r\n]+)\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ([^\r\n]+)\r\n\r\n([A-Za-z0-9+\/=\r\n]+?)(?=\r\n------)/gs;
  let idx = 1;
  let match;
  while ((match = imagePartRegex.exec(mhtmlContent)) !== null) {
    const contentType = match[1].trim();
    const contentLocation = match[2].trim();
    const isImage = /^image\//.test(contentType);
    const isFont = /^font\//.test(contentType);
    if (isImage && !isFont) {
      const base64 = match[3].replace(/\r?\n/g, "");
      try {
        const buf = Buffer.from(base64, "base64");
        const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
        const fileName = `image_${String(idx).padStart(2, "0")}.${ext}`;
        const filePath = join(noteDir, fileName);
        await writeFile(filePath, buf);
        extracted.push({ path: filePath, contentType });
        idx++;
      } catch {
        /* skip bad base64 */
      }
    }
  }
  return extracted;
}

// ---------------------------------------------------------------------------
// Utility: Path helpers
// ---------------------------------------------------------------------------
export function ensureAbsolutePath(value: string): string {
  const home = process.env.HOME ?? "";
  if (value.startsWith("~/")) return join(home, value.slice(2));
  if (value.startsWith("./") || value === ".") return join(process.cwd(), value.slice(value.length === 1 ? 1 : 2));
  return value;
}

export async function ensureDir(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
}

// ---------------------------------------------------------------------------
// Utility: Chrome startup
// ---------------------------------------------------------------------------
export async function ensureChromeWithRemoteDebugging(
  cdpPort: string,
  profileDir: string,
  log: (msg: string) => void,
  proxyMode?: string,
  proxyServer?: string
): Promise<void> {
  const absProfile = ensureAbsolutePath(profileDir);
  await ensureDir(absProfile);

  try {
    const resp = await fetch(`http://localhost:${cdpPort}/json/version`);
    if (resp.ok) {
      log(`CDP already responding on :${cdpPort}`);
      return;
    }
  } catch {
    // Not running
  }

  log(`launching Chrome with remote debugging on :${cdpPort}`);
  const args = [
    "-na", "Google Chrome",
    "--args",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${absProfile}`,
    ...(proxyMode === "system" ? [] : ["--no-proxy-server"]),
    ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
  ];
  spawn("open", args, { detached: true, stdio: "ignore" });
  await wait(3000);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`http://localhost:${cdpPort}/json/version`);
      if (resp.ok) {
        log(`Chrome ready on :${cdpPort}`);
        return;
      }
    } catch {
      await wait(2000);
    }
  }
  throw new Error(`Chrome did not start on CDP port ${cdpPort} after 3 attempts.`);
}

// ---------------------------------------------------------------------------
// Utility: Risk signal detection
// ---------------------------------------------------------------------------
export async function checkForRiskSignals(page: Page): Promise<void> {
  const bodyText = await page.evaluate(() => document.body.innerText);
  const signals = ["captcha", "unusual login", "account locked", "rate limit"];
  for (const signal of signals) {
    if (bodyText.toLowerCase().includes(signal)) {
      throw new Error(`Risk signal detected: ${signal}. Stopping.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: Login required detection
// ---------------------------------------------------------------------------
export async function isLoginRequired(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("login") || url.includes("authorization")) return true;
  // If we have tweet content, user is already logged in (or content is public)
  const hasTweet = await page.$('article[data-testid="tweet"]');
  if (hasTweet) return false;
  const hasArticle = await page.$('[data-testid="twitterArticleReadView"]');
  if (hasArticle) return false;
  // No content visible — check if body is a clear login/auth wall (not just nav text)
  const bodyText = await page.evaluate(() => document.body.innerText);
  // True login wall: body is mostly empty except auth UI
  const isLoginWall =
    bodyText.includes("Log in") &&
    bodyText.includes("Sign up") &&
    bodyText.length < 500;
  return isLoginWall;
}

export async function waitForManualLogin(
  page: Page,
  reason: string
): Promise<void> {
  // In non-interactive mode (stdin not available), throw an error instead of hanging
  if (!process.stdin?.isTTY) {
    throw new Error(
      `${reason}. Please log in to X in the Chrome window, then re-run the script.`
    );
  }
  const { createInterface } = await import("node:readline/promises");
  const iface = createInterface({ input: process.stdin, output: process.stdin });
  try {
    await iface.question(`${reason} — please log in, then press Enter here: `);
  } finally {
    iface.close();
  }
  // Wait for content to actually appear after login
  for (let i = 0; i < 30; i++) {
    const contentFound = await page.evaluate(() => {
      return !!(
        document.querySelector('[data-testid="twitterArticleReadView"]') ||
        document.querySelector('article[data-testid="tweet"]')
      );
    });
    if (contentFound) return;
    await wait(1000);
  }
  throw new Error("Login did not complete — tweet content not detected after 30s");
}

// ---------------------------------------------------------------------------
// Utility: URL helpers
// ---------------------------------------------------------------------------
export function parseTweetId(url: string): string {
  // Matches /status/123456789, /i/status/123456789, or /article/123456789
  const match = url.match(/\/(?:status|article)\/(\d+)/);
  if (match) return match[1];
  throw new Error(`Cannot extract tweet ID from URL: ${url}`);
}

export function canonicalizePostUrl(url: string): string {
  // Normalize to x.com, strip query params for canonical form
  return url
    .replace(/https?:\/\/(www\.)?twitter\.com/, "https://x.com")
    .replace(/\?.*$/, "");
}

/** Extract username from URL like https://x.com/karminski3/status/... or /article/... */
export function extractHandleFromUrl(url: string): string {
  const match = url.match(/https?:\/\/x\.com\/([A-Za-z0-9_]+)\/(?:status|article)\//);
  if (!match) throw new Error(`Cannot extract handle from URL: ${url}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Utility: Title sanitization (no title for tweets, just tweet ID)
// ---------------------------------------------------------------------------
export function sanitizeTitle(_title: string): string {
  return "";
}

export function normalizePublishTime(ts: string): string {
  if (!ts) return "";
  try {
    return new Date(ts).toISOString();
  } catch {
    return ts;
  }
}

// ---------------------------------------------------------------------------
// Utility: Media identity (path + query for dedup)
// ---------------------------------------------------------------------------
export function mediaUrlIdentity(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Extraction: Tweet snapshot
// ---------------------------------------------------------------------------
export async function extractTweetSnapshot(page: Page, tweetId: string): Promise<TweetSnapshot> {
  // Article pages use twitterArticleReadView; tweet pages use article[data-testid="tweet"]
  const isArticle = await page.evaluate(
    () => !!document.querySelector('[data-testid="twitterArticleReadView"]')
  );
  if (!isArticle) {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
  }

  const snapshot = await page.evaluate((id: string) => {
    const isArticlePage = !!document.querySelector('[data-testid="twitterArticleReadView"]');
    // On tweet pages the article is article[data-testid="tweet"]; on article pages it's the read view container
    const tweetArticle = document.querySelector(
      'article[data-testid="tweet"]'
    ) as HTMLElement;
    const article =
      (tweetArticle as HTMLElement) ??
      (document.querySelector('[data-testid="twitterArticleReadView"]') as HTMLElement);
    if (!article) return null;

    // ---- Author ----
    let name = "";
    const userNameEl = document.querySelector('[data-testid="User-Name"]');
    const nameSpans = userNameEl?.querySelectorAll("span") ?? [];
    if (nameSpans.length > 0) name = nameSpans[0].textContent?.trim() ?? "";
    // Handle from URL
    const handle = (() => {
      const m = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/status\//);
      if (m) return m[1];
      const m2 = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/article\//);
      if (m2) return m2[1];
      return "";
    })();

    // ---- Time ----
    let publishedAt = "";
    const timeEl =
      tweetArticle?.querySelector("time") ??
      document.querySelector('[data-testid="twitterArticleReadView"] time');
    if (timeEl) publishedAt = timeEl.getAttribute("datetime") ?? "";

    // ---- Engagement (only on tweet pages, not article pages) ----
    let likeCount = "0",
      retweetCount = "0",
      replyCount = "0";
    if (tweetArticle) {
      const likeEl = tweetArticle.querySelector('[data-testid="like"] span');
      const retweetEl = tweetArticle.querySelector('[data-testid="retweet"] span');
      const replyEl = tweetArticle.querySelector('[data-testid="reply"] span');
      likeCount = likeEl?.textContent?.trim() ?? "0";
      retweetCount = retweetEl?.textContent?.trim() ?? "0";
      replyCount = replyEl?.textContent?.trim() ?? "0";
    }

    // ---- Images (from tweet article on tweet pages; from read view on article pages) ----
    const imageUrls: string[] = [];
    const photoContainer = (tweetArticle ?? article) as HTMLElement;
    const photoEls = photoContainer.querySelectorAll('[data-testid="tweetPhoto"]');
    photoEls.forEach((el) => {
      const bgStyle = (el as HTMLElement).style?.backgroundImage;
      let src: string | null = null;
      if (bgStyle && bgStyle.includes("url(")) {
        const match = bgStyle.match(/url\(["']?([^"')]+)["']?\)/);
        if (match) src = match[1];
      } else {
        const img = el.querySelector("img") as HTMLImageElement | null;
        src = img?.src ?? null;
        const srcset = img?.getAttribute("srcset");
        if (srcset) {
          const parts = srcset.split(",").map((p) => p.trim().split(" "));
          const highest = parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0];
          if (highest?.[0]) src = highest[0];
        }
      }
      if (src && !src.includes("profile_images") && !src.includes("default_profile")) {
        imageUrls.push(src);
      }
    });

    // ---- Video ----
    const videoUrls: string[] = [];
    if (tweetArticle) {
      const videoEl = tweetArticle.querySelector("video");
      if (videoEl) {
        const src = (videoEl as HTMLVideoElement).src;
        if (src) videoUrls.push(src);
      }
      const videoLink = tweetArticle.querySelector('a[href*="/video/"]');
      if (videoLink) {
        const href = videoLink.getAttribute("href") ?? "";
        if (href && !videoUrls.includes(href)) videoUrls.push(`https://x.com${href}`);
      }
    }

    // ---- Text ----
    let articleTitle = "";
    if (isArticlePage) {
      articleTitle =
        document.querySelector('[data-testid="twitter-article-title"]')?.textContent?.trim() ?? "";
      const richTextEl = document.querySelector('[data-testid="longformRichTextComponent"]');
      if (richTextEl) return { tweetId: id, authorHandle: handle, authorName: name, text: richTextEl.textContent?.trim() ?? "", tcoHrefs: [], publishedAt, likeCount, retweetCount, replyCount, imageUrls, videoUrls, isArticle: isArticlePage, articleTitle };
    }

    // Collect tweet text and t.co shortlinks — resolve them from the Node.js side
    // (browser CSP blocks cross-origin fetch in page.evaluate)
    const tcoHrefs: string[] = [];
    const textEl = tweetArticle?.querySelector('[data-testid="tweetText"]');
    if (textEl) {
      Array.from(textEl.querySelectorAll("a")).forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        if (href) tcoHrefs.push(href);
      });
    }
    const tweetText = textEl?.textContent?.trim() ?? "";

    return { tweetId: id, authorHandle: handle, authorName: name, text: tweetText, tcoHrefs, publishedAt, likeCount, retweetCount, replyCount, imageUrls, videoUrls, isArticle: isArticlePage, articleTitle };
  }, tweetId);

  if (!snapshot) {
    throw new Error(`Failed to extract tweet snapshot for ${tweetId}`);
  }

  // Resolve t.co shortlinks from the Node.js side (browser CSP blocks fetch)
  const tcoMap: Record<string, string> = {};
  for (const href of snapshot.tcoHrefs ?? []) {
    if (href.startsWith("https://t.co/") && !tcoMap[href]) {
      try {
        const resp = await fetch(href, { redirect: "follow" });
        tcoMap[href] = resp.url;
      } catch {
        tcoMap[href] = href;
      }
    }
  }

  // If the snapshot text still contains t.co shortlinks as text, replace them
  let text = snapshot.text ?? "";
  if (Object.keys(tcoMap).length > 0) {
    // Reconstruct text: scan the original tweet DOM to replace each anchor's
    // textContent with the resolved URL, then extract full text.
    const page2 = page;
    text = await page2.evaluate(
      (params: { tcoMap: Record<string, string>; tweetId: string }) => {
        const tweetArticle = document.querySelector(
          'article[data-testid="tweet"]'
        ) as HTMLElement | null;
        const textEl = tweetArticle?.querySelector(
          '[data-testid="tweetText"]'
        ) as HTMLElement | null;
        if (!textEl) return "";
        Array.from(textEl.querySelectorAll("a")).forEach((a) => {
          const href = a.getAttribute("href") ?? "";
          const resolved = params.tcoMap[href];
          if (resolved) a.textContent = resolved;
        });
        return textEl.textContent?.trim() ?? "";
      },
      { tcoMap, tweetId }
    );
  }

  return {
    ...snapshot,
    text,
  };
}

// ---------------------------------------------------------------------------
// Image download via browser cache fetch
// ---------------------------------------------------------------------------
export async function browseAndCaptureImages(
  page: Page,
  imageUrls: string[],
  noteDir: string,
  overwrite: boolean
): Promise<{
  saved: Array<{ path: string; url: string }>;
  failed: Array<{ url: string; reason: string }>;
}> {
  const saved: Array<{ path: string; url: string }> = [];
  const failed: Array<{ url: string; reason: string }> = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const ext = getExt(url, "jpg");
    const filename = `image_${String(i + 1).padStart(2, "0")}.${ext}`;
    const filePath = join(noteDir, filename);

    if (!overwrite) {
      try {
        await stat(filePath);
        saved.push({ path: filePath, url });
        continue;
      } catch {
        /* skip */
      }
    }

    try {
      // Use Uint8Array inside evaluate() so Playwright can serialize it
      // (ArrayBuffer gets mangled by JSON serialization and can't be Buffer.from()'d)
      const uint8 = await page.evaluate(async (imgUrl: string) => {
        const resp = await fetch(imgUrl, { cache: "force-cache" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ab = await resp.arrayBuffer();
        return Array.from(new Uint8Array(ab));
      }, url);
      await writeFile(filePath, Buffer.from(uint8));
      saved.push({ path: filePath, url });
    } catch (err) {
      failed.push({ url, reason: String(err) });
    }
  }

  return { saved, failed };
}

// ---------------------------------------------------------------------------
// Video download
// ---------------------------------------------------------------------------
export async function downloadVideos(
  page: Page,
  videoUrls: string[],
  noteDir: string,
  overwrite: boolean
): Promise<{
  saved: Array<{ path: string; url: string }>;
  failed: Array<{ url: string; reason: string }>;
}> {
  const saved: Array<{ path: string; url: string }> = [];
  const failed: Array<{ url: string; reason: string }> = [];

  const filename = "video.mp4";
  const filePath = join(noteDir, filename);

  if (!overwrite) {
    try {
      await stat(filePath);
      saved.push({ path: filePath, url: videoUrls[0] ?? "" });
      return { saved, failed };
    } catch {
      /* skip */
    }
  }

  if (videoUrls.length === 0) return { saved, failed };

  const url = videoUrls[0];
  try {
    const apiResp = await page.request.get(url);
    const blob = await apiResp.body();
    // Node.js Blob exposes `.buffer` as a synchronous ArrayBufferLike property (not a Promise method)
    const rawBuffer: ArrayBuffer =
      blob != null
        ? (blob.buffer as unknown as ArrayBuffer)
        : new ArrayBuffer(0);
    await writeFile(filePath, new Uint8Array(rawBuffer));
    saved.push({ path: filePath, url });
  } catch (err) {
    failed.push({ url, reason: String(err) });
  }

  return { saved, failed };
}

export async function simulateVideoPlay(page: Page): Promise<void> {
  try {
    const videoEl = await page.$("article video");
    if (!videoEl) return;
    await videoEl.scrollIntoViewIfNeeded();
    await videoEl.click();
    await wait(3000 + Math.random() * 2000);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Post markdown writer
// ---------------------------------------------------------------------------
export async function writePostMarkdown(opts: {
  noteDir: string;
  sourceUrl: string;
  title: string;
  text: string;
  publishedAt: string;
  authorHandle?: string;
  authorName?: string;
  likeCount?: string;
  retweetCount?: string;
  replyCount?: string;
}): Promise<string> {
  const meta: string[] = [];
  if (opts.authorHandle) meta.push(`@${opts.authorHandle}`);
  if (opts.authorName) meta.push(opts.authorName);
  meta.push(`[Link](${opts.sourceUrl})`);
  if (opts.publishedAt) meta.push(`Published: ${opts.publishedAt}`);
  if (opts.likeCount) meta.push(`Likes: ${opts.likeCount}`);
  if (opts.retweetCount) meta.push(`Retweets: ${opts.retweetCount}`);
  if (opts.replyCount) meta.push(`Replies: ${opts.replyCount}`);

  const lines = [
    opts.title ? `# ${opts.title}\n` : "",
    "> " + meta.join(" · "),
    "",
    opts.text,
    "",
  ].filter(Boolean);

  const filePath = join(opts.noteDir, "post.md");
  await writeFile(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Utility: sleep
// ---------------------------------------------------------------------------
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Utility: extension from URL
// ---------------------------------------------------------------------------
function getExt(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    // Twitter CDN: /media/xxx?format=jpg&name=medium — get format from query param
    const format = u.searchParams.get("format");
    if (format && ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"].includes(format)) {
      return format === "jpeg" ? "jpg" : format;
    }
    const ext = u.pathname.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"].includes(ext ?? "")
      ? ext!
      : fallback;
  } catch {
    return fallback;
  }
}
