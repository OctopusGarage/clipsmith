# Workflow Plan

## Stage Decision Table

| Situation | Action |
|-----------|--------|
| CDP not responding on port 9223 | Auto-launch Chrome: `open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir=~/.chrome-labali-no-proxy --no-proxy-server`; wait 3s; verify; retry once |
| Article requires WeChat login | Prompt user to log in manually in the opened browser window; do not proceed until confirmed |
| Article title empty | Use `unknown` as title in folder name; proceed with download |
| No images found in content | Check if `data-src` attributes are present; try scrolling page to trigger lazy load |
| Publish time not found | Use today's date prefix with `unknown` suffix |
| Existing folder at output path | Append `-2`, `-3`, etc. rather than overwriting |

## WeChat DOM Extraction

WeChat articles use `#js_content` as the main content container. Key selectors:

| Field | Selector | Fallback |
|-------|----------|---------|
| Title | `#activity-name` | `.rich_media_title`, `og:title` |
| Account name | `#js_name` | `.account_nickname_inner`, `og:site_name` |
| Author | `#js_author_name` | account name |
| Publish time | `#publish_time` | `em#publish_time`, `article:published_time` |
| Content | `#js_content` | — |
| Cover image | `og:image` meta | — |

## Image Extraction

WeChat lazy-loads images via `data-src` attributes (not `src`). Always prefer `data-src`.

- Image CDN domains: `mmbiz.qpic.cn` (content images), `mmbiz.qlogo.cn` (account avatars — skip)
- Image URL format: `https://mmbiz.qpic.cn/mmbiz_jpg/.../640?wx_fmt=jpeg`
- Extension detection: use `wx_fmt` query parameter (`jpeg`, `png`, `gif`, `webp`) when path has no clear extension
- Skip: avatars (`mmbiz.qlogo.cn`), data URIs, non-mmbiz external images

## Output Naming

- Folder: `YYYYMMDD-<sanitized_title>-<article_id>`
- Files: `image_01.jpg`, `image_02.png`, etc. (sequential, 0-padded)
- Metadata: `article.md`

## Output Naming Edge Cases

- Article without publish_time: folder = `YYYYMMDD-<title>-<article_id>`
- Title is empty: folder = `YYYYMMDD-<article_id>`
- Folder already exists: append `-2`, `-3`, etc.

## Bugfix Log

(empty — no bugs recorded yet)
