# clipsmith-xhs

通过已登录的 Chrome CDP 会话抓取小红书帖子到本地目录。

## 快速使用

```bash
cd <clipsmith-repo>/skills/clipsmith-xhs
npx tsx scripts/run.ts \
  --post_url "https://www.xiaohongshu.com/explore/<note_id>?xsec_token=..." \
  --output_dir "/absolute/output/dir"
```

支持 `xhslink.cn` 和 `xhslink.com` 短链。导航时保留原始 query 参数；输出中
统一记录 canonical 链接：`https://www.xiaohongshu.com/explore/<note_id>`。

不传 `post_url` 或 `output_dir` 时，runner 会交互式询问。

## 输出

raw 目录包含：

- `post.md`
- 帖子图片
- 基于图片生成的 `ocr.md`
- 帖子视频（如果有）
- 可选的 `comments/comments.json` 和 `comments/comments.md`
- 不生成 `manifest.json`

默认会创建带日期的帖子子目录。传入 `--flat true` 时，直接写入
`--output_dir`。

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--profile_dir` | `~/.chrome-labali-no-proxy` | Chrome user-data-dir |
| `--cdp_port` | `9223` | Chrome DevTools 端口 |
| `--proxy_mode` | `none` | `none`、`system` 或 `custom` |
| `--proxy_server` | 空 | `proxy_mode=custom` 时必填 |
| `--close_browser_on_success` | `false` | 仅在完整成功后关闭当前 CDP Chrome |
| `--timeout_ms` | `90000` | 导航和提取超时 |
| `--overwrite` | `false` | 覆盖同名输出文件 |
| `--include_comments` | `false` | 尽力导出评论 |
| `--flat` | `false` | 直接写入 `output_dir` |

只有当这个 CDP Chrome 专用于自动化时，才建议使用
`--close_browser_on_success true`。失败或部分成功时会保留浏览器现场，方便人工
检查。

## 浏览器模型

XHS 使用 Clipsmith shared browser runtime 处理 CDP 启动、代理参数、端口探测
和可选关闭。provider 自己只负责小红书导航、风控判断、轮播顺序、媒体下载、
OCR 和评论。

默认启动方式：

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/.chrome-labali-no-proxy" \
  --no-proxy-server
```

runner 会优先复用已有小红书标签页；没有时，在同一个 CDP 浏览器中打开新标签。

## 规范化与验证

生成最终 Clipsmith bundle：

```bash
uv run clipsmith normalize raw xhs "<raw_dir>" "<bundle_dir>" \
  --source-url "<original_url>" \
  --canonical-url "<canonical_url>" \
  --title "<title>" \
  --captured-at "<iso8601_time>" \
  --json

uv run clipsmith validate-bundle "<bundle_dir>" --json
```

原地 normalize 时加 `--overwrite`。

## 可靠性说明

- 小红书访问受登录态、URL token、IP 信誉和平台风控影响。
- 评论导出是尽力而为，可能漏掉回复、图片或层级关系。
- 视频分段合并依赖本机 `ffmpeg`。
- 如果媒体为空，优先用带完整 token 的原始分享链接重试。
- 遇到硬风控信号时，停止自动重试，保留浏览器现场人工检查。

## 源码仓库检查

修改 provider 后，至少运行：

```bash
bash tests/test_regression.sh
node scripts/eval.mjs \
  --fixture xhs-skill-long-term-asset \
  --profile xhs-skill-long-term-asset
```

修改 OCR 行为时，再运行 fresh OCR eval：

```bash
node scripts/eval.mjs \
  --fixture xhs-skill-long-term-asset \
  --profile xhs-skill-long-term-asset \
  --run_ocr
```
