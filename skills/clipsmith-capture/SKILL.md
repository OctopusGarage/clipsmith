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

   The normalizer accepts `raw_dir == bundle_dir` (in-place finalize) — when the
   downloader used `--flat true` (XHS) or equivalent, pass the same path for
   both and add `--overwrite`. The normalizer reads the source files into memory
   before the in-place rmtree, so this is safe.

   The final bundle contains:
   - `capture.json` — bundle manifest, including `content_files[]` (post,
     summary, ocr) and `assets[]` (image and video files under `assets/`)
   - `post.md` — extracted post text and metadata
   - `summary.md` — generated summary
   - `ocr.md` or `ocr.txt` (when OCR ran) — raw OCR transcript, declared in
     `capture.json.content_files` with `kind: "ocr-text"`. Do not store OCR text
     only inside `summary.md`; the raw OCR file is part of the reviewable source
     material.
   - `assets/` — image files (`.webp`, `.jpg`, `.jpeg`, `.png`, `.gif`) and
     video files (`.mp4`, `.mov`, `.webm`) moved from the raw dir, each declared
     in `capture.json.assets[]` with `kind: "image"` or `kind: "video"`. The
     validator requires `image` and `video` assets to live under `assets/`; do
     not place them at the bundle root.
5. Validate and finalize:

   ```bash
   clipsmith validate-bundle "<bundle_dir>" --json
   clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir "<state_dir>"
   ```

6. Report the bundle path, status, warnings, and validation issues.

Do not write knowledge records. Do not move the bundle into an external inbox
workspace unless the user explicitly requested an inbox sink.
