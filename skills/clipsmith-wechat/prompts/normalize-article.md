# Clipsmith WeChat Article Normalization Prompt

Normalize a raw WeChat `article.md` into a clean reading-oriented `post.md`.

Inputs:

- raw `article.md`
- image file list
- optional `article.mhtml`
- deterministic output from `scripts/eval.mjs`, if available

Output:

- Write only the complete Markdown content for `post.md`.
- Preserve title, account, author when present, publish time, source URL, and
  local image references.
- Preserve the article's full meaning and section order.
- Convert collapsed WeChat text into readable Markdown headings, paragraphs, and
  bullet lists.
- Keep original section titles when they are present in the raw text.
- Split long paragraphs. A normal body line should stay comfortably under a few
  hundred Chinese characters.
- Preserve image captions, quotes, short aphorisms, and named references.

Rules:

- Do not summarize away article content. This is normalization, not a summary.
- Do not invent missing sections, metadata, citations, image captions, or dates.
- Do not keep WeChat UI chrome, login prompts, captcha text, feed text, or footer
  promotions unless they are part of the article body.
- Do not delete the raw `article.md`; `post.md` is the cleaned companion file.
- If a boundary marker such as `⸻` appears, use it to recover section breaks.
- If numbered Chinese section labels appear inline, promote them to headings.
- If bullet markers such as `•` appear inline, convert them to Markdown bullets.
- Keep `article.md` as evidence and make `post.md` pleasant to read.
