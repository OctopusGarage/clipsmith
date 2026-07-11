#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countMarkdownHeadings,
  fail,
  longestContentLine,
  missingPhrases,
  parseArgs,
  presentPhrases,
  readJson,
  readText,
} from '../../../script/eval-harness.mjs';

function longestArticleLine(markdown) {
  return longestContentLine(markdown, {
    skip: (trimmed) => trimmed.startsWith('|') || trimmed.startsWith('```'),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  node scripts/eval.mjs \\
    --bundle_dir "/path/to/bundle" \\
    --profile anthropic-building-effective-agents`);
    return;
  }

  const bundleDir = args.bundle_dir;
  const profileName = args.profile;
  if (!bundleDir || typeof bundleDir !== 'string') {
    throw new Error('Missing required --bundle_dir');
  }
  if (!profileName || typeof profileName !== 'string') {
    throw new Error('Missing required --profile');
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const skillDir = resolve(scriptDir, '..');
  const profiles = await readJson(join(skillDir, 'evals', 'web-capture-evals.json'));
  const profile = profiles.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown eval profile: ${profileName}`);
  }

  const root = resolve(bundleDir);
  const capture = await readJson(join(root, 'capture.json'));
  const post = await readText(join(root, 'post.md'));
  const summary = await readText(join(root, 'summary.md'));
  const rawText = await readText(join(root, 'raw', 'rendered.txt'));
  const rawMetadata = await readJson(join(root, 'raw', 'metadata.json'));
  const issues = [];

  if (capture.source_url !== profile.source_url) {
    fail(issues, 'source_url', `Expected source_url ${profile.source_url}, got ${capture.source_url}`);
  }
  if (capture.status !== profile.expected_status) {
    fail(issues, 'status', `Expected status ${profile.expected_status}, got ${capture.status}`);
  }
  if (!String(capture.title || '').includes(profile.title_includes)) {
    fail(issues, 'title', `Title does not include ${profile.title_includes}`);
  }
  if (post.length < profile.min_post_chars) {
    fail(issues, 'length', `post.md is too short: ${post.length} chars < ${profile.min_post_chars}`);
  }
  if (summary.length < 80) {
    fail(issues, 'summary', 'summary.md is too short to be useful');
  }
  if (Number.isFinite(profile.min_headings)) {
    const headings = countMarkdownHeadings(post);
    if (headings < profile.min_headings) {
      fail(issues, 'headings', `Expected at least ${profile.min_headings} headings, got ${headings}`);
    }
  }
  if (Number.isFinite(profile.max_line_chars)) {
    const longestLine = longestArticleLine(post);
    if (longestLine > profile.max_line_chars) {
      fail(issues, 'line_length', `post.md has a line with ${longestLine} chars > ${profile.max_line_chars}`);
    }
  }

  for (const phrase of missingPhrases(post, profile.required_phrases)) {
    fail(issues, 'missing_required_phrase', `Missing required phrase: ${phrase}`);
  }
  for (const phrase of missingPhrases(summary, profile.summary_required_phrases || [])) {
    fail(issues, 'missing_summary_phrase', `Missing summary phrase: ${phrase}`);
  }
  for (const phrase of presentPhrases(post, profile.forbidden_phrases)) {
    fail(issues, 'forbidden_phrase', `Forbidden phrase remains: ${phrase}`);
  }
  if (post.includes('This page couldn') || rawText.includes('This page couldn')) {
    fail(issues, 'manual_action_page', 'Captured content looks like an error/manual-action page');
  }
  if (!Array.isArray(capture.assets) || capture.assets.length < 3) {
    fail(issues, 'raw_assets', 'Expected raw audit files to be declared in capture.json.assets');
  }
  if (rawMetadata.requested_url !== profile.source_url) {
    fail(issues, 'raw_metadata', 'raw/metadata.json requested_url does not match profile source_url');
  }

  const result = {
    profile: profileName,
    bundle_dir: root,
    post_chars: post.length,
    headings: countMarkdownHeadings(post),
    longest_line_chars: longestArticleLine(post),
    passed: issues.length === 0,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`web capture eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
