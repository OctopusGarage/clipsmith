# Clipsmith Web Article Extraction Prompt

You are normalizing a generic web capture into a Clipsmith bundle.

Inputs:

- `raw/source.html`: cleaned candidate article HTML captured from the browser DOM.
- `raw/rendered.txt`: cleaned visible text from the same candidate region.
- `raw/metadata.json`: capture metadata, final URL, title, and extraction warnings.

Write or replace:

- `post.md`
- `summary.md`
- `capture.json` fields when metadata can be improved without inventing facts.

Rules:

- Treat the raw files as evidence. Do not invent content that is not present.
- Remove navigation, cookie banners, newsletter prompts, related/keep-reading
  modules, footers, menus, social sharing labels, table-of-contents blocks, and
  repeated site chrome.
- Keep exactly one article title as the top-level `#` heading. Remove duplicate
  title/site-title lines such as `<title> | OpenAI`, category labels, and
  repeated hero headings when they do not add content.
- Keep the article deck/subtitle only when it is a real summary sentence, not a
  navigation label.
- Convert article section titles to Markdown headings. Use `##` for major
  sections and `###` for subsections when the source structure supports it.
- Preserve the full article body in order, including headings, lists, quotes, code
  blocks, tables, and links when they are part of the article.
- Keep `post.md` readable Markdown with this shape:

  ```markdown
  # <title>

  Source: <canonical or final URL>
  Author: <author if known>
  Published: <published date if known>

  <complete article body>
  ```

- Write `summary.md` as a concise factual summary. If the article could not be
  confidently extracted, say so and explain what evidence was available.
- Set `capture.json.status` to `complete` only when the article body was
  extracted. Use `partial` or `needs_manual_action` when the raw evidence is a
  challenge page, error page, login wall, or incomplete fragment.
- Keep `capture.json.content_files` limited to `summary.md` and `post.md` unless
  OCR text exists.
- Keep raw audit files in `capture.json.assets` with these exact path/kind pairs:
  - `raw/source.html` as `web-cleaned-html`
  - `raw/rendered.txt` as `web-rendered-text`
  - `raw/metadata.json` as `web-metadata`
  - `raw/source.full.html.gz` as `web-full-html-compressed`, only if present
  - `raw/page.mhtml` as `web-mhtml`, only if present
- Validate the final bundle before reporting it ready.

Self-check before validation:

- `post.md` does not contain standalone lines like `Share`, `Keep reading`,
  `View all`, `Get the developer newsletter`, `Products`, `Careers`, `Terms`,
  `Privacy`, or `Subscribe`.
- `post.md` does not contain a table of contents whose headings are repeated
  later as real sections.
- The first paragraph after metadata is article content, not page chrome.
- Major source sections still appear in order after cleanup.
- If any self-check fails, revise the Markdown before validating.
