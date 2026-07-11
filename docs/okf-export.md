# OKF Export

Clipsmith can export a validated capture bundle as an Open Knowledge Format
(OKF) concept document.

OKF export is optional. It does not change the canonical Clipsmith bundle:

- `capture.json` remains the source of capture metadata.
- `post.md`, `summary.md`, and `ocr.md` remain capture content files.
- The OKF file is a projection for knowledge sharing, search, and agent
  consumption.

## Command

```bash
clipsmith export okf /path/to/bundle /path/to/okf-workspace --json
```

Output layout:

```text
<okf-workspace>/
  <platform>/
    <bundle-id>.md
```

If the target file already exists, Clipsmith appends `-2`, `-3`, and so on.

## Mapping

The generated OKF concept uses YAML frontmatter followed by Markdown body
content.

Frontmatter fields:

- `type`: `Article`, `Social Post`, `OCR Capture`, or `Capture`
- `title`: `capture.json.title`, falling back to bundle id
- `description`: short generated capture description
- `resource`: `canonical_url` or `source_url`
- `tags`: `clipsmith`, platform, and capture category
- `timestamp`: `captured_at`, falling back to `published_at`
- `clipsmith_schema`
- `clipsmith_bundle_id`
- `clipsmith_platform`
- `clipsmith_status`

Body content:

1. `post.md`
2. `# Capture Summary` from `summary.md`, when present
3. `# OCR Transcript` from `ocr.md` or `ocr.txt`, when present
4. `# Citations` with the source URL

## Why It Is Not The Default

OKF is a knowledge interchange format. Clipsmith bundles are capture evidence
packages. Keeping them separate avoids metadata drift between `capture.json` and
Markdown frontmatter, preserves strict bundle validation, and lets callers
choose whether they need OKF at all.

Use OKF export when the next system wants an agent-readable knowledge workspace.
Use the original Clipsmith bundle when the next system needs capture evidence,
raw audit files, validation status, or sink-compatible bundle layout.
