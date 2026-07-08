# Capture Bundle Contract

A Clipsmith capture bundle is a portable directory with one required
`capture.json` file and zero or more content/media files.

Consumers must read `capture.json` instead of guessing by filenames.

## Required Fields

`capture.json` uses schema `clipsmith.capture_bundle.v1`.

Required fields:

- `schema`: must be `clipsmith.capture_bundle.v1`
- `id`: stable bundle folder id and sink target name
- `platform`: source provider such as `xhs`, `x`, `wechat`, `web`, or
  `image-ocr`
- `source_url`: original source URL or local file path
- `content_files`: list of relative content file references
- `assets`: list of relative media/archive file references
- `warnings`: list of warning strings
- `status`: `complete`, `partial`, `failed`, or `needs_manual_action`

Common optional fields:

- `canonical_url`
- `title`
- `author`
- `published_at`
- `captured_at`

## File References

Each content file entry has:

- `path`: relative path inside the bundle
- `kind`: semantic kind such as `summary`, `post`, `article`, or `ocr`
- `required_for_review`: whether validation requires the file to exist

Each asset entry has:

- `path`: relative path inside the bundle
- `kind`: semantic kind such as `image`, `video`, `mhtml`, or `archive`

Paths must stay inside the bundle root. Absolute paths and traversal outside the
bundle are validation issues.

## Validation

Run:

```bash
clipsmith validate-bundle /path/to/bundle --json
```

The command returns exit code `0` when no issues are found and `1` when the
bundle is invalid or incomplete.

## Minimal Example

```json
{
  "schema": "clipsmith.capture_bundle.v1",
  "id": "20260707-example",
  "platform": "web",
  "source_url": "https://example.com/article",
  "canonical_url": "https://example.com/article",
  "title": "Example Article",
  "author": "",
  "published_at": "",
  "captured_at": "2026-07-07T15:30:00+08:00",
  "content_files": [
    {"path": "summary.md", "kind": "summary", "required_for_review": true},
    {"path": "article.md", "kind": "article", "required_for_review": true}
  ],
  "assets": [],
  "warnings": [],
  "status": "complete"
}
```
