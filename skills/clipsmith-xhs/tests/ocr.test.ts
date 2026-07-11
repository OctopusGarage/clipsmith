import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { writeImageOcrMarkdown } from "../scripts/ocr";

test("writeImageOcrMarkdown writes one section per image", async (t) => {
  const tmp = await mkdir(join(process.cwd(), ".tmp-ocr-test-a"), {
    recursive: true,
  }).then(() => join(process.cwd(), ".tmp-ocr-test-a"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const one = join(tmp, "001.webp");
  const two = join(tmp, "002.webp");
  await writeFile(one, "one");
  await writeFile(two, "two");

  const result = await writeImageOcrMarkdown({
    noteDir: tmp,
    imagePaths: [one, two],
    runOcr: async ({ outputText }) => {
      await writeFile(outputText, `OCR for ${outputText}\n`);
    },
    prepareImage: async ({ imagePath }) => imagePath,
  });

  const ocr = await readFile(result.ocrMdFile, "utf-8");
  assert.equal(result.ocrCount, 2);
  assert.deepEqual(result.warnings, []);
  assert.match(ocr, /## Image 001 - 001\.webp/);
  assert.match(ocr, /## Image 002 - 002\.webp/);
  assert.match(ocr, /OCR for/);
});

test("writeImageOcrMarkdown preserves output when one image fails", async (t) => {
  const tmp = await mkdir(join(process.cwd(), ".tmp-ocr-test-b"), {
    recursive: true,
  }).then(() => join(process.cwd(), ".tmp-ocr-test-b"));
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const one = join(tmp, "001.webp");
  const two = join(tmp, "002.webp");
  await writeFile(one, "one");
  await writeFile(two, "two");

  const result = await writeImageOcrMarkdown({
    noteDir: tmp,
    imagePaths: [one, two],
    runOcr: async ({ imagePath, outputText }) => {
      if (imagePath.endsWith("002.webp")) {
        throw new Error("vision failed");
      }
      await writeFile(outputText, "first image text\n");
    },
    prepareImage: async ({ imagePath }) => imagePath,
  });

  const ocr = await readFile(result.ocrMdFile, "utf-8");
  assert.equal(result.ocrCount, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /002\.webp/);
  assert.match(ocr, /first image text/);
  assert.match(ocr, /_No OCR text detected\._/);
});
