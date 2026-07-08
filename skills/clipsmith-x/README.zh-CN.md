# clipsmith-x

浏览器自动化技能，下载 X（Twitter）帖子的文字、图片和视频到本地文件夹。

## 快速开始

```bash
npx tsx scripts/run.ts \
  --post-url "https://x.com/<user>/status/<tweet_id>" \
  --output-dir "~/Downloads/x"
```

## 功能

- **文字**: 将作者、时间戳和完整推文文本提取到 `post.md`；自动将 t.co 短链接展开为完整 URL
- **图片**: 下载所有帖子图片并去重
- **视频**: 帖子含视频时下载
- **浏览器复用**: 通过 CDP 使用你已有的 Chrome 已登录会话

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--post-url` | 交互提示 | 完整 x.com 帖子链接 |
| `--output-dir` | `~/Downloads/x` | 保存目录 |
| `--profile-dir` | `~/.chrome-labali` | Chrome 配置目录 |
| `--cdp-port` | `9222` | Chrome DevTools 端口 |
| `--timeout-ms` | `90000` | 导航超时（毫秒）|
| `--overwrite` | `false` | 是否覆盖已有文件 |

## 前置条件

- macOS 或 Linux
- Chrome 在 9222 端口开启远程调试
- Node.js ≥ 20
- pnpm

## 配置 Chrome

Chrome 需要开启远程调试并已登录 X。一次性配置：

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-labali" \
  --no-proxy-server
```

然后在打开的 Chrome 窗口中登录 x.com。
