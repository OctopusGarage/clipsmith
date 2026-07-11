---
name: clipsmith-capture
description: Capture a URL or local media input into a portable Clipsmith bundle. Routes to platform-specific Clipsmith skills and validates the resulting bundle.
---

# Clipsmith Capture

Use this skill when the user wants to download, save, capture, archive, or OCR a
post, article, or local media item into a Clipsmith bundle.

## Flow

1. Start a job:

   ```bash
   clipsmith capture start "<input>" --state-dir "<state_dir>"
   ```

2. Read the returned `provider`, `job_id`, and `job_path`.
3. Use the matching platform skill:
   - `clipsmith-xhs`
   - `clipsmith-x`
   - `clipsmith-wechat`
   - `clipsmith-web`
   - `clipsmith-ocr`
4. The platform skill may first run a copied downloader that produces raw
   assets. Before returning, it must convert raw output into a bundle with the
   shared normalizer when the provider does not already produce a validated
   bundle:

   ```bash
   uv run clipsmith normalize raw "<provider>" "<raw_dir>" "<bundle_dir>" \
     --source-url "<original_url>" \
     --json
   ```

   The final bundle may contain only `capture.json`, `post.md`, `summary.md`,
   optional `ocr.md`/`ocr.txt` when OCR text was produced, plus separate OCR
   image files when preserving a source image for an image OCR capture.
   - If OCR ran at any point, write the raw OCR transcript to `ocr.md` or
     `ocr.txt` and declare it in `capture.json.content_files` with
     `kind: "ocr-text"`.
   - Do not store OCR text only inside `summary.md`; the raw OCR file is part of
     the reviewable source material.
5. Validate and finalize:

   ```bash
   clipsmith validate-bundle "<bundle_dir>" --json
   clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir "<state_dir>"
   ```

6. Report the bundle path, status, warnings, and validation issues.

Do not write knowledge records. Do not move the bundle into an external inbox
workspace unless the user explicitly requested an inbox sink.
