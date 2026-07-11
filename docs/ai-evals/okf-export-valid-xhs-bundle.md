# OKF Export AI Eval: valid-xhs-bundle

Date: 2026-07-11

Input bundle: `tests/fixtures/valid-xhs-bundle`

Command:

```bash
uv run clipsmith export okf tests/fixtures/valid-xhs-bundle /tmp/clipsmith-okf-smoke --json
```

Generated concept:

```text
/tmp/clipsmith-okf-smoke/xhs/20260707-example-xhs.md
```

## Verdict

PASS

## Evaluation

- OKF shape: The output is a UTF-8 Markdown concept document with YAML
  frontmatter followed by Markdown body content.
- Required OKF field: `type` is present and non-empty.
- Recommended fields: `title`, `description`, `resource`, `tags`, and
  `timestamp` are populated from `capture.json`.
- Clipsmith preservation: The original bundle remains unchanged; `capture.json`
  stays the canonical metadata source.
- Body quality: `post.md` content is preserved, `summary.md` is appended under
  `# Capture Summary`, and the source URL is listed under `# Citations`.
- Noise/drift: The export does not include raw bundle JSON, local paths, tests,
  eval assets, or unrelated filesystem data.

## Notes

This eval checks the OKF projection contract, not capture quality. Capture
quality remains covered by bundle validation and provider quality gates.
