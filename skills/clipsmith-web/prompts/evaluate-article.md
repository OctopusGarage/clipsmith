# Clipsmith Web Article Eval Prompt

Evaluate a normalized Clipsmith web bundle after `post.md`, `summary.md`, and
`capture.json` have been rewritten.

Inputs:

- `post.md`
- `summary.md`
- `capture.json`
- `raw/rendered.txt`
- `raw/metadata.json`
- the deterministic eval output from `scripts/eval.mjs`

Return a short PASS/FAIL report with:

- `verdict`: `PASS` or `FAIL`
- `coverage`: whether the major article sections from the raw text are present
  in `post.md`
- `noise`: whether site chrome, related links, newsletter text, table of
  contents, or footer text remains
- `metadata`: whether title, source URL, status, author, and published date are
  supported by raw evidence
- `actions`: concrete fixes required before the bundle can be reported ready

Rules:

- Do not pass a bundle whose deterministic eval failed.
- Do not pass a bundle whose `post.md` is only the script draft when obvious
  cleanup remains, such as duplicate title lines, `Share`, `Keep reading`,
  newsletter prompts, or footer/legal links.
- Do not require perfect typography. The eval is about factual completeness,
  noise removal, and bundle safety.
- Do not invent missing metadata. Prefer empty fields over unsupported values.
