# Clipsmith XHS Capture Eval Prompt

Evaluate a XiaoHongShu capture after the raw provider output or committed eval
fixture has been produced.

Inputs:

- `post.md`
- `ocr.md`
- downloaded image/video file list
- `comments.json` and `comments.md`, when comments were requested
- deterministic output from `scripts/eval.mjs`
- optional fresh OCR output from `node scripts/eval.mjs --fixture <profile> --profile <profile> --run_ocr`

Return a short PASS/FAIL report with:

- `verdict`: `PASS` or `FAIL`
- `metadata`: whether title, source URL, note id, and publish time are supported
- `media`: whether all expected images or videos were preserved locally
- `ocr`: whether image text was OCRed by default and saved in `ocr.md`
- `content`: whether the note's meaning is recoverable from `post.md` plus `ocr.md`
- `noise`: whether login, captcha, home page, error page, or unrelated chrome text was captured
- `actions`: concrete fixes required before reporting the capture ready

Rules:

- Do not pass a capture whose deterministic eval failed.
- Do not pass a raw XHS capture without `ocr.md` when images are present.
- Do not pass a capture where `post.md` only has the title and `ocr.md` is empty
  or missing key image text.
- Do not require a summary. The raw XHS provider should preserve evidence; any
  summary is a downstream normalization step.
- Prefer rerunning OCR against committed fixture images when prompt or OCR logic
  changes. Use the fixture profile for stable local AI eval and the live URL
  profile only when network/browser access is available.
- Do not fabricate missing metadata, captions, comments, or OCR text.
