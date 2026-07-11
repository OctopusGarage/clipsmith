# Clipsmith X Capture Eval Prompt

Evaluate an X/Twitter capture after the raw provider output or committed eval
fixture has been produced.

Inputs:

- `post.md`
- downloaded image/video file list
- `article.mhtml`, when present
- deterministic output from `scripts/eval.mjs`
- optional bundle output (`summary.md`, `capture.json`) when the raw post folder
  has been converted into a Clipsmith bundle

Return a short PASS/FAIL report with:

- `verdict`: `PASS` or `FAIL`
- `metadata`: whether author handle, canonical URL, post id, timestamp, and
  engagement metadata are supported by captured evidence
- `post_type`: whether the output matches text-only, media, article, or video
  expectations
- `text`: whether the post body is complete and t.co links are resolved when
  present
- `media`: whether expected images/videos are preserved locally
- `mhtml`: whether X article captures include an MHTML snapshot and regular
  posts omit it when appropriate
- `noise`: whether login, signup, retry, rate-limit, captcha, sidebar, or feed
  text dominates the capture
- `actions`: concrete fixes required before reporting the capture ready

Rules:

- Do not pass a capture whose deterministic eval failed.
- Do not pass a text-only capture whose `post.md` is only metadata or an empty
  body.
- Do not pass a media capture when expected image/video files are missing.
- Do not pass an X article capture without `article.mhtml`.
- Do not require third-party full text or media to be committed as fixtures.
  Store complete fixtures only for user-owned posts or explicitly permitted
  content.
- Do not invent missing metadata, image counts, video counts, timestamps, or post
  text.
