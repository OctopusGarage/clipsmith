// ---------------------------------------------------------------------------
// Twitter public syndication fetcher (no auth, no Chrome)
//
// Uses cdn.syndication.twimg.com/tweet-result — Twitter's anonymous endpoint
// that returns full tweet metadata (author, text, likes, media URLs,
// timestamp) without any login. Falls back to publish.twitter.com/oEmbed
// when the syndication endpoint omits media or returns a tombstone.
//
// This module returns the same TweetSnapshot shape as extractTweetSnapshot
// in core.ts so downstream code is source-agnostic.
// ---------------------------------------------------------------------------
import type { TweetSnapshot } from "./core.js";

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const OEMBED_URL = "https://publish.twitter.com/oembed";

interface SyndicationRaw {
  __typename?: string;
  text?: string;
  lang?: string;
  created_at?: string;
  favorite_count?: number;
  id_str?: string;
  entities?: {
    media?: Array<{
      type?: string;
      media_url_https?: string;
      video_info?: { variants?: Array<{ url?: string; content_type?: string }> };
    }>;
    urls?: Array<{
      url: string;
      expanded_url?: string;
      display_url?: string;
    }>;
  };
  mediaDetails?: Array<{
    type?: string;
    media_url_https?: string;
    video_info?: { variants?: Array<{ url?: string; content_type?: string }> };
  }>;
  user?: {
    screen_name?: string;
    name?: string;
  };
  photos?: Array<{ url?: string }>;
}

interface OEmbedRaw {
  author_name?: string;
  author_url?: string;
  html?: string;
  title?: string;
}

/**
 * Fetch a tweet's metadata anonymously. Tries the syndication endpoint first,
 * then oEmbed for an author/title fallback if syndication returns a tombstone.
 */
export async function fetchSyndicationTweet(tweetId: string): Promise<TweetSnapshot> {
  const synRes = await fetch(
    `${SYNDICATION_URL}?id=${encodeURIComponent(tweetId)}&lang=en&token=0`,
    { headers: { "User-Agent": "clipsmith/1.0" } }
  );
  if (!synRes.ok) {
    throw new Error(`syndication http ${synRes.status} for tweet ${tweetId}`);
  }
  const raw = (await synRes.json()) as SyndicationRaw;

  // Tombstone (deleted/restricted) tweets return {__typename: "TweetTombstone"}.
  // Fall back to oEmbed for whatever metadata is publicly available.
  const isTombstone = raw.__typename === "TweetTombstone" || (!raw.text && !raw.user);
  let authorHandle = raw.user?.screen_name ?? "";
  let authorName = raw.user?.name ?? "";
  let text = raw.text ?? "";
  if (isTombstone) {
    const oembed = await fetchOEmbed(tweetId);
    if (oembed.author_url) {
      authorHandle = oembed.author_url.split("/").pop() ?? "";
      authorName = oembed.author_name ?? "";
    }
    if (!text && oembed.html) text = stripOEmbedHtml(oembed.html);
  }

  const imageUrls: string[] = [];
  const videoUrls: string[] = [];

  // Photos
  for (const m of raw.mediaDetails ?? []) {
    if (m.type === "photo" && m.media_url_https) imageUrls.push(m.media_url_https);
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = (m.video_info?.variants ?? []).filter(
        (v) => v.content_type === "video/mp4" && v.url
      );
      // Pick the highest bitrate variant
      const best = variants[variants.length - 1];
      if (best?.url) videoUrls.push(best.url);
    }
  }
  // Some syndications expose photos[] only
  for (const p of raw.photos ?? []) {
    if (p.url) imageUrls.push(p.url);
  }

  // Resolve t.co URLs in text — the syndication endpoint already returns the
  // expanded URL alongside the shortlink, so we can rewrite locally without
  // any extra HTTP call.
  const expanded = raw.entities?.urls ?? [];
  for (const u of expanded) {
    if (u.expanded_url && u.url && text.includes(u.url)) {
      text = text.split(u.url).join(u.expanded_url);
    }
  }

  return {
    tweetId,
    authorHandle,
    authorName,
    text: text.trim(),
    publishedAt: raw.created_at ?? "",
    likeCount: raw.favorite_count ? String(raw.favorite_count) : "0",
    retweetCount: "0", // syndication doesn't expose retweet/reply counts publicly
    replyCount: "0",
    imageUrls,
    videoUrls,
    isArticle: false,
    articleTitle: "",
  };
}

/** Fall back to oEmbed if the syndication endpoint returns a tombstone. */
async function fetchOEmbed(tweetId: string): Promise<OEmbedRaw> {
  try {
    // oEmbed requires the canonical x.com URL, not just the bare ID.
    const lookupUrl = `https://x.com/i/status/${tweetId}`;
    const res = await fetch(
      `${OEMBED_URL}?url=${encodeURIComponent(lookupUrl)}&omit_script=true`,
      { headers: { "User-Agent": "clipsmith/1.0" } }
    );
    if (!res.ok) return {};
    return (await res.json()) as OEmbedRaw;
  } catch {
    return {};
  }
}

/** Strip the surrounding blockquote/anchors from oEmbed HTML, leaving text only. */
function stripOEmbedHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&mdash;.*$/m, "")
    .replace(/&#[0-9]+;/g, (m) => m) // numeric entities are usually fine
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Download `url` (a `pbs.twimg.com/media/...` image) into a Buffer. */
export async function downloadMedia(url: string): Promise<{ data: Buffer; ext: string }> {
  const u = new URL(url);
  const fmt = u.searchParams.get("format");
  const ext =
    fmt && /^(jpg|jpeg|png|gif|webp)$/.test(fmt) ? (fmt === "jpeg" ? "jpg" : fmt) : "jpg";
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`media http ${res.status} for ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  return { data, ext };
}

/**
 * Re-encode an image buffer via sharp to strip EXIF/GPS metadata. JPEG/PNG/
 * WebP only. Returns the original buffer unchanged if `sharp` can't load or
 * the input format isn't recognized — the caller still gets a usable image,
 * we just don't promise EXIF stripping in that fallback case.
 */
export async function stripMetadata(
  data: Buffer,
  ext: string
): Promise<{ data: Buffer; ext: string }> {
  const normalizedExt = ext === "jpeg" ? "jpg" : ext;
  let sharpFn: any = null;
  try {
    // sharp is an optional dependency — keep types loose so the skill
    // compiles whether or not sharp is installed.
    // @ts-ignore — optional peer, missing on machines where sharp build fails
    const mod = await import("sharp");
    sharpFn = mod.default ?? mod;
  } catch {
    return { data, ext: normalizedExt };
  }
  if (!sharpFn) return { data, ext: normalizedExt };

  try {
    const pipeline: any = sharpFn(data).rotate(); // honor orientation, drop EXIF
    const out =
      normalizedExt === "png"
        ? pipeline.png({ compressionLevel: 9 })
        : normalizedExt === "webp"
        ? pipeline.webp({ quality: 92 })
        : pipeline.jpeg({ quality: 92, mozjpeg: true });
    return { data: await out.toBuffer(), ext: normalizedExt };
  } catch {
    return { data, ext: normalizedExt };
  }
}
