import type { TweetSnapshot } from './core.js';

/** Runs inside the page. Use only rendered DOM, never X's private state/APIs. */
export function readModernPost(tweetId: string): (TweetSnapshot & { tcoHrefs: string[] }) | null {
  const candidates = Array.from(document.querySelectorAll('article[class~="group/post"]'));
  const article = candidates.find(node => Array.from(node.querySelectorAll('a[href]')).some(a => {
    const path = new URL(a.getAttribute('href')!, 'https://x.com').pathname;
    return path.endsWith(`/status/${tweetId}`) && a.closest('article') === node;
  }));
  if (!article) return null;
  const ownElements = Array.from(article.querySelectorAll('*')).filter(el => el.closest('article') === article);
  const textEl = ownElements.filter(el => el.matches('[data-testid="tweetText"], .whitespace-pre-wrap'))[0] as HTMLElement | undefined;
  const media = ownElements.filter(el => el.matches('img, video'));
  const imageUrls = media.filter(el => el.tagName === 'IMG').map(el => el.getAttribute('src') ?? '').filter(src => /^https:\/\/pbs\.twimg\.com\/media\//.test(src));
  const videoUrls = media.filter(el => el.tagName === 'VIDEO').map(el => el.getAttribute('src') ?? '').filter(Boolean);
  if (!textEl?.textContent?.trim() && !imageUrls.length && !videoUrls.length) return null;
  const links = ownElements.filter(el => el.matches('a[href]')) as HTMLAnchorElement[];
  const permalink = links.find(a => new URL(a.getAttribute('href')!, 'https://x.com').pathname.endsWith(`/status/${tweetId}`));
  const handle = new URL(permalink!.getAttribute('href')!, 'https://x.com').pathname.split('/')[1];
  const authorName = links.find(a => a.getAttribute('href') === `/${handle}` && a.textContent?.trim() && !a.textContent.trim().startsWith('@'))?.textContent?.trim() ?? '';
  const time = ownElements.filter(el => el.matches('time'))[0];
  const publishedAt = time?.getAttribute('datetime') ?? links.find(a => new URL(a.getAttribute('href')!, 'https://x.com').pathname.endsWith(`/status/${tweetId}`) && /\d.*·/.test(a.textContent ?? ''))?.textContent?.trim() ?? '';
  const quoteLinks = Array.from(article.querySelectorAll('article a[href*="/status/"]')).map(a => new URL(a.getAttribute('href')!, 'https://x.com').href);
  const quotes = [...new Set(quoteLinks)].filter(url => !url.includes(`/status/${tweetId}`));
  const body = textEl?.textContent?.trim() ?? '';
  const text = body + (quotes.length ? '\n\nQuoted sources:\n' + quotes.map(url => `- ${url}`).join('\n') : '');
  return { tweetId, authorHandle: handle, authorName, text, publishedAt,
    likeCount: '', retweetCount: '', replyCount: '', imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)], isArticle: false, articleTitle: '',
    tcoHrefs: Array.from(textEl?.querySelectorAll('a[href]') ?? []).map(a => a.getAttribute('href') ?? '') };
}

/** Readiness covers both page generations without waiting for hydration/testids. */
export function hasReadablePost(tweetId: string): boolean {
  if (document.querySelector('[data-testid="twitterArticleReadView"], article[data-testid="tweet"]')) return true;
  return Array.from(document.querySelectorAll('article[class~="group/post"]')).some(article =>
    Array.from(article.querySelectorAll('a[href]')).some(a =>
      a.closest('article') === article && new URL(a.getAttribute('href')!, 'https://x.com').pathname.endsWith(`/status/${tweetId}`)
    ) && Array.from(article.querySelectorAll('.whitespace-pre-wrap, img[src*="/media/"], video')).some(el =>
      el.closest('article') === article && (el.tagName !== 'DIV' || !!el.textContent?.trim())
    )
  );
}
