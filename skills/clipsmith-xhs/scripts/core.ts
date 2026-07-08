import { constants } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import type { Page } from "playwright";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROFILE_DIR = resolve(homedir(), ".chrome-labali-no-proxy");
export const DEFAULT_CDP_PORT = "9223";
export const DEFAULT_PROXY_MODE = "none";

const LOGIN_HINTS = ["登录", "扫码登录", "Sign in", "Login", "手机号登录", "验证码登录"];
const IMAGE_EXT_HINTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif"];
const VIDEO_EXT_HINTS = [".mp4", ".mov", ".webm", ".m3u8"];

function isXiaohongshuCdn(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".xhscdn.com") || hostname === "xhscdn.com";
  } catch {
    return false;
  }
}

export interface DownloadPostInputs {
  post_url?: string;
  output_dir?: string;
  profile_dir?: string;
  cdp_port?: string;
  proxy_mode?: string;
  proxy_server?: string;
  timeout_ms?: number;
  overwrite?: boolean;
  include_comments?: boolean;
}

function getChromeProxyArgs(proxyModeRaw: string | undefined, proxyServerRaw: string | undefined): string[] {
  const proxyMode = (proxyModeRaw || DEFAULT_PROXY_MODE).trim().toLowerCase();
  if (proxyMode === "none") {
    return ["--no-proxy-server"];
  }
  if (proxyMode === "system") {
    return [];
  }
  if (proxyMode === "custom") {
    const proxyServer = (proxyServerRaw || "").trim();
    if (!proxyServer) {
      throw new Error("proxy_server is required when proxy_mode=custom");
    }
    return [`--proxy-server=${proxyServer}`];
  }
  throw new Error(`Unsupported proxy_mode: ${proxyMode}. Expected one of: none, system, custom`);
}

export interface DownloadFailure {
  url: string;
  error: string;
}

export interface DownloadPostResult {
  output_dir: string;
  note_dir: string;
  note_id: string;
  post_url: string;
  publish_time: string;
  post_md_file: string;
  comments_json_file?: string;
  comments_md_file?: string;
  comments_dir?: string;
  comment_images_dir?: string;
  image_count: number;
  video_count: number;
  comments_count: number;
  comment_image_count: number;
  failed_count: number;
  failed: DownloadFailure[];
  files: string[];
}

export interface PostSnapshot {
  title: string;
  text: string;
  publishedAt: string;
  imageUrls: string[];
  videoUrls: string[];
}

export interface PostComment {
  commentId?: string;
  parentCommentId?: string;
  rootCommentId?: string;
  level?: number;
  userId?: string;
  user: string;
  replyToUserId?: string;
  replyToUser?: string;
  content: string;
  publishedAt?: string;
  likeCount?: string;
  imageUrls?: string[];
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeCommentId(raw: string): string {
  const input = normalizeWhitespace(raw || "");
  if (!input) {
    return "";
  }
  const stripped = input.replace(/^comment-/i, "");
  const lower = stripped.toLowerCase();
  if (
    lower === "notecontainer" ||
    lower === "commentcontainer" ||
    lower === "comments" ||
    lower === "root" ||
    lower === "container"
  ) {
    return "";
  }
  if (!/^[a-zA-Z0-9]+$/.test(stripped)) {
    return "";
  }
  return stripped;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function cleanUrl(raw: string): string {
  if (!raw) {
    return "";
  }
  return raw.trim().replace(/&amp;/g, "&");
}

function toUrlIdentity(raw: string): string {
  const cleaned = cleanUrl(raw);
  try {
    const u = new URL(cleaned);
    return `${u.origin}${u.pathname}`;
  } catch {
    return cleaned.split("?")[0].split("#")[0];
  }
}

export function mediaUrlIdentity(raw: string): string {
  return toUrlIdentity(raw);
}

function includesAny(value: string, needles: string[]): boolean {
  const lower = value.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function looksLikeImageUrl(url: string, contentType?: string): boolean {
  if (contentType && contentType.toLowerCase().startsWith("image/")) {
    return true;
  }
  const lowerUrl = url.toLowerCase();
  return IMAGE_EXT_HINTS.some((suffix) => lowerUrl.includes(suffix));
}

function looksLikeVideoUrl(url: string, contentType?: string): boolean {
  if (contentType && contentType.toLowerCase().startsWith("video/")) {
    return true;
  }
  const lowerUrl = url.toLowerCase();
  return VIDEO_EXT_HINTS.some((suffix) => lowerUrl.includes(suffix));
}

function shouldIgnoreImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) {
    return true;
  }
  return ["avatar", "icon", "emoji", "logo", "sprite", "favicon", "/api/", "metrics_report"].some(
    (token) => lower.includes(token)
  );
}

export function parseNoteId(postUrl: string): string {
  const matched = postUrl.match(/\/(?:explore|discovery\/item|note)\/([a-zA-Z0-9]+)/);
  if (matched?.[1]) {
    return matched[1];
  }
  throw new Error(`Unable to parse note id from URL: ${postUrl}`);
}

export function canonicalizePostUrl(postUrl: string): string {
  const noteId = parseNoteId(postUrl);
  return `https://www.xiaohongshu.com/explore/${noteId}`;
}

export function normalizePublishTime(input: string): string {
  const text = input.trim();
  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const ms = text.length === 13 ? num : num * 1000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) {
      const y = String(dt.getFullYear());
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      const ss = String(dt.getSeconds()).padStart(2, "0");
      return `${y}${m}${d}-${hh}${mm}${ss}`;
    }
  }

  const fullMatch = text.match(
    /(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})(?:[日\sT]+(\d{1,2})[:：](\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (fullMatch) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = fullMatch;
    return `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}-${hh.padStart(2, "0")}${mm.padStart(2, "0")}${ss.padStart(2, "0")}`;
  }

  const mdMatch = text.match(/(\d{1,2})[\-\/](\d{1,2})(?:\s+(\d{1,2})[:：](\d{1,2})(?::(\d{1,2}))?)?/);
  if (mdMatch) {
    const year = String(new Date().getFullYear());
    const [, m, d, hh = "00", mm = "00", ss = "00"] = mdMatch;
    return `${year}${m.padStart(2, "0")}${d.padStart(2, "0")}-${hh.padStart(2, "0")}${mm.padStart(2, "0")}${ss.padStart(2, "0")}`;
  }

  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

export function sanitizeTitle(title: string): string {
  return title
    .replace(/[^A-Za-z0-9\u4E00-\u9FFF\u3400-\u4DBF]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ensureAbsolutePath(pathLike: string): string {
  const expanded = pathLike.startsWith("~/") ? `${homedir()}/${pathLike.slice(2)}` : pathLike;
  return resolve(expanded);
}

export async function ensureDir(pathLike: string): Promise<void> {
  await mkdir(pathLike, { recursive: true });
}

/**
 * Navigate the carousel step-by-step to collect image URLs in display order.
 * Presses ArrowLeft to reset to slide 1, then ArrowRight to walk through.
 * Returns an ordered array where index 0 is the first slide.
 */
async function extractImageUrlsByCarouselNavigation(page: Page): Promise<string[]> {
  const getActiveSlideUrl = () =>
    page.evaluate(() => {
      // Prefer Swiper's active-slide class
      for (const sel of [
        ".note-slider .swiper-slide-active img",
        ".note-slider [class*='active'] img",
        ".note-slider .slide-active img",
      ]) {
        const el = document.querySelector(sel) as HTMLImageElement | null;
        if (el) {
          const src = (el.currentSrc || el.src || "").split("?")[0];
          if (src && isXiaohongshuCdn(src) && !src.includes("avatar")) return src;
        }
      }
      // Fallback: largest img in .note-slider by naturalWidth * naturalHeight
      const all = Array.from(document.querySelectorAll(".note-slider img")) as HTMLImageElement[];
      let best: HTMLImageElement | null = null;
      let bestArea = 0;
      for (const img of all) {
        const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
        const src = (img.currentSrc || img.src || "").split("?")[0];
        if (area > bestArea && isXiaohongshuCdn(src) && !src.includes("avatar")) {
          bestArea = area;
          best = img;
        }
      }
      return best ? (best.currentSrc || best.src || "").split("?")[0] : "";
    });

  // Reset to slide 1 — press ArrowLeft until the URL stops changing
  let prevUrl = await getActiveSlideUrl();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300 + Math.random() * 150);
    const cur = await getActiveSlideUrl();
    if (cur === prevUrl) break;
    prevUrl = cur;
  }

  const ordered: string[] = [];
  let noChangeCount = 0;

  for (let i = 0; i < 30; i++) {
    const url = await getActiveSlideUrl();
    if (!url) break;
    // Wrap-around detected: back to slide 1
    if (ordered.length > 0 && url === ordered[0]) break;
    if (url === ordered[ordered.length - 1]) {
      noChangeCount++;
      if (noChangeCount >= 2) break;
    } else {
      ordered.push(url);
      noChangeCount = 0;
    }
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400 + Math.random() * 300);
  }

  return ordered;
}

