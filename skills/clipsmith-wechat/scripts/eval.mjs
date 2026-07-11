#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countMarkdownHeadings,
  exists,
  fail,
  listImageFiles,
  longestContentLine,
  missingPhrases,
  parseArgs,
  presentPhrases,
  readJson,
  readText,
  threshold,
} from '../../../script/eval-harness.mjs';

function longestArticleLine(markdown) {
  return longestContentLine(markdown, {
    skip: (trimmed) => trimmed.startsWith('![') || /^https?:\/\//.test(trimmed),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  node scripts/eval.mjs --article_dir <article_dir> --profile wechat-wang-yangming-heart-study
  node scripts/eval.mjs --fixture wechat-wang-yangming-heart-study --profile wechat-wang-yangming-heart-study`);
    return;
  }

  const profileName = args.profile;
  if (!profileName || typeof profileName !== 'string') {
    throw new Error('Missing required --profile');
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const skillDir = resolve(scriptDir, '..');
  const profiles = await readJson(join(skillDir, 'evals', 'wechat-capture-evals.json'));
  const profile = profiles.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown eval profile: ${profileName}`);
  }

  let fixtureName = typeof args.fixture === 'string' ? args.fixture : '';
  if (args.fixture === true) {
    fixtureName = profileName;
  }
  const fixtureMode = Boolean(fixtureName);
  const articleDir = fixtureMode
    ? resolve(skillDir, profile.fixture_dir || join('evals', 'fixtures', fixtureName))
    : typeof args.article_dir === 'string'
      ? resolve(args.article_dir)
      : '';
  if (!articleDir) {
    throw new Error('Missing required --article_dir or --fixture');
  }

  const articlePath = join(articleDir, 'article.md');
  const postPath = join(articleDir, 'post.md');
  const mhtmlPath = join(articleDir, 'article.mhtml');
  const article = await readText(articlePath);
  const post = await exists(postPath) ? await readText(postPath) : '';
  const imageFiles = await listImageFiles(articleDir);
  const issues = [];
  const combined = `${article}\n${post}`;

  if (!article.includes(profile.expected_article_id)) {
    fail(issues, 'article_id', `Expected article id ${profile.expected_article_id} in article.md`);
  }
  if (!article.includes(profile.source_url)) {
    fail(issues, 'source_url', `Expected source URL ${profile.source_url} in article.md`);
  }
  if (!article.includes(profile.title_includes)) {
    fail(issues, 'title', `article.md title does not include ${profile.title_includes}`);
  }
  if (!article.includes(profile.account_includes)) {
    fail(issues, 'account', `article.md account does not include ${profile.account_includes}`);
  }

  const minImageCount = threshold(profile, fixtureMode, 'min_image_count');
  if (imageFiles.length < minImageCount) {
    fail(issues, 'image_count', `Expected at least ${minImageCount} images, got ${imageFiles.length}`);
  }

  const minArticleChars = threshold(profile, fixtureMode, 'min_article_chars');
  if (article.length < minArticleChars) {
    fail(issues, 'article_length', `article.md is too short: ${article.length} chars < ${minArticleChars}`);
  }

  const requireMhtml = threshold(profile, fixtureMode, 'require_mhtml');
  if (requireMhtml && !(await exists(mhtmlPath))) {
    fail(issues, 'mhtml', 'Expected article.mhtml to exist');
  }

  if (profile.require_normalized_post) {
    if (!post) {
      fail(issues, 'normalized_post', 'Expected normalized post.md to exist');
    } else {
      if (!post.includes(profile.expected_article_id)) {
        fail(issues, 'normalized_article_id', `Expected article id ${profile.expected_article_id} in post.md`);
      }
      if (!post.includes(profile.source_url)) {
        fail(issues, 'normalized_source_url', `Expected source URL ${profile.source_url} in post.md`);
      }
      if (!post.includes(profile.title_includes)) {
        fail(issues, 'normalized_title', `post.md title does not include ${profile.title_includes}`);
      }
      const minHeadings = threshold(profile, fixtureMode, 'min_normalized_headings');
      const headings = countMarkdownHeadings(post);
      if (headings < minHeadings) {
        fail(issues, 'normalized_headings', `Expected at least ${minHeadings} post.md headings, got ${headings}`);
      }
      const maxLineChars = threshold(profile, fixtureMode, 'max_normalized_line_chars');
      const longestLine = longestArticleLine(post);
      if (longestLine > maxLineChars) {
        fail(issues, 'normalized_line_length', `post.md has a line with ${longestLine} chars > ${maxLineChars}`);
      }
    }
  }

  for (const phrase of missingPhrases(combined, profile.required_phrases || [])) {
    fail(issues, 'missing_required_phrase', `Missing required phrase: ${phrase}`);
  }
  for (const phrase of presentPhrases(combined, profile.forbidden_phrases || [])) {
    fail(issues, 'forbidden_phrase', `Forbidden phrase remains: ${phrase}`);
  }

  const result = {
    profile: profileName,
    fixture: fixtureName || null,
    article_dir: articleDir,
    image_count: imageFiles.length,
    article_chars: article.length,
    post_chars: post.length,
    post_headings: post ? countMarkdownHeadings(post) : 0,
    post_longest_line_chars: post ? longestArticleLine(post) : 0,
    mhtml_exists: await exists(mhtmlPath),
    passed: issues.length === 0,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`wechat capture eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
