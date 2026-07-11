import { access, readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
]);

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export async function readText(path) {
  return await readFile(path, 'utf8');
}

export async function readJson(path) {
  return JSON.parse(await readText(path));
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listFilesByExtension(dir, extensions) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(dir, entry.name))
    .filter((path) => extensions.has(extname(path).toLowerCase()))
    .sort();
}

export async function listImageFiles(dir) {
  return listFilesByExtension(dir, IMAGE_EXTENSIONS);
}

export function fail(issues, kind, message) {
  issues.push({ kind, message });
}

export function missingPhrases(text, phrases) {
  return phrases.filter((phrase) => !text.includes(phrase));
}

export function presentPhrases(text, phrases) {
  return phrases.filter((phrase) => text.includes(phrase));
}

export function countMarkdownHeadings(markdown) {
  return (markdown.match(/^#{2,6}\s+/gm) || []).length;
}

export function longestContentLine(markdown, { skip = () => false } = {}) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !skip(trimmed);
    })
    .reduce((max, line) => Math.max(max, line.length), 0);
}

export function threshold(profile, fixtureMode, key) {
  if (!fixtureMode) return profile[key];
  const fixtureKey = `fixture_${key}`;
  return profile[fixtureKey] ?? profile[key];
}
