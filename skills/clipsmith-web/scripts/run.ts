#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { chromium } from 'playwright';

type Args = Record<string, string | boolean>;

const gzipAsync = promisify(gzip);

type CaptureSnapshot = {
  title: string;
  canonicalUrl: string;
  author: string;
  publishedAt: string;
  sourceHtml: string;
  renderedText: string;
  fullHtml: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'web-capture';
}

function markdownText(value: string): string {
  return pruneChromeText(value)
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pruneChromeText(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const trailingMarkers = new Set([
    'Get the developer newsletter',
    'Keep reading',
    'Related articles',
    'Related',
    'Recommended',
    'More from',
    'View all',
  ]);
  const stopIndex = lines.findIndex((line) => trailingMarkers.has(line.trim()));
  const keptLines = stopIndex >= 0 ? lines.slice(0, stopIndex) : lines;
  return keptLines.filter((line) => line.trim() !== 'Share').join('\n');
}

function summaryFromText(text: string): string {
  const first = text.slice(0, 500).trim();
  return first || 'No extractable text found.';
}

function looksLikeManualActionPage(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    'this page couldn’t load',
    "this page couldn't load",
    'enable javascript and cookies',
    'verify you are human',
    'checking if the site connection is secure',
    'access denied',
    'cloudflare',
  ].some((hint) => normalized.includes(hint));
}

function isTruthyFlag(args: Args, key: string): boolean {
  const value = args[key];
  return value === true || value === 'true' || value === '1';
}

