import { openBrowserPage, verificationMessage, navigateBrowser } from './browser.js';

const [url, linkPattern] = process.argv.slice(2);

function hasManualActionText(text) {
  const normalized = String(text || '').toLowerCase();
  return [
    'enable javascript and cookies',
    'verify you are human',
    'checking if the site connection is secure',
    'access denied',
  ].some((hint) => normalized.includes(hint));
}

(async () => {
  let session;
  let keepPage = false;
  try {
    session = await openBrowserPage();
    const { page } = session;
    const response = await navigateBrowser(session, url);
    const status = response ? response.status() : 0;
    if (response?.headers()['cf-mitigated'] === 'challenge') {
      keepPage = session.mode === 'chrome-cdp';
      throw new Error(verificationMessage(session.mode));
    }
    if (status >= 400) {
      throw new Error(`Navigation failed with HTTP ${status}`);
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.evaluate(async () => {
      let y = 0;
      const step = Math.max(300, Math.floor(window.innerHeight * 0.75));
      while (y < document.body.scrollHeight) {
        y += step;
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const payload = await page.evaluate((pattern) => {
      const dateRe = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/;
      const root = document.querySelector('main, [role="main"]') || document.body;
      const links = Array.from(root.querySelectorAll('a[href]')).filter(
        (anchor) => !anchor.closest('nav, footer, aside, [role="navigation"]') &&
          (root !== document.body || !anchor.closest('header') || Boolean(anchor.closest('article'))),
      );
      const seen = new Set();
      const items = [];
      for (const anchor of links) {
        const href = new URL(anchor.getAttribute('href') || '', window.location.href).toString();
        if (pattern && !href.includes(pattern)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const card = anchor.closest('article, li, section, [class*="card"], [class*="Card"]') || anchor;
        const anchorText = (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
        const cardText = (card.innerText || card.textContent || anchorText).replace(/\s+/g, ' ').trim();
        const date = (anchorText.match(dateRe) || cardText.match(dateRe) || [''])[0];
        let title = anchorText || cardText;
        if (date && title.includes(date)) {
          title = title.slice(0, title.indexOf(date)).trim();
        }
        title = title.replace(/\b(Engineering|Research|Product|Company|Safety|Security|Business)\s*$/i, '').trim();
        if (title.length < 6) continue;
        items.push({ title, url: href, date });
      }
      return {
        title: document.title || '',
        text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 2000),
        items,
      };
    }, linkPattern || '');
    if (payload.items.length === 0 && hasManualActionText(payload.text)) {
      keepPage = session.mode === 'chrome-cdp';
      console.log(JSON.stringify({
        manual_action: true,
        reason: verificationMessage(session.mode),
        items: [],
      }));
      return;
    }
    console.log(JSON.stringify({ items: payload.items }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (session) await session.close({ keepPage });
  }
})();