export async function extractPostSnapshot(page: Page, noteId: string): Promise<PostSnapshot> {
  const snapshot = await page.evaluate((targetNoteId) => {
    const initialState = (window as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__ as
      | {
          note?: {
            noteDetailMap?: Record<
              string,
              {
                note?: {
                  imageList?: Array<{ urlDefault?: string; url?: string; infoList?: Array<{ url?: string }> }>;
                  video?: {
                    media?: {
                      stream?: {
                        h264?: Array<{ masterUrl?: string }>;
                        h265?: Array<{ masterUrl?: string }>;
                      };
                    };
                    masterUrl?: string;
                    playUrl?: string;
                    url?: string;
                  };
                  time?: string | number;
                  title?: string;
                  desc?: string;
                };
                imageList?: Array<{ urlDefault?: string; url?: string; infoList?: Array<{ url?: string }> }>;
                video?: {
                  media?: {
                    stream?: {
                      h264?: Array<{ masterUrl?: string }>;
                      h265?: Array<{ masterUrl?: string }>;
                    };
                  };
                  masterUrl?: string;
                  playUrl?: string;
                  url?: string;
                };
                time?: string | number;
                title?: string;
                desc?: string;
              }
            >;
          };
        }
      | undefined;
    const noteMap = initialState?.note?.noteDetailMap ?? {};
    const exact = noteMap[targetNoteId];
    const fallbackKey = Object.keys(noteMap).find((key) => key.includes(targetNoteId));
    const hit = exact ?? (fallbackKey ? noteMap[fallbackKey] : undefined);
    if (hit) {
      const note = hit.note ?? hit;
      const imageList = note.imageList ?? [];
      const urls = imageList
        .map((item) => item?.urlDefault || item?.url || item?.infoList?.[0]?.url || "")
        .filter(Boolean);
      const video = note.video;
      const videoUrls = [
        ...(video?.media?.stream?.h264 ?? []).map((item) => item?.masterUrl || ""),
        ...(video?.media?.stream?.h265 ?? []).map((item) => item?.masterUrl || ""),
        video?.masterUrl || "",
        video?.playUrl || "",
        video?.url || "",
      ].filter(Boolean);
      return {
        title: note.title || "",
        text: note.desc || "",
        publishedAt: String(note.time ?? ""),
        imageUrls: urls,
        videoUrls,
      };
    }

    let title = "";
    for (const selector of ["#detail-title", ".note-content .title", "h1"]) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) {
        title = text;
        break;
      }
    }
    if (!title) {
      title =
        (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)
          ?.getAttribute("content")
          ?.trim() || document.title || "";
    }

    const textBlocks: string[] = [];
    for (const selector of [
      "#detail-desc .note-text",
      "#detail-desc",
      ".note-content .desc",
      ".note-content",
    ]) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) {
        textBlocks.push(text);
        break;
      }
    }

    let publishedAt = "";
    for (const selector of [
      "#detail-date",
      "#detail-time",
      ".note-content .date",
      ".note-content [class*='date']",
      ".note-content [class*='time']",
      "[data-testid='publish-time']",
    ]) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) {
        publishedAt = text;
        break;
      }
    }
    if (!publishedAt) {
      const body = document.body?.innerText ?? "";
      const matched = body.match(
        /(\d{4}[年\-\/.]\d{1,2}[月\-\/.]\d{1,2}(?:[日\sT]+\d{1,2}[:：]\d{1,2}(?::\d{1,2})?)?)/
      );
      if (matched?.[1]) {
        publishedAt = matched[1];
      }
    }

    // Image URLs are NOT extracted here — bulk DOM querySelectorAll returns images
    // in DOM/preload order, not carousel order. extractPostSnapshot() will call
    // extractImageUrlsByCarouselNavigation() after this evaluate returns.
    const fallback = {
      title,
      text: textBlocks.join("\n\n").trim(),
      publishedAt,
      imageUrls: [] as string[],
      videoUrls: Array.from(document.querySelectorAll("video, video source"))
        .map((video) => {
          const element = video as HTMLVideoElement;
          return (element.currentSrc || element.src || element.getAttribute("src") || "").trim();
        })
        .filter(Boolean),
    };
    return fallback;
  }, noteId);

  // If __INITIAL_STATE__ provided ordered image URLs, use them directly.
  // Otherwise fall back to step-by-step carousel navigation which preserves display order.
  let imageUrls = filterPostImageUrls(snapshot.imageUrls);
  if (imageUrls.length === 0) {
    const carouselUrls = await extractImageUrlsByCarouselNavigation(page);
    imageUrls = filterPostImageUrls(carouselUrls);
  }

  return {
    title: normalizeWhitespace(snapshot.title || ""),
    text: normalizeWhitespace(snapshot.text || ""),
    publishedAt: normalizeWhitespace(snapshot.publishedAt || ""),
    imageUrls,
    videoUrls: filterPostVideoUrls(snapshot.videoUrls || []),
  };
}

function normalizeCommentFields(comment: PostComment): PostComment {
  return {
    commentId: normalizeCommentId(comment.commentId || ""),
    parentCommentId: normalizeCommentId(comment.parentCommentId || ""),
    rootCommentId: normalizeCommentId(comment.rootCommentId || ""),
    level: typeof comment.level === "number" ? comment.level : 0,
    userId: normalizeWhitespace(comment.userId || ""),
    user: normalizeWhitespace(comment.user || ""),
    replyToUserId: normalizeWhitespace(comment.replyToUserId || ""),
    replyToUser: normalizeWhitespace(comment.replyToUser || ""),
    content: normalizeWhitespace(comment.content || ""),
    publishedAt: normalizeWhitespace(comment.publishedAt || ""),
    likeCount: normalizeWhitespace(comment.likeCount || ""),
    imageUrls: dedupeUrls(comment.imageUrls || []),
  };
}

