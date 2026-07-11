#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exists,
  fail,
  IMAGE_EXTENSIONS,
  listFilesByExtension,
  missingPhrases,
  parseArgs,
  presentPhrases,
  readJson,
  readText,
  VIDEO_EXTENSIONS,
} from '../../../script/eval-harness.mjs';

function inferType({ imageCount, videoCount, hasMhtml }) {
  if (hasMhtml) return 'article';
  if (imageCount > 0 || videoCount > 0) return 'withMedia';
  return 'textOnly';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  node scripts/eval.mjs --post_dir <post_dir> --profile x-kingson-skill-runtime-text
  node scripts/eval.mjs --fixture x-kingson-skill-runtime-text --profile x-kingson-skill-runtime-text`);
    return;
  }

  const profileName = args.profile;
  if (!profileName || typeof profileName !== 'string') {
    throw new Error('Missing required --profile');
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const skillDir = resolve(scriptDir, '..');
  const profiles = await readJson(join(skillDir, 'evals', 'x-capture-evals.json'));
  const profile = profiles.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown eval profile: ${profileName}`);
  }

  let fixtureName = typeof args.fixture === 'string' ? args.fixture : '';
  if (args.fixture === true) {
    fixtureName = profileName;
  }
  const postDir = fixtureName
    ? resolve(skillDir, profile.fixture_dir || join('evals', 'fixtures', fixtureName))
    : typeof args.post_dir === 'string'
      ? resolve(args.post_dir)
      : '';
  if (!postDir) {
    throw new Error('Missing required --post_dir or --fixture');
  }

  const postPath = join(postDir, 'post.md');
  const mhtmlPath = join(postDir, 'article.mhtml');
  const post = await readText(postPath);
  const imageFiles = await listFilesByExtension(postDir, IMAGE_EXTENSIONS);
  const videoFiles = await listFilesByExtension(postDir, VIDEO_EXTENSIONS);
  const hasMhtml = await exists(mhtmlPath);
  const type = inferType({
    imageCount: imageFiles.length,
    videoCount: videoFiles.length,
    hasMhtml,
  });
  const issues = [];

  if (!post.includes(profile.expected_post_id)) {
    fail(issues, 'post_id', `Expected post id ${profile.expected_post_id} in post.md`);
  }
  if (!post.includes(profile.source_url)) {
    fail(issues, 'source_url', `Expected source URL ${profile.source_url} in post.md`);
  }
  if (!post.includes(`@${profile.author_handle}`)) {
    fail(issues, 'author_handle', `Expected author handle @${profile.author_handle} in post.md`);
  }
  if (type !== profile.expected_type) {
    fail(issues, 'post_type', `Expected type ${profile.expected_type}, got ${type}`);
  }
  if (post.length < profile.min_post_chars) {
    fail(issues, 'post_length', `post.md is too short: ${post.length} chars < ${profile.min_post_chars}`);
  }
  if (imageFiles.length < profile.min_image_count) {
    fail(issues, 'image_count', `Expected at least ${profile.min_image_count} images, got ${imageFiles.length}`);
  }
  if (videoFiles.length < profile.min_video_count) {
    fail(issues, 'video_count', `Expected at least ${profile.min_video_count} videos, got ${videoFiles.length}`);
  }
  if (Boolean(profile.require_mhtml) !== hasMhtml) {
    fail(issues, 'mhtml', `Expected article.mhtml exists=${Boolean(profile.require_mhtml)}, got ${hasMhtml}`);
  }
  for (const phrase of missingPhrases(post, profile.required_phrases || [])) {
    fail(issues, 'missing_required_phrase', `Missing required phrase: ${phrase}`);
  }
  for (const phrase of presentPhrases(post, profile.forbidden_phrases || [])) {
    fail(issues, 'forbidden_phrase', `Forbidden phrase remains: ${phrase}`);
  }

  const result = {
    profile: profileName,
    fixture: fixtureName || null,
    post_dir: postDir,
    inferred_type: type,
    post_chars: post.length,
    image_count: imageFiles.length,
    video_count: videoFiles.length,
    mhtml_exists: hasMhtml,
    passed: issues.length === 0,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`x capture eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
