# Capture Bundle Contract

A Clipsmith bundle is a portable directory with `capture.json`, `post.md`, and
`summary.md`. Image OCR captures may also keep the OCR source picture as a
separate file. Consumers should read `capture.json`, not infer meaning from
filenames.

Schema: `clipsmith.capture_bundle.v1`.

## Required Fields

- `schema`: `clipsmith.capture_bundle.v1`
- `id`: stable bundle id and sink folder name
- `platform`: `xhs`, `x`, `wechat`, `web`, or `image-ocr`
- `source_url`: original URL or local file path
- `content_files`: relative content file references
- `assets`: relative OCR image file references, or an empty array
- `warnings`: warning strings
- `status`: `complete`, `partial`, `failed`, or `needs_manual_action`

Common optional fields:

- `canonical_url`
- `title`
- `author`
- `published_at`
- `captured_at`

## File References

`content_files` entries:

- `path`: relative path inside the bundle
- `kind`: `summary` or `post`
- `required_for_review`: whether the file must exist

`assets` entries:

- `path`: relative path inside the bundle
- `kind`: `ocr-image`

Final bundle directories may contain only:

- `capture.json`
- `post.md`
- `summary.md`
- OCR image files referenced from `assets` with kind `ocr-image`

Paths must stay inside the bundle. Absolute paths and `..` traversal are
validation issues.

## Validate

```bash
clipsmith validate-bundle /path/to/bundle --json
```

Exit code `0` means valid. Exit code `1` means invalid or incomplete.

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
    {"path": "post.md", "kind": "post", "required_for_review": true}
  ],
  "assets": [],
  "warnings": [],
  "status": "complete"
}
```
