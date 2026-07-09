#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Args = Record<string, string | boolean>;

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

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html: string, url: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return url;
  }
  return textFromHtml(match[1]) || url;
}

function summaryFromText(text: string): string {
  const first = text.slice(0, 500).trim();
  return first || 'No extractable text found.';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  npx tsx scripts/run.ts \\
    --url "https://example.com/article" \\
    --output_dir "$HOME/Downloads/clipsmith-web"`);
    return;
  }

  const url = stringArg(args, 'url');
  if (!url) {
    throw new Error('Missing required --url');
  }
  const outputDir = stringArg(args, 'output_dir') || `${process.env.HOME}/Downloads/clipsmith-web`;

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 ClipsmithWebCapture/0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const title = titleFromHtml(html, url);
  const text = textFromHtml(html);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const id = `${stamp}-${safeSegment(title)}`;
  const bundleDir = join(outputDir, id);
  await mkdir(bundleDir, { recursive: true });

  const post = `# ${title}\n\nSource: ${url}\n\n${text || 'No extractable text found.'}\n`;
  const summary = `# Summary\n\n${summaryFromText(text)}\n`;
  await writeFile(join(bundleDir, 'post.md'), post, 'utf8');
  await writeFile(join(bundleDir, 'summary.md'), summary, 'utf8');
  await writeFile(
    join(bundleDir, 'capture.json'),
    `${JSON.stringify(
      {
        schema: 'clipsmith.capture_bundle.v1',
        id,
        platform: 'web',
        source_url: url,
        canonical_url: url,
        title,
        author: '',
        published_at: '',
        captured_at: new Date().toISOString(),
        content_files: [
          { path: 'summary.md', kind: 'summary', required_for_review: true },
          { path: 'post.md', kind: 'post', required_for_review: true },
        ],
        assets: [],
        warnings: text ? [] : ['No extractable text found.'],
        status: 'complete',
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
