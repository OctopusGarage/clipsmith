#!/usr/bin/env node
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  exists,
  fail,
  listImageFiles,
  missingPhrases,
  parseArgs,
  presentPhrases,
  readJson,
  readText,
} from '../../../script/eval-harness.mjs';

const execFileAsync = promisify(execFile);

function countOcrSections(ocr) {
  return (ocr.match(/^## Image /gm) || []).length;
}

async function prepareFixtureWithFreshOcr({ fixtureDir, scriptDir }) {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'clipsmith-xhs-eval-'));
  const noteDir = join(tmpRoot, 'note');
  await mkdir(noteDir, { recursive: true });
  await copyFile(join(fixtureDir, 'post.md'), join(noteDir, 'post.md'));

  const fixtureImages = await listImageFiles(join(fixtureDir, 'images'));
  const copiedImages = [];
  for (const image of fixtureImages) {
    const target = join(noteDir, basename(image));
    await copyFile(image, target);
    copiedImages.push(target);
  }

  await execFileAsync(
    'npx',
    [
      'tsx',
      join(scriptDir, 'ocr.ts'),
      '--note_dir',
      noteDir,
      ...copiedImages.flatMap((image) => ['--image_path', image]),
    ],
    { cwd: resolve(scriptDir, '..'), maxBuffer: 10 * 1024 * 1024 }
  );
  return { noteDir, cleanupDir: tmpRoot };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  node scripts/eval.mjs --note_dir <note_dir> --profile xhs-skill-long-term-asset
  node scripts/eval.mjs --fixture xhs-skill-long-term-asset --profile xhs-skill-long-term-asset
  node scripts/eval.mjs --fixture xhs-skill-long-term-asset --profile xhs-skill-long-term-asset --run_ocr`);
    return;
  }

  const profileName = args.profile;
  if (!profileName || typeof profileName !== 'string') {
    throw new Error('Missing required --profile');
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const skillDir = resolve(scriptDir, '..');
  const profiles = await readJson(join(skillDir, 'evals', 'xhs-capture-evals.json'));
  const profile = profiles.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown eval profile: ${profileName}`);
  }

  let noteDir = typeof args.note_dir === 'string' ? resolve(args.note_dir) : '';
  let fixtureName = typeof args.fixture === 'string' ? args.fixture : '';
  if (args.fixture === true) {
    fixtureName = profileName;
  }
  let cleanupDir = '';

  if (fixtureName) {
    const fixtureDir = resolve(skillDir, profile.fixture_dir || join('evals', 'fixtures', fixtureName));
    if (args.run_ocr) {
      const prepared = await prepareFixtureWithFreshOcr({ fixtureDir, scriptDir });
      noteDir = prepared.noteDir;
      cleanupDir = prepared.cleanupDir;
    } else {
      noteDir = fixtureDir;
    }
  }

  if (!noteDir) {
    throw new Error('Missing required --note_dir or --fixture');
  }

  const issues = [];
  try {
    const postPath = join(noteDir, 'post.md');
    const ocrPath = join(noteDir, 'ocr.md');
    const post = await readText(postPath);
    const ocr = await readText(ocrPath);
    const topLevelImages = await listImageFiles(noteDir);
    const fixtureImages = await listImageFiles(join(noteDir, 'images'));
    const imageFiles = topLevelImages.length > 0 ? topLevelImages : fixtureImages;
    const combined = `${post}\n${ocr}`;

    if (!post.includes(profile.expected_note_id)) {
      fail(issues, 'note_id', `Expected note id ${profile.expected_note_id} in post.md`);
    }
    if (profile.expected_canonical_url && !post.includes(profile.expected_canonical_url)) {
      fail(issues, 'source_url', `Expected canonical URL ${profile.expected_canonical_url} in post.md`);
    }
    if (!post.includes(profile.title_includes)) {
      fail(issues, 'title', `post.md title does not include ${profile.title_includes}`);
    }
    if (imageFiles.length < profile.min_image_count) {
      fail(issues, 'image_count', `Expected at least ${profile.min_image_count} images, got ${imageFiles.length}`);
    }
    if (ocr.length < profile.min_ocr_chars) {
      fail(issues, 'ocr_length', `ocr.md is too short: ${ocr.length} chars < ${profile.min_ocr_chars}`);
    }
    const ocrSections = countOcrSections(ocr);
    if (ocrSections !== profile.expected_ocr_count) {
      fail(issues, 'ocr_count', `Expected ${profile.expected_ocr_count} OCR sections, got ${ocrSections}`);
    }
    for (const phrase of missingPhrases(post, profile.required_post_phrases || [])) {
      fail(issues, 'missing_post_phrase', `Missing post phrase: ${phrase}`);
    }
    for (const phrase of missingPhrases(ocr, profile.required_ocr_phrases || [])) {
      fail(issues, 'missing_ocr_phrase', `Missing OCR phrase: ${phrase}`);
    }
    for (const phrase of presentPhrases(combined, profile.forbidden_phrases || [])) {
      fail(issues, 'forbidden_phrase', `Forbidden phrase remains: ${phrase}`);
    }
    if (profile.forbid_summary && (await exists(join(noteDir, 'summary.md')))) {
      fail(issues, 'unexpected_summary', 'summary.md should not be produced by raw XHS capture');
    }

    const result = {
      profile: profileName,
      fixture: fixtureName || null,
      run_ocr: Boolean(args.run_ocr),
      note_dir: noteDir,
      image_count: imageFiles.length,
      ocr_count: ocrSections,
      passed: issues.length === 0,
      issues,
    };
    console.log(JSON.stringify(result, null, 2));
    if (issues.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`xhs capture eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
