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
   assets. Before returning, it must perform the `raw-output-to-capture.json`
   normalization step: convert that output into a bundle directory containing
   `capture.json` plus the captured content files/assets.
5. Validate and finalize:

   ```bash
   clipsmith validate-bundle "<bundle_dir>" --json
   clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir "<state_dir>"
   ```

6. Report the bundle path, status, warnings, and validation issues.

Do not write OKF knowledge records. Do not move the bundle into an Alcove
workspace unless the user explicitly requested an Alcove sink.