async function captureWithBrowser(url: string, warnings: string[]): Promise<CaptureSnapshot> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        'Chrome/122.0.0.0 Safari/537.36 ClipsmithWebCapture/0.2',
      viewport: { width: 1365, height: 900 },
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const status = response?.status();
    if (status && status >= 400) {
      throw new Error(`Navigation failed with HTTP ${status}`);
    }
    await page
      .waitForLoadState('networkidle', { timeout: 10_000 })
      .catch(() => warnings.push('Timed out waiting for network idle; captured DOM after initial load.'));
    await page.evaluate(`new Promise((resolve) => {
        let y = 0;
        const step = Math.max(300, Math.floor(window.innerHeight * 0.75));
        const timer = window.setInterval(() => {
          y += step;
          window.scrollTo(0, y);
          if (y >= document.body.scrollHeight) {
            window.clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 80);
      })`);
    await page.waitForTimeout(500);

    return await page.evaluate(`(() => {
      const removableSelector = [
        'script',
        'style',
        'noscript',
        'svg',
        'canvas',
        'iframe',
        'nav',
        'header',
        'footer',
        'aside',
        'form',
        'dialog',
        '[role="banner"]',
        '[role="navigation"]',
        '[role="contentinfo"]',
        '[aria-modal="true"]',
      ].join(',');
      const nodeText = (node) => (node.innerText || node.textContent || '').trim();
      const candidates = Array.from(
        document.querySelectorAll('article, main, [role="main"], .article, .post, .content'),
      );
      const body = document.body;
      const selected =
        candidates
          .filter((candidate) => nodeText(candidate).length > 200)
          .sort((a, b) => nodeText(b).length - nodeText(a).length)[0] || body;
      const selectedClone = selected.cloneNode(true);
      selectedClone.querySelectorAll(removableSelector).forEach((node) => node.remove());

      const meta = (selector, attr = 'content') =>
        document.querySelector(selector)?.getAttribute(attr)?.trim() || '';
      const title =
        meta('meta[property="og:title"]') ||
        meta('meta[name="twitter:title"]') ||
        document.title.trim();
      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() ||
        window.location.href;
      const author =
        meta('meta[name="author"]') ||
        meta('meta[property="article:author"]') ||
        meta('meta[name="byl"]');
      const publishedAt =
        meta('meta[property="article:published_time"]') ||
        meta('meta[name="article:published_time"]') ||
        meta('meta[name="date"]') ||
        document.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() ||
        '';

      return {
        title,
        canonicalUrl,
        author,
        publishedAt,
        sourceHtml: selectedClone.outerHTML || '',
        renderedText: nodeText(selected),
        fullHtml: document.documentElement.outerHTML,
      };
    })()`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  npx tsx scripts/run.ts \\
    --url "https://example.com/article" \\
    --output_dir "$HOME/Downloads/clipsmith-web" \\
    [--preserve_full_raw]`);
    return;
  }

  const url = stringArg(args, 'url');
  if (!url) {
    throw new Error('Missing required --url');
  }
  const outputDir = stringArg(args, 'output_dir') || `${process.env.HOME}/Downloads/clipsmith-web`;
  const preserveFullRaw = isTruthyFlag(args, 'preserve_full_raw');

  const warnings: string[] = [];
  const snapshot = await captureWithBrowser(url, warnings);
  const title = snapshot.title || snapshot.canonicalUrl || url;
  const text = markdownText(snapshot.renderedText);
  if (!text) {
    warnings.push('No extractable text found.');
  } else if (text.length < 500) {
    warnings.push('Extracted text is short; review raw audit files before relying on the result.');
  }
  const needsManualAction = looksLikeManualActionPage(text);
  if (needsManualAction) {
    warnings.push('Captured page appears to be an error, bot challenge, or manual-action page.');
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const id = `${stamp}-${safeSegment(title)}`;
  const bundleDir = join(outputDir, id);
  const rawDir = join(bundleDir, 'raw');
  await mkdir(bundleDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });

  const metadata = {
    capture_method: 'playwright',
    requested_url: url,
    final_url: snapshot.canonicalUrl || url,
    title,
    author: snapshot.author,
    published_at: snapshot.publishedAt,
    captured_at: new Date().toISOString(),
    warnings,
  };

  const post = [
    `# ${title}`,
    '',
    `Source: ${snapshot.canonicalUrl || url}`,
    snapshot.author ? `Author: ${snapshot.author}` : '',
    snapshot.publishedAt ? `Published: ${snapshot.publishedAt}` : '',
    '',
    text || 'No extractable text found.',
    '',
  ]
    .filter((line, index, lines) => line || lines[index - 1] !== '')
    .join('\n');
  const summary = `# Summary\n\n${summaryFromText(text)}\n`;
  await writeFile(join(bundleDir, 'post.md'), post, 'utf8');
  await writeFile(join(bundleDir, 'summary.md'), summary, 'utf8');
  await writeFile(join(rawDir, 'source.html'), `${snapshot.sourceHtml.trim()}\n`, 'utf8');
  await writeFile(join(rawDir, 'rendered.txt'), `${text}\n`, 'utf8');
  await writeFile(join(rawDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  if (preserveFullRaw) {
    const compressed = await gzipAsync(snapshot.fullHtml);
    await writeFile(join(rawDir, 'source.full.html.gz'), compressed);
  }

  const assets = [
    { path: 'raw/source.html', kind: 'web-cleaned-html' },
    { path: 'raw/rendered.txt', kind: 'web-rendered-text' },
    { path: 'raw/metadata.json', kind: 'web-metadata' },
    ...(preserveFullRaw
      ? [{ path: 'raw/source.full.html.gz', kind: 'web-full-html-compressed' }]
      : []),
  ];

  await writeFile(
    join(bundleDir, 'capture.json'),
    `${JSON.stringify(
      {
        schema: 'clipsmith.capture_bundle.v1',
        id,
        platform: 'web',
        source_url: url,
        canonical_url: snapshot.canonicalUrl || url,
        title,
        author: snapshot.author,
        published_at: snapshot.publishedAt,
        captured_at: new Date().toISOString(),
        content_files: [
          { path: 'summary.md', kind: 'summary', required_for_review: true },
          { path: 'post.md', kind: 'post', required_for_review: true },
        ],
        assets,
        warnings,
        status: needsManualAction ? 'needs_manual_action' : text ? 'complete' : 'partial',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(JSON.stringify({ status: 'written', bundle_dir: bundleDir }, null, 2));
}

main().catch((error) => {
  console.error(`web capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
