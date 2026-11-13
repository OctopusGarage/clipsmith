import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { extractTweetSnapshot, detectLoginState } from '../scripts/core.js';
import { hasReadablePost, readModernPost } from '../scripts/post-dom.js';
import { detectPostType, execute } from '../scripts/executor.js';
let browser: Browser;
let page: Page;
let html: string;
before(async () => {
 browser = await chromium.launch({ channel: 'chrome', headless: true });
 page = await browser.newPage();
 await page.route('**/*', route => route.abort());
 html = await readFile(new URL('./fixtures/modern-post.html', import.meta.url), 'utf8');
});
after(async () => { await browser?.close(); });
test('modern target post captures body, author and quoted link without quoted media or replies', async () => {
 await page.setContent(html);
 const s = await extractTweetSnapshot(page, '123');
 assert.equal(s.authorName, 'Test Writer');
 assert.equal(s.authorHandle, 'writer');
 assert.ok(s.text.startsWith('First paragraph.'));
 assert.ok(s.text.includes('https://x.com/quoted/status/456'));
 assert.ok(!/Wrong post|Quoted body|Reply text|Log in/.test(s.text));
 assert.deepEqual(s.imageUrls, []);
 assert.equal(s.likeCount, '');
 assert.equal(s.publishedAt, '4:39 PM · Nov 6, 2026');
 assert.equal(await detectPostType(page, '123'), 'textOnly');
 assert.equal(await detectLoginState(page), 'loggedIn');
});
test('modern own images and video are detected, nested card assets excluded', async () => {
 await page.setContent(html.replace('First paragraph.', '<img src="https://pbs.twimg.com/media/own.jpg"><video src="https://video.twimg.com/own.mp4"></video>First paragraph.'));
 const s = await extractTweetSnapshot(page, '123');
 assert.deepEqual(s.imageUrls, ['https://pbs.twimg.com/media/own.jpg']);
 assert.deepEqual(s.videoUrls, ['https://video.twimg.com/own.mp4']);
 assert.equal(await detectPostType(page, '123'), 'withMedia');
});
test('legacy tweet extraction remains supported', async () => {
 await page.setContent('<article data-testid="tweet"><div data-testid="User-Name"><span>Legacy Writer</span></div><div data-testid="tweetText">Legacy body</div><time datetime="2026-11-06T08:39:00Z"></time></article>');
 const s = await extractTweetSnapshot(page, '123');
 assert.equal(s.text, 'Legacy body');
 assert.equal(s.authorName, 'Legacy Writer');
 assert.equal(s.publishedAt, '2026-11-06T08:39:00Z');
});

test('readiness ignores other posts and handles delayed modern rendering', async () => {
 await page.setContent(html.replaceAll('/writer/status/123', '/writer/status/321'));
 assert.equal(await page.evaluate(hasReadablePost, '123'), false);
 await page.setContent('<div id="loading">Loading</div>');
 const ready = page.waitForFunction(hasReadablePost, '123', { timeout: 2000 });
 await page.setContent(html);
 await ready;
 assert.equal(await page.evaluate(hasReadablePost, '123'), true);
});

test('existing bundle is refused before any browser work, preserving contents', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'clipsmith-x-existing-'));
 try {
  await writeFile(join(dir, 'post.md'), 'Keep existing capture');
  await assert.rejects(execute({post_url: 'https://x.com/writer/status/123', bundle_dir: dir}), /already exists/);
  assert.equal(await readFile(join(dir, 'post.md'), 'utf8'), 'Keep existing capture');
 } finally { await rm(dir, { recursive: true }); }
});
test('actual login page without readable content is still a login wall', async () => {
 await page.setContent('<form data-testid="LoginForm">Log in</form>');
 assert.equal(await detectLoginState(page), 'loggedOut');
 assert.equal(await page.evaluate(hasReadablePost, '123'), false);
});

test('modern external link cards outside body are preserved once for expansion', async () => {
 await page.setContent(html.replace('<a href="/writer/status/123">', '<a href="https://t.co/example">Project link</a><a href="https://t.co/example">From example.org</a><a href="/writer/status/123">'));
 const s = await page.evaluate(readModernPost, '123');
 assert.ok(s);
 assert.ok(s.text.includes('https://t.co/example'));
 assert.equal(s.text.split('https://t.co/example').length - 1, 1);
 assert.ok(s.tcoHrefs.includes('https://t.co/example'));
 assert.ok(!s.tcoHrefs.includes('/writer'));
});