function dedupeComments(comments: PostComment[]): PostComment[] {
  const byKey = new Map<string, PostComment>();

  function mergePreferRich(oldItem: PostComment, newItem: PostComment): PostComment {
    const merged: PostComment = { ...oldItem };
    const maybeAssign = (key: keyof PostComment) => {
      const oldValue = merged[key];
      const newValue = newItem[key];
      const oldText = typeof oldValue === "string" ? oldValue.trim() : "";
      const newText = typeof newValue === "string" ? newValue.trim() : "";
      if (!oldText && newText) {
        merged[key] = newValue as never;
      }
    };
    maybeAssign("commentId");
    maybeAssign("parentCommentId");
    maybeAssign("rootCommentId");
    maybeAssign("userId");
    maybeAssign("user");
    maybeAssign("replyToUserId");
    maybeAssign("replyToUser");
    maybeAssign("publishedAt");
    maybeAssign("likeCount");

    const mergedImages = dedupeUrls([...(merged.imageUrls || []), ...(newItem.imageUrls || [])]);
    if (mergedImages.length > 0) {
      merged.imageUrls = mergedImages;
    }

    const oldContent = (merged.content || "").trim();
    const newContent = (newItem.content || "").trim();
    if ((!oldContent && newContent) || newContent.length > oldContent.length + 8) {
      merged.content = newItem.content;
    }

    const oldLevel = typeof merged.level === "number" ? merged.level : 0;
    const newLevel = typeof newItem.level === "number" ? newItem.level : 0;
    if (newLevel > oldLevel) {
      merged.level = newLevel;
    }
    return merged;
  }

  for (const raw of comments) {
    const item = normalizeCommentFields(raw);
    if (!item.content) {
      continue;
    }
    const key = item.commentId
      ? `id::${item.commentId}`
      : `${item.userId || item.user}::${item.content}::${item.publishedAt || ""}::${item.likeCount || ""}::${item.parentCommentId || ""}::${item.rootCommentId || ""}::${item.replyToUserId || item.replyToUser || ""}::${item.level || 0}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, mergePreferRich(existing, item));
  }
  return Array.from(byKey.values()).map((item) => {
    const normalized = { ...item };
    const replyPrefix = (normalized.content || "").match(/^\s*(?:回复|reply)\s*([^\s:：]{1,40})\s*[:：]/i);
    if ((!normalized.replyToUser || !normalized.replyToUser.trim()) && replyPrefix?.[1]) {
      normalized.replyToUser = normalizeWhitespace(replyPrefix[1]);
    }
    if (
      normalized.replyToUserId &&
      normalized.userId &&
      normalized.replyToUserId === normalized.userId
    ) {
      normalized.replyToUserId = "";
    }
    if (
      normalized.replyToUser &&
      normalized.user &&
      normalizeWhitespace(normalized.replyToUser) === normalizeWhitespace(normalized.user)
    ) {
      normalized.replyToUser = "";
    }

    const hasReplyTo = !!normalized.replyToUser || !!normalized.replyToUserId;
    const hasParent =
      !!normalized.parentCommentId &&
      normalized.parentCommentId !== normalized.commentId;
    const inferredLevel2 = (normalized.level || 0) === 2 && hasReplyTo;
    normalized.level = hasParent || hasReplyTo || inferredLevel2 ? 2 : 1;
    if (normalized.level === 1) {
      normalized.replyToUser = "";
      normalized.replyToUserId = "";
    }
    return normalized;
  });
}

async function expandCommentsAndPaginate(page: Page): Promise<void> {
  let unchangedRounds = 0;
  let previousMetric = -1;
  let seenEndMarker = false;

  async function clickPaginationHints(): Promise<number> {
    const directShowMore = page.locator(".show-more");
    const directCount = await directShowMore.count().catch(() => 0);
    let directClicked = 0;
    for (let i = 0; i < directCount; i += 1) {
      const target = directShowMore.nth(i);
      const text = ((await target.textContent().catch(() => "")) || "").trim();
      if (!/展开\s*\d+\s*条回复|查看更多回复|展开回复|查看全部回复|加载更多|下一页|more|next/i.test(text)) {
        continue;
      }
      const visible = await target.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      await target.click({ timeout: 1200 }).catch(() => undefined);
      directClicked += 1;
    }

    const texts = [
      /展开\s*\d+\s*条回复/i,
      /查看\s*\d+\s*条回复/i,
      /展开.*回复/i,
      /展开全部回复/i,
      /展开更多回复/i,
      /查看更多回复/i,
      /查看全部回复/i,
      /查看全部评论/i,
      /展开全部评论/i,
      /更多评论/i,
      /加载更多/i,
      /下一页/i,
      /下页/i,
      /more/i,
      /next/i,
    ];
    let clicked = directClicked;
    for (const pattern of texts) {
      const locator = page.getByText(pattern);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const target = locator.nth(i);
        const visible = await target.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }
        const text = (await target.textContent().catch(() => "")) || "";
        const normalized = text.trim();
        if (!normalized) {
          continue;
        }
        const isPaginationAction =
          /(展开|查看|加载|更多|下一页|下页|more|next)/i.test(normalized) &&
          !/^(回复|reply)\b/i.test(normalized) &&
          !/收起|less/i.test(normalized);
        if (!isPaginationAction) {
          continue;
        }
        await target.click({ timeout: 1500 }).catch(() => undefined);
        clicked += 1;
      }
    }
    return clicked;
  }

  for (let i = 0; i < 140; i += 1) {
    const hintClicks = await clickPaginationHints();
    const metric = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          "button, a, span, div, p, [role='button'], [class*='more'], [class*='expand'], [class*='reply'], [class*='load']"
        )
      );
      let clicked = 0;
      for (let i = 0; i < candidates.length; i += 1) {
        const element = candidates[i] as HTMLElement;
        const text = (element.textContent || "").trim();
        if (!text) {
          continue;
        }
        if (text.length > 40) {
          continue;
        }
        const matched =
          /展开|更多|查看|全部|下一页|下页|next|more|load/i.test(text) &&
          !/^(回复|reply)\b/i.test(text) &&
          !/收起|less/i.test(text);
        if (!matched) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible) {
          continue;
        }
        if (rect.top > window.innerHeight + 180 || rect.bottom < -180) {
          continue;
        }
        element.click();
        clicked += 1;
      }
      const scroller = document.scrollingElement || document.documentElement || document.body;
      const noteScroller = (document.querySelector(".note-scroller") as HTMLElement | null) || null;
      const delta = Math.max(window.innerHeight * 0.9, 520);
      scroller.scrollBy(0, delta);
      if (noteScroller) {
        noteScroller.scrollTop += Math.max(noteScroller.clientHeight * 0.9, 520);
      }
      const innerScrollers = Array.from(document.querySelectorAll("div, section, ul"))
        .filter((el) => {
          const node = el as HTMLElement;
          if (node.scrollHeight <= node.clientHeight + 120) {
            return false;
          }
          const marker = `${node.className || ""} ${node.id || ""} ${node.getAttribute("aria-label") || ""}`;
          return /comment|reply|评论|回复/i.test(marker);
        })
        .slice(0, 8) as HTMLElement[];
      for (let i = 0; i < innerScrollers.length; i += 1) {
        const node = innerScrollers[i];
        node.scrollTop += Math.max(node.clientHeight * 0.9, 480);
      }
      const commentNodes = document.querySelectorAll(
        ".comment-item, [class*='comment-item'], [class*='commentItem'], [data-testid*='comment'], [class*='comment']"
      ).length;
      const docHeight = scroller.scrollHeight;
      const body = document.body?.innerText || "";
      const hasEnd = body.includes("- THE END -");
      return {
        score: commentNodes * 1000 + clicked * 100 + Math.floor(docHeight / 100),
        hasEnd,
      };
    });
    const combinedMetric = metric.score + hintClicks * 100;
    if (metric.hasEnd) {
      seenEndMarker = true;
    }

    if (combinedMetric === previousMetric) {
      unchangedRounds += 1;
    } else {
      unchangedRounds = 0;
      previousMetric = combinedMetric;
    }
    await page.waitForTimeout(700 + Math.random() * 400);
    if (seenEndMarker && unchangedRounds >= 3) {
      break;
    }
    if (!seenEndMarker && unchangedRounds >= 15 && i > 80) {
      break;
    }
  }

  await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement || document.body;
    scroller.scrollTo(0, 0);
  });
}

export async function extractPostComments(page: Page): Promise<PostComment[]> {
  await expandCommentsAndPaginate(page);
  const stateComments = await page.evaluate(() => {
    const out: Array<{
      commentId?: string;
      parentCommentId?: string;
      rootCommentId?: string;
      level?: number;
      userId?: string;
      user: string;
      replyToUserId?: string;
      replyToUser?: string;
      content: string;
      publishedAt?: string;
      likeCount?: string;
    }> = [];
    const queue: Array<{ node: unknown; depth: number; parentCommentId?: string; rootCommentId?: string; level: number }> = [
      { node: (window as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__, depth: 0, level: 0 },
    ];
    const visited = new WeakSet<object>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || !current.node || current.depth > 8) {
        continue;
      }
      if (Array.isArray(current.node)) {
        for (let i = 0; i < current.node.length; i += 1) {
          queue.push({
            node: current.node[i],
            depth: current.depth + 1,
            parentCommentId: current.parentCommentId,
            rootCommentId: current.rootCommentId,
            level: current.level,
          });
        }
        continue;
      }
      if (typeof current.node !== "object") {
        continue;
      }
      const objectNode = current.node as object;
      if (visited.has(objectNode)) {
        continue;
      }
      visited.add(objectNode);

      const record = current.node as Record<string, unknown>;
      const commentIdRaw = record.comment_id ?? record.id ?? record.commentId;
      const commentId =
        typeof commentIdRaw === "string" ? commentIdRaw : typeof commentIdRaw === "number" ? String(commentIdRaw) : "";
      const hasCommentLikeKeys =
        !!commentId ||
        "content" in record ||
        "comment" in record ||
        "sub_comments" in record ||
        "subCommentList" in record ||
        "target_comment" in record;
      if (hasCommentLikeKeys) {
        const userInfo = (
          record.user_info ||
          record.userInfo ||
          record.user ||
          record.author ||
          record.user_info_v2 ||
          {}
        ) as Record<string, unknown>;
        const targetUserInfo = (
          record.target_user_info ||
          record.targetUserInfo ||
          record.targetUser ||
          record.replyUser ||
          {}
        ) as Record<string, unknown>;
        const contentRaw = record.content ?? record.text ?? record.comment ?? record.note;
        const content =
          (typeof contentRaw === "string" ? contentRaw : typeof contentRaw === "number" ? String(contentRaw) : "").trim();
        if (content) {
          const userRaw =
            userInfo.nickname ??
            userInfo.nick_name ??
            userInfo.nickName ??
            userInfo.name ??
            userInfo.user_name ??
            userInfo.username ??
            record.nickname ??
            record.nickName ??
            record.user_name ??
            record.userName;
          const user =
            typeof userRaw === "string" ? userRaw : typeof userRaw === "number" ? String(userRaw) : "";
          const userIdRaw =
            userInfo.user_id ??
            userInfo.userid ??
            userInfo.userId ??
            userInfo.uid ??
            userInfo.id ??
            record.user_id ??
            record.userId ??
            record.uid;
          const userId =
            typeof userIdRaw === "string" ? userIdRaw : typeof userIdRaw === "number" ? String(userIdRaw) : "";
          const parentIdRaw = record.parent_comment_id ?? record.parentId ?? current.parentCommentId ?? "";
          const parentCommentId =
            typeof parentIdRaw === "string" ? parentIdRaw : typeof parentIdRaw === "number" ? String(parentIdRaw) : "";
          const rootIdRaw = record.root_comment_id ?? record.rootId ?? current.rootCommentId ?? commentId ?? "";
          const rootCommentId =
            typeof rootIdRaw === "string" ? rootIdRaw : typeof rootIdRaw === "number" ? String(rootIdRaw) : "";
          const replyToUserRaw =
            targetUserInfo.nickname ??
            targetUserInfo.nick_name ??
            targetUserInfo.nickName ??
            targetUserInfo.name ??
            targetUserInfo.user_name ??
            record.reply_to_name ??
            record.replyToName;
          const replyToUser =
            typeof replyToUserRaw === "string"
              ? replyToUserRaw
              : typeof replyToUserRaw === "number"
                ? String(replyToUserRaw)
                : "";
          const replyToUserIdRaw =
            targetUserInfo.user_id ??
            targetUserInfo.userid ??
            targetUserInfo.userId ??
            targetUserInfo.uid ??
            targetUserInfo.id ??
            record.reply_to_user_id ??
            record.replyToUserId ??
            record.reply_uid;
          const replyToUserId =
            typeof replyToUserIdRaw === "string"
              ? replyToUserIdRaw
              : typeof replyToUserIdRaw === "number"
                ? String(replyToUserIdRaw)
                : "";
          const publishedRaw = record.create_time ?? record.time ?? record.ip_location ?? record.timestamp;
          const publishedAt =
            typeof publishedRaw === "string" ? publishedRaw : typeof publishedRaw === "number" ? String(publishedRaw) : "";
          const likeRaw = record.like_count ?? record.likes ?? record.liked_count ?? record.likeCount;
          const likeCount = typeof likeRaw === "string" ? likeRaw : typeof likeRaw === "number" ? String(likeRaw) : "";
          const imageUrls: string[] = [];
          const imageLikeKeys = [
            "image_list",
            "images",
            "imageList",
            "pictures",
            "picture_list",
            "pics",
            "img_list",
            "imgList",
          ];
          for (let k = 0; k < imageLikeKeys.length; k += 1) {
            const v = record[imageLikeKeys[k]];
            if (!Array.isArray(v)) {
              continue;
            }
            for (let m = 0; m < v.length; m += 1) {
              const item = v[m];
              if (typeof item === "string") {
                imageUrls.push(item);
                continue;
              }
              if (!item || typeof item !== "object") {
                continue;
              }
              const entry = item as Record<string, unknown>;
              const direct = entry.url ?? entry.originUrl ?? entry.image_url ?? entry.imageUrl ?? entry.src;
              if (typeof direct === "string" && direct) {
                imageUrls.push(direct);
              }
              const infoList = entry.info_list ?? entry.infoList;
              if (Array.isArray(infoList)) {
                for (let n = 0; n < infoList.length; n += 1) {
                  const info = infoList[n];
                  if (!info || typeof info !== "object") {
                    continue;
                  }
                  const infoRecord = info as Record<string, unknown>;
                  const infoUrl = infoRecord.url ?? infoRecord.originUrl ?? infoRecord.src;
                  if (typeof infoUrl === "string" && infoUrl) {
                    imageUrls.push(infoUrl);
                  }
                }
              }
            }
          }

          out.push({
            commentId,
            parentCommentId,
            rootCommentId,
            level: parentCommentId ? 2 : 1,
            userId,
            user,
            replyToUserId,
            replyToUser,
            content,
            publishedAt,
            likeCount,
            imageUrls,
          });
        }

        const childKeys = ["sub_comments", "subCommentList", "replies", "reply_list", "children"];
        for (let i = 0; i < childKeys.length; i += 1) {
          const children = record[childKeys[i]];
          if (!Array.isArray(children)) {
            continue;
          }
          for (let j = 0; j < children.length; j += 1) {
            queue.push({
              node: children[j],
              depth: current.depth + 1,
              parentCommentId: commentId || current.parentCommentId,
              rootCommentId: current.rootCommentId || commentId || current.parentCommentId,
              level: current.level + 1,
            });
          }
        }
      }

      const values = Object.values(record);
      for (let i = 0; i < values.length; i += 1) {
        queue.push({
          node: values[i],
          depth: current.depth + 1,
          parentCommentId: current.parentCommentId,
          rootCommentId: current.rootCommentId,
          level: current.level,
        });
      }
    }

    return out;
  });

  const domComments = await page.evaluate(() => {
    const out: Array<{
      commentId?: string;
      parentCommentId?: string;
      rootCommentId?: string;
      level?: number;
      userId?: string;
      user: string;
      replyToUserId?: string;
      replyToUser?: string;
      content: string;
      publishedAt?: string;
      likeCount?: string;
    }> = [];
    const itemSelectors = [
      ".comment-item",
      ".comments-container .item",
      ".comment-container .item",
      "[class*='comment-item']",
      "[class*='commentItem']",
      "[data-testid*='comment']",
      "[class*='comment']",
    ];
    const contentSelectors = [".content", ".desc", ".text", "[class*='content']", "[class*='desc']"];
    const userSelectors = [".name", ".author", ".user-name", "[class*='name']", "[class*='author']"];
    const timeSelectors = [".time", ".date", "[class*='time']", "[class*='date']"];
    const likeSelectors = [".like", ".liked", "[class*='like']"];

    for (let s = 0; s < itemSelectors.length; s += 1) {
      const nodes = Array.from(document.querySelectorAll(itemSelectors[s]));
      if (nodes.length === 0) {
        continue;
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const root = nodes[i] as HTMLElement;
        if (root.querySelectorAll("[class*='comment']").length > 40) {
          continue;
        }
        let content = "";
        for (let j = 0; j < contentSelectors.length; j += 1) {
          const text = root.querySelector(contentSelectors[j])?.textContent?.trim() || "";
          if (text) {
            content = text;
            break;
          }
        }
        if (!content) {
          content = root.textContent?.trim() || "";
        }
        if (!content) {
          continue;
        }
        let user = "";
        for (let j = 0; j < userSelectors.length; j += 1) {
          const text = root.querySelector(userSelectors[j])?.textContent?.trim() || "";
          if (text) {
            user = text;
            break;
          }
        }
        let publishedAt = "";
        for (let j = 0; j < timeSelectors.length; j += 1) {
          const text = root.querySelector(timeSelectors[j])?.textContent?.trim() || "";
          if (text) {
            publishedAt = text;
            break;
          }
        }
        let likeCount = "";
        for (let j = 0; j < likeSelectors.length; j += 1) {
          const text = root.querySelector(likeSelectors[j])?.textContent?.trim() || "";
          if (text) {
            likeCount = text;
            break;
          }
        }

        const profileAnchor = root.querySelector("a[href*='/user/profile/']") as HTMLAnchorElement | null;
        const profileHref = profileAnchor?.getAttribute("href") || "";
        const userId = profileHref.match(/\/user\/profile\/([a-zA-Z0-9]+)/)?.[1] || "";
        const commentId = root.getAttribute("data-comment-id") || root.getAttribute("data-id") || root.getAttribute("id") || "";
        let parentCommentId = root.getAttribute("data-parent-comment-id") || root.getAttribute("data-parent-id") || "";
        let rootCommentId = root.getAttribute("data-root-comment-id") || "";
        const inReplyContainer = !!root.closest(".reply-container, [class*='reply-container']");
        if (!parentCommentId && inReplyContainer) {
          const parentBlock = root.closest(".parent-comment, [class*='parent-comment']");
          const parentRoot = parentBlock?.querySelector(":scope > .comment-item, .comment-item") as HTMLElement | null;
          const parentRootId =
            parentRoot?.getAttribute("data-comment-id") ||
            parentRoot?.getAttribute("data-id") ||
            parentRoot?.getAttribute("id") ||
            "";
          if (parentRootId) {
            parentCommentId = parentRootId;
            if (!rootCommentId) {
              rootCommentId = parentRootId;
            }
          }
        }

        let replyToUser = "";
        let replyToUserId = "";
        const replyToAnchor = root.querySelector("[class*='reply'] a[href*='/user/profile/']") as HTMLAnchorElement | null;
        if (replyToAnchor) {
          replyToUser = (replyToAnchor.textContent || "").trim().replace(/^@+/, "");
          replyToUserId = (replyToAnchor.getAttribute("href") || "").match(/\/user\/profile\/([a-zA-Z0-9]+)/)?.[1] || "";
        }

        const replyPrefixMatch = content.match(/^\s*(?:回复|reply)\s*([^\s:：]{1,40})\s*[:：]/i);
        const hasReplyPrefix = !!replyPrefixMatch;
        if (!replyToUser && replyPrefixMatch?.[1]) {
          replyToUser = replyPrefixMatch[1].trim();
        }
        if (!parentCommentId) {
          let walker = root.parentElement;
          while (walker) {
            const maybeParentId =
              walker.getAttribute("data-comment-id") || walker.getAttribute("data-id") || walker.getAttribute("id") || "";
            if (maybeParentId && maybeParentId !== commentId) {
              parentCommentId = maybeParentId;
              break;
            }
            walker = walker.parentElement;
          }
        }
        if (parentCommentId && !/^(comment-)?[a-zA-Z0-9]{8,}$/.test(parentCommentId)) {
          parentCommentId = "";
        }
        if (rootCommentId && !/^(comment-)?[a-zA-Z0-9]{8,}$/.test(rootCommentId)) {
          rootCommentId = "";
        }
        if (replyToUserId && userId && replyToUserId === userId) {
          replyToUserId = "";
        }
        if (replyToUser && user && replyToUser === user) {
          replyToUser = "";
        }
        const inferredLevel = inReplyContainer || parentCommentId || replyToUser || replyToUserId || hasReplyPrefix ? 2 : 1;

        const imageUrls = Array.from(root.querySelectorAll("img"))
          .map((img) => {
            const element = img as HTMLImageElement;
            return (element.currentSrc || element.src || "").trim();
          })
          .filter((url) => /^https?:\/\//i.test(url))
          .filter((url) => {
            const lower = url.toLowerCase();
            return !(
              lower.includes("avatar") ||
              lower.includes("emoji") ||
              lower.includes("icon") ||
              lower.includes("logo") ||
              lower.includes("sprite")
            );
          });

        out.push({
          commentId,
          parentCommentId,
          rootCommentId: rootCommentId || (inferredLevel === 2 ? parentCommentId || commentId : commentId),
          level: inferredLevel,
          userId,
          user,
          replyToUserId,
          replyToUser,
          content,
          publishedAt,
          likeCount,
          imageUrls,
        });
      }
      if (out.length > 0) {
        break;
      }
    }
    return out;
  });

  return dedupeComments([...domComments, ...stateComments]);
}

export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = cleanUrl(raw);
    if (!isHttpUrl(url)) {
      continue;
    }
    const identity = toUrlIdentity(url);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    out.push(url);
  }
  return out;
}

export function filterPostImageUrls(urls: string[]): string[] {
  return dedupeUrls(urls).filter((url) => {
    const lower = url.toLowerCase();
    if (shouldIgnoreImage(url)) {
      return false;
    }
    const hasImageToken =
      lower.includes("image") ||
      lower.includes("webp") ||
      lower.includes("jpg") ||
      lower.includes("jpeg") ||
      lower.includes("png") ||
      lower.includes("xhsimg") ||
      lower.includes("sns-webpic");
    return hasImageToken;
  });
}

export function filterPostVideoUrls(urls: string[]): string[] {
  return dedupeUrls(urls).filter((url) => {
    const lower = url.toLowerCase();
    if (lower.startsWith("blob:") || lower.startsWith("data:")) {
      return false;
    }
    return (
      lower.includes("video") ||
      lower.includes("sns-video") ||
      lower.includes("xhscdn") ||
      lower.includes(".mp4") ||
      lower.includes(".m3u8") ||
      lower.includes(".mov") ||
      lower.includes(".webm")
    );
  });
}

export async function isLoginRequired(page: Page, snapshot: PostSnapshot): Promise<boolean> {
  if (snapshot.text || snapshot.imageUrls.length > 0 || snapshot.videoUrls.length > 0) {
    return false;
  }
  const pageUrl = page.url();
  if (includesAny(pageUrl, ["login", "passport", "signup"])) {
    return true;
  }
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
  return includesAny(bodyText, LOGIN_HINTS);
}

const RATE_LIMIT_HINTS = ["操作过于频繁", "请稍后再试", "too many requests", "频繁操作", "访问受限"];
// Note: "验证码" alone is NOT sufficient — XHS login modals show "手机验证码" as a login option.
// Only treat it as a CAPTCHA when combined with challenge-specific terms.
const CAPTCHA_HINTS = ["滑块验证", "人机验证", "captcha", "robot"];
const CAPTCHA_VERIFY_HINTS = ["安全验证", "验证码"]; // only trigger when NOT inside a login modal
const LOGIN_MODAL_HINTS = ["手机号登录", "扫码登录", "登录继续查看"];
const ACCOUNT_ANOMALY_HINTS = ["账号异常", "账号被限制", "安全提醒", "suspicious activity"];

/**
 * Attempt to dismiss a XHS login modal if present.
 * The modal is a dismissible overlay — content is accessible underneath.
 * Silently does nothing if no modal is found.
 */
export async function dismissLoginModalIfPresent(page: Page): Promise<boolean> {
  try {
    const dismissed = await page.evaluate(() => {
      // Try common XHS login modal close button selectors
      const selectors = [
        '[class*="close"]',
        '[class*="Close"]',
        '.close-icon',
        '.modal-close',
        '[aria-label="关闭"]',
        '[aria-label="close"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const htmlEl = el as HTMLElement;
          // Only click if it's inside or near a login modal context
          const text = htmlEl.closest?.("dialog, [class*='modal'], [class*='Modal'], [class*='popup'], [class*='Popup'], [class*='login'], [class*='Login']")?.textContent ?? "";
          if (text.includes("登录") || text.includes("Login")) {
            htmlEl.click();
            return true;
          }
        }
      }
      return false;
    });
    if (dismissed) {
      await page.waitForTimeout(500 + Math.random() * 300);
    }
    return dismissed;
  } catch {
    return false;
  }
}

/**
 * Check the current page for hard risk signals (CAPTCHA, rate-limit, account anomaly).
 * Throws with a descriptive message if a signal is detected — caller must not retry.
 * Call this after navigation and after each major interaction.
 */
export async function checkForRiskSignals(page: Page): Promise<void> {
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "");

  // Hard CAPTCHA hints (always a signal regardless of context)
  if (includesAny(bodyText, CAPTCHA_HINTS) || /captcha|verify/i.test(url)) {
    throw new Error(
      "[HARD SIGNAL] CAPTCHA or verification challenge detected. Complete it manually in the browser, then retry."
    );
  }
  // "安全验证" / "验证码" are CAPTCHA signals only when NOT inside a login modal
  // (XHS login popup shows "手机验证码" as a login option — this is NOT a CAPTCHA)
  const isLoginModal = includesAny(bodyText, LOGIN_MODAL_HINTS);
  if (!isLoginModal && includesAny(bodyText, CAPTCHA_VERIFY_HINTS)) {
    throw new Error(
      "[HARD SIGNAL] CAPTCHA or verification challenge detected. Complete it manually in the browser, then retry."
    );
  }
  if (includesAny(bodyText, RATE_LIMIT_HINTS)) {
    throw new Error(
      "[HARD SIGNAL] Rate-limit detected. Wait before retrying — do not retry in the current session."
    );
  }
  if (includesAny(bodyText, ACCOUNT_ANOMALY_HINTS)) {
    throw new Error(
      "[HARD SIGNAL] Account anomaly or security warning detected. Check the browser manually before retrying."
    );
  }
}

export async function waitForManualLogin(promptText: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("Login is required but current session is not interactive.");
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await rl.question(`${promptText}\nPress Enter after login is complete...`);
  } finally {
    rl.close();
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function isCdpEndpointReady(port: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return false;
    }
    const json = (await response.json()) as { Browser?: string };
    return typeof json.Browser === "string" && json.Browser.length > 0;
  } catch {
    return false;
  }
}

async function waitForCdpEndpoint(port: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpEndpointReady(port)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

export async function ensureChromeWithRemoteDebugging(
  port: string,
  userDataDir: string,
  log: (message: string) => void,
  proxyMode?: string,
  proxyServer?: string
): Promise<void> {
  if (await isCdpEndpointReady(port)) {
    log(`Reuse Chrome remote debugging session on :${port}`);
    return;
  }

  const chromeArgs = [
    "-na",
    "Google Chrome",
    "--args",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...getChromeProxyArgs(proxyMode, proxyServer),
  ];
  log(`Launch Chrome remote debugging session: open ${chromeArgs.join(" ")}`);
  await execFileAsync("open", chromeArgs, {
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });

  const ready = await waitForCdpEndpoint(port, 20000);
  if (!ready) {
    throw new Error(
      `Chrome CDP endpoint not ready on :${port} after launch. Start manually: open -na "Google Chrome" --args --remote-debugging-port=${port} --user-data-dir=${userDataDir}`
    );
  }
}

function inferExtensionFromContentType(contentType: string | undefined): string {
  if (!contentType) {
    return "";
  }
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/webp")) return ".webp";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("image/avif")) return ".avif";
  if (normalized.includes("video/mp4")) return ".mp4";
  if (normalized.includes("video/webm")) return ".webm";
  if (normalized.includes("quicktime")) return ".mov";
  if (normalized.includes("application/vnd.apple.mpegurl")) return ".m3u8";
  return "";
}

function inferExtensionFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0];
  const ext = extname(withoutQuery).toLowerCase();
  if (ext && ext.length <= 6) {
    return ext;
  }
  return "";
}

async function downloadOne(
  page: Page,
  url: string,
  outputDir: string,
  index: number,
  kind: "image" | "video",
  overwrite: boolean
): Promise<{ path: string; url: string }> {
  const extFromUrl = inferExtensionFromUrl(url) || (kind === "video" ? ".mp4" : ".webp");
  const fileName =
    kind === "video"
      ? `video-${String(index).padStart(3, "0")}${extFromUrl}`
      : `${String(index).padStart(3, "0")}${extFromUrl}`;
  const target = resolve(outputDir, fileName);

  if (!overwrite) {
    await access(target, constants.F_OK)
      .then(() => {
        throw new Error(`File already exists: ${target}`);
      })
      .catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
          return;
        }
        if (error instanceof Error && error.message.startsWith("File already exists:")) {
          throw error;
        }
        throw error;
      });
  }

  // For images: prefer browser HTTP cache over a new outbound request.
  // Comment images are typically already loaded during comment scroll; reading from cache
  // avoids duplicate traffic that risk-control systems can identify as non-human.
  if (kind === "image") {
    const cacheBuffer = await fetchImageFromBrowserCache(page, url);
    if (cacheBuffer && cacheBuffer.byteLength > 1000) {
      const ext = inferExtensionFromUrl(url) || ".webp";
      const adjustedTarget =
        ext === extFromUrl ? target : resolve(outputDir, `${String(index).padStart(3, "0")}${ext}`);
      await writeFile(adjustedTarget, cacheBuffer);
      return { path: adjustedTarget, url };
    }
    // Cache miss — fall through to page.request.get() as last resort
  }

  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await page.request.get(url, {
        timeout: 90000,
        failOnStatusCode: false,
        headers: {
          referer: page.url(),
        },
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }

      const contentType = response.headers()["content-type"];
      if (kind === "image" && !looksLikeImageUrl(url, contentType)) {
        throw new Error(`Not an image response: ${contentType || "unknown"}`);
      }
      if (kind === "video" && !looksLikeVideoUrl(url, contentType)) {
        throw new Error(`Not a video response: ${contentType || "unknown"}`);
      }

      const ext = inferExtensionFromContentType(contentType) || extFromUrl;
      const adjustedTarget =
        ext === extFromUrl
          ? target
          : resolve(
              outputDir,
              kind === "video"
                ? `video-${String(index).padStart(3, "0")}${ext}`
                : `${String(index).padStart(3, "0")}${ext}`
            );
      const buffer = await response.body();
      await writeFile(adjustedTarget, Buffer.from(buffer));
      return { path: adjustedTarget, url };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRetryable =
        message.includes("Timeout") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT") ||
        message.includes("EPIPE") ||
        message.includes("network");
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 700 * attempt + Math.random() * 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function downloadImages(
  page: Page,
  urls: string[],
  outputDir: string,
  overwrite: boolean
): Promise<{ saved: Array<{ path: string; url: string }>; failed: DownloadFailure[] }> {
  const saved: Array<{ path: string; url: string }> = [];
  const failed: DownloadFailure[] = [];

  let index = 1;
  for (const url of filterPostImageUrls(urls)) {
    try {
      const item = await downloadOne(page, url, outputDir, index, "image", overwrite);
      saved.push(item);
      index += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ url, error: message });
    }
  }

  return { saved, failed };
}

// Carousel next-button selectors tried in order
const CAROUSEL_NEXT_SELECTORS = [
  ".note-image .right",
  ".note-image [class*='right']",
  "[class*='noteImage'] [class*='right']",
  "[class*='arrow'][class*='right']",
  ".swiper-button-next",
  ".slick-next",
  "[class*='next']",
];

async function clickCarouselNext(page: Page): Promise<boolean> {
  for (const selector of CAROUSEL_NEXT_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 400 });
      if (visible) {
        await el.click();
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

function isXhsPostImageResponse(url: string): boolean {
  const lower = url.toLowerCase();

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const isXhsCdnHost = hostname === "xhscdn.com" || hostname.endsWith(".xhscdn.com");
  return (
    isXhsCdnHost &&
    (lower.includes("notes_pre_post") || lower.includes("notes_pre_images") || lower.includes("sns-webpic"))
  );
}

/**
 * Read an image from the browser's HTTP cache via fetch with cache: 'force-cache'.
 * Returns null if the image is not cached or fetch fails.
 */
async function fetchImageFromBrowserCache(page: Page, url: string): Promise<Buffer | null> {
  try {
    const base64 = await page.evaluate(async (imageUrl: string) => {
      const response = await fetch(imageUrl, { cache: "force-cache" });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      return btoa(binary);
    }, url);
    if (!base64) return null;
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Browse through the image carousel by simulating user click-through,
 * capturing image data from network responses as each image loads.
 * Falls back to reading directly from the browser's HTTP cache for already-loaded images.
 */
export async function browseAndCaptureImages(
  page: Page,
  imageUrls: string[],
  outputDir: string,
  overwrite: boolean
): Promise<{ saved: Array<{ path: string; url: string }>; failed: DownloadFailure[] }> {
  const filtered = filterPostImageUrls(imageUrls);
  if (filtered.length === 0) return { saved: [], failed: [] };

  // Map identity → buffer for captured responses
  const capturedByIdentity = new Map<string, { url: string; buffer: Buffer }>();

  const onResponse = async (response: import("playwright").Response): Promise<void> => {
    const url = response.url();
    if (!isXhsPostImageResponse(url)) return;
    const identity = toUrlIdentity(url);
    if (capturedByIdentity.has(identity)) return;
    try {
      const body = await response.body();
      if (body.byteLength > 1000) {
        capturedByIdentity.set(identity, { url, buffer: Buffer.from(body) });
      }
    } catch {
      // body already consumed or connection closed — skip
    }
  };

  page.on("response", onResponse);

  try {
    // Wait for the first carousel image to be visible
    await page.waitForSelector('img[src*="xhscdn.com"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800 + Math.random() * 400);

    // Click through remaining images one by one with human-like delays
    for (let i = 1; i < filtered.length; i++) {
      const clicked = await clickCarouselNext(page);
      if (!clicked) break;
      await page.waitForTimeout(700 + Math.random() * 700);
    }

    // Extra wait to ensure last image response is received
    await page.waitForTimeout(600 + Math.random() * 400);
  } finally {
    page.off("response", onResponse);
  }

  const saved: Array<{ path: string; url: string }> = [];
  const failed: DownloadFailure[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const url = filtered[i];
    const identity = toUrlIdentity(url);
    const captured = capturedByIdentity.get(identity);

    if (captured) {
      // Save directly from captured buffer — no extra network request
      const ext = inferExtensionFromUrl(url) || ".webp";
      const fileName = `${String(i + 1).padStart(3, "0")}${ext}`;
      const target = resolve(outputDir, fileName);
      try {
        await writeFile(target, captured.buffer);
        saved.push({ path: target, url });
      } catch (error) {
        failed.push({ url, error: String(error) });
      }
    } else {
      // Fallback: image was already in browser cache before our listener was set up.
      // Read directly from browser HTTP cache — no new network request.
      const ext = inferExtensionFromUrl(url) || ".webp";
      const fileName = `${String(i + 1).padStart(3, "0")}${ext}`;
      const target = resolve(outputDir, fileName);
      try {
        const cacheBuffer = await fetchImageFromBrowserCache(page, url);
        if (cacheBuffer && cacheBuffer.byteLength > 1000) {
          await writeFile(target, cacheBuffer);
          saved.push({ path: target, url });
        } else {
          failed.push({ url, error: "Image not found in browser cache — browse the post manually first" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ url, error: message });
      }
    }
  }

  return { saved, failed };
}

/**
 * Simulate user viewing a video post: focus the page, click the video to play,
 * and wait for it to buffer before any download attempt.
 */
export async function simulateVideoPlay(page: Page): Promise<void> {
  // Focus the page (tab activation)
  await page.bringToFront();
  await page.waitForTimeout(500 + Math.random() * 300);

  // Try to click the video element or its play button to start playback
  const clicked = await page.evaluate(() => {
    const selectors = [
      "video",
      ".play-btn",
      "[class*='play']",
      "[class*='video'] button",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        el.focus();
        el.click();
        return true;
      }
    }
    return false;
  });

  if (clicked) {
    // Wait for the video to buffer — simulates user watching for a few seconds
    await page.waitForTimeout(3000 + Math.random() * 2000);
  }
}

export async function downloadVideos(
  page: Page,
  urls: string[],
  outputDir: string,
  overwrite: boolean
): Promise<{ saved: Array<{ path: string; url: string }>; failed: DownloadFailure[] }> {
  const saved: Array<{ path: string; url: string }> = [];
  const failed: DownloadFailure[] = [];

  let index = 1;
  for (const url of filterPostVideoUrls(urls)) {
    try {
      const item = await downloadOne(page, url, outputDir, index, "video", overwrite);
      saved.push(item);
      index += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ url, error: message });
    }
  }

  return { saved, failed };
}

export async function writePostMarkdown(params: {
  noteDir: string;
  sourceUrl: string;
  title: string;
  text: string;
  publishedAt: string;
}): Promise<string> {
  const content = [
    `# ${params.title || "Untitled"}`,
    "",
    `Source URL: ${params.sourceUrl}`,
    `Published At: ${params.publishedAt || "unknown"}`,
    `Exported At: ${new Date().toISOString()}`,
    "",
    "## Content",
    "",
    params.text || "(No text content extracted)",
    "",
  ].join("\n");

  const target = resolve(params.noteDir, "post.md");
  await writeFile(target, content, "utf-8");
  return target;
}

