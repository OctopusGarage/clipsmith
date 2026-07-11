# Clipsmith WeChat Capture Eval Prompt

Evaluate a WeChat public-account article capture after the raw provider output
or committed eval fixture has been produced.

Inputs:

- `article.md`
- normalized `post.md`
- `article.mhtml`, when available
- downloaded image file list
- deterministic output from `scripts/eval.mjs`
- optional bundle output (`summary.md`, `capture.json`) when the raw article
  folder has been converted into a Clipsmith bundle

Return a short PASS/FAIL report with:

- `verdict`: `PASS` or `FAIL`
- `metadata`: whether title, source URL, article id, account, author, and publish
  time are supported by captured evidence
- `coverage`: whether major article sections and required topic markers are
  present in `article.md` and preserved in `post.md`
- `normalized_post`: whether `post.md` is readable, sectioned, and free of
  collapsed mega-paragraphs
- `media`: whether article images were preserved locally and referenced from
  `article.md` and `post.md`
- `mhtml`: whether the MHTML snapshot was captured or an explicit warning exists
- `noise`: whether login, captcha, deleted-content, home-page, feed, footer, or
  unrelated promotion text dominates the capture
- `actions`: concrete fixes required before reporting the capture ready

Rules:

- Do not pass a capture whose deterministic eval failed.
- Do not pass a live WeChat article capture whose `article.md` is only metadata,
  title, or a short teaser.
- Do not pass a capture without a normalized `post.md`.
- Do not pass a `post.md` that is just copied raw `article.md` with one collapsed
  paragraph.
- Do not pass a live capture when required topic markers are absent from
  `article.md` or `post.md`.
- For user-owned fixtures, preserve full captured evidence and the normalized
  `post.md`. For third-party fixtures, use reduced samples unless permission is
  explicit.
- Do not invent missing metadata, image counts, author names, publish dates, or
  article text.
- Prefer empty fields or warnings over unsupported cleanup.