export async function writeCommentsJson(noteDir: string, comments: PostComment[]): Promise<string> {
  const target = resolve(noteDir, "comments.json");
  await writeFile(target, `${JSON.stringify(comments, null, 2)}\n`, "utf-8");
  return target;
}

export function collectCommentImageUrls(comments: PostComment[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const comment of comments) {
    for (const raw of comment.imageUrls || []) {
      const url = cleanUrl(raw);
      if (!isHttpUrl(url)) {
        continue;
      }
      const identity = toUrlIdentity(url);
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      urls.push(url);
    }
  }
  return filterPostImageUrls(urls);
}

export async function writeCommentsMarkdown(
  noteDir: string,
  comments: PostComment[],
  imageLinkByIdentity?: Record<string, string>
): Promise<string> {
  const lines: string[] = ["# Comments", "", `Count: ${comments.length}`, ""];
  if (comments.length === 0) {
    lines.push("(No comments extracted)");
    lines.push("");
  } else {
    type RootNode = { root: PostComment; replies: PostComment[] };
    const roots: RootNode[] = [];
    const rootIndexById = new Map<string, number>();
    let lastRootIndex = -1;

    for (const comment of comments) {
      const level = comment.level || 1;
      const explicitRootId = comment.rootCommentId || comment.parentCommentId || "";
      const explicitIndex = explicitRootId ? rootIndexById.get(explicitRootId) : undefined;

      if (level === 1 || (!explicitIndex && lastRootIndex < 0)) {
        roots.push({ root: comment, replies: [] });
        lastRootIndex = roots.length - 1;
        if (comment.commentId) {
          rootIndexById.set(comment.commentId, lastRootIndex);
        }
        if (comment.rootCommentId) {
          rootIndexById.set(comment.rootCommentId, lastRootIndex);
        }
        continue;
      }

      if (explicitIndex !== undefined) {
        roots[explicitIndex].replies.push(comment);
        continue;
      }

      roots[lastRootIndex].replies.push(comment);
    }

    let rootNo = 1;
    for (const node of roots) {
      const root = node.root;
      const rootUser = root.user || "(unknown-name)";
      const rootPrefix = `${rootUser}${root.userId ? ` (${root.userId})` : ""}`;
      lines.push(`- 一级评论 ${rootNo}: ${rootPrefix}`);
      lines.push(`  - ${root.content || "(Empty comment)"}`);
      if (root.likeCount) {
        lines.push(`  - Likes: ${root.likeCount}`);
      }
      if (root.publishedAt) {
        lines.push(`  - Published At: ${root.publishedAt}`);
      }
      const rootImageLinks: string[] = [];
      const rootImageSeen = new Set<string>();
      for (const raw of root.imageUrls || []) {
        const identity = toUrlIdentity(raw);
        const linked = imageLinkByIdentity?.[identity] || raw;
        if (rootImageSeen.has(linked)) {
          continue;
        }
        rootImageSeen.add(linked);
        rootImageLinks.push(linked);
      }
      for (let i = 0; i < rootImageLinks.length; i += 1) {
        lines.push(`  - ![comment-image-${i + 1}](${rootImageLinks[i]})`);
      }

      for (const child of node.replies) {
        const childUser = child.user || "(unknown-name)";
        const childPrefixBase = `${childUser}${child.userId ? ` (${child.userId})` : ""}`;
        const childPrefix =
          child.replyToUser || child.replyToUserId
            ? `${childPrefixBase} 回复 ${child.replyToUser || "(unknown-name)"}${child.replyToUserId ? ` (${child.replyToUserId})` : ""}`
            : childPrefixBase;
        lines.push(`  - 二级评论: ${childPrefix}`);
        lines.push(`    - ${child.content || "(Empty comment)"}`);
        if (child.likeCount) {
          lines.push(`    - Likes: ${child.likeCount}`);
        }
        if (child.publishedAt) {
          lines.push(`    - Published At: ${child.publishedAt}`);
        }
        const childImageLinks: string[] = [];
        const childImageSeen = new Set<string>();
        for (const raw of child.imageUrls || []) {
          const identity = toUrlIdentity(raw);
          const linked = imageLinkByIdentity?.[identity] || raw;
          if (childImageSeen.has(linked)) {
            continue;
          }
          childImageSeen.add(linked);
          childImageLinks.push(linked);
        }
        for (let i = 0; i < childImageLinks.length; i += 1) {
          lines.push(`    - ![reply-image-${i + 1}](${childImageLinks[i]})`);
        }
      }
      lines.push("");
      rootNo += 1;
    }
  }
  const target = resolve(noteDir, "comments.md");
  await writeFile(target, `${lines.join("\n").trimEnd()}\n`, "utf-8");
  return target;
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function toConcatListLine(pathValue: string): string {
  const escaped = pathValue.replace(/'/g, "'\\''");
  return `file '${escaped}'`;
}

export async function mergeVideosAndCleanup(
  noteDir: string,
  videoPaths: string[],
  log: (message: string) => void
): Promise<string[]> {
  const sorted = [...videoPaths].sort((a, b) => a.localeCompare(b));
  if (sorted.length <= 1) {
    return sorted;
  }

  if (!(await hasFfmpeg())) {
    throw new Error("ffmpeg is required for merging segmented videos but was not found in PATH.");
  }

  const concatList = resolve(noteDir, "video-concat-list.txt");
  const merged = resolve(noteDir, "video-merged.mp4");
  const listContent = sorted.map(toConcatListLine).join("\n") + "\n";
  await writeFile(concatList, listContent, "utf-8");

  const copyArgs = ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", merged];
  try {
    await execFileAsync("ffmpeg", copyArgs, {
      maxBuffer: 8 * 1024 * 1024,
    });
    log("video merge completed with ffmpeg copy mode");
  } catch {
    const reencodeArgs = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatList,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      merged,
    ];
    await execFileAsync("ffmpeg", reencodeArgs, {
      maxBuffer: 8 * 1024 * 1024,
    });
    log("video merge completed with ffmpeg re-encode mode");
  }

  for (const pathValue of sorted) {
    await unlink(pathValue).catch(() => undefined);
  }
  await unlink(concatList).catch(() => undefined);
  await unlink(resolve(noteDir, "concat-list.txt")).catch(() => undefined);
  await unlink(resolve(noteDir, "video-concat-list.txt")).catch(() => undefined);

  return [merged];
}
