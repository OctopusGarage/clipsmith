# clipsmith-xhs 使用说明

这个 skill 用于通过浏览器自动化把小红书帖子资源下载到本地目录。

当前输出规则：
- 生成 `post.md`
- 下载帖子图片
- 帖子有视频时下载视频
- 传入 `--include_comments true` 时导出评论（`comments.json` + `comments.md`，**实验性，结果不保证完整/准确**）
- 评论导出会写入独立的 `comments/` 子目录
- 若视频有多个分段，自动合并为 `video-merged.mp4` 并删除分段文件
- **不**生成 `manifest.json`

## 1) 安装与更新

从 GitHub 安装：

```bash
npx skills add /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-xhs
```

更新到最新版本：再次执行安装命令。

## 2) 快速使用

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-xhs
npx tsx scripts/run.ts \
  --post_url "https://www.xiaohongshu.com/explore/<note_id>?xsec_token=...&xsec_source=pc_user" \
  --output_dir "/absolute/output/dir"
```

可选参数：
- `--profile_dir ~/.chrome-labali-no-proxy`
- `--cdp_port 9223`
- `--proxy_mode none|system|custom`
- `--proxy_server http://127.0.0.1:7890`
- `--timeout_ms 90000`
- `--overwrite true|false`
- `--include_comments true|false`

如果不传 `post_url` 或 `output_dir`，脚本会交互式询问。

## 3) 执行流程

1. 通过 CDP 启动/复用 Chrome（`open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir=... --no-proxy-server`）。
2. 通过 CDP 建立连接。
3. 打开小红书首页并检查登录状态。
4. 如未登录，暂停等待手动登录。
5. 打开目标帖子链接。
6. 优先从页面状态提取帖子数据，失败时走 DOM 兜底。
7. 输出链接统一标准化为：`https://www.xiaohongshu.com/explore/<note_id>`。
8. 以 `<publish_time>-<note_id>` 创建目录。
9. 下载图片和视频。
10. 若视频分段 > 1，合并为 `video-merged.mp4` 并清理临时文件。
11. 写入 `post.md`。
12. 若 `include_comments=true`，提取评论并写入 `comments/comments.json` 与 `comments/comments.md`。
13. 若评论含图片，下载到 `comments/images/`。

## 4) 技术实现方法

执行技术栈：
- 浏览器启动：系统命令（`open -na "Google Chrome" ... --remote-debugging-port=<port>`）
- CDP 通信：Playwright `connectOverCDP`
- 数据提取：
  - 主路径：`window.__INITIAL_STATE__.note.noteDetailMap`
  - 兜底路径：固定 DOM selector + 媒体 URL 过滤规则
- 评论提取：
  - 主路径：从 `window.__INITIAL_STATE__` 做结构化扫描
  - 兜底路径：评论 DOM selector（含用户名/用户ID、回复关系字段）
  - 分页策略：滚动 + 点击“展开/更多/回复/下一页”等元素，尽量抓取更多评论与回复
- 评论资源：
  - 评论图片下载到 `comments/images/`
- 资源下载：复用浏览器登录态的请求上下文
- 视频合并：`ffmpeg concat`（优先无损 `copy`，失败再转码）

## 5) 输出结构

示例：

```text
<output_dir>/
  <publish_time>-<note_id>/
    001.webp
    002.webp
    video-merged.mp4   (有视频时)
    post.md
    comments/          (传入 --include_comments true 时)
      comments.json
      comments.md
      images/
        001.webp
        002.webp
```

## 6) 局限与脆弱点

这个 skill 目前是“结构化规则驱动”，不是完全自动推理。主要风险：

1. 前端状态结构漂移
- 主提取依赖 `__INITIAL_STATE__.note.noteDetailMap`。
- 小红书改 schema 后可能失效。

2. DOM 兜底是写死选择器
- 兜底依赖固定 selector 和规则。
- 大改版时可能抓不到或抓偏。

3. 登录与风控变化
- 登录判断是启发式（URL/文案关键词）。
- 风控策略变化可能导致 404/重定向/空内容。

4. canonical 链接可访问性
- 某些会话/区域下，`/explore/<note_id>` 可能无法直接访问。
- 运行时会用你提供的原始链接导航，但输出统一 canonical 链接。

5. 视频分段与编码限制
- 多段视频合并依赖本机 `ffmpeg`。
- 未安装 `ffmpeg` 时无法自动合并。

6. 评论下载功能不完善（重要）
- 评论提取是“尽力而为”能力，不保证总能完整覆盖全部一级/二级评论、回复关系、图片与表情资源。
- 页面结构、风控、懒加载策略变化时，可能出现漏抓、层级错位或关联不完整。

## 7) 常见问题排查

- 如果结果为空：
  - 先确认当前 Chrome 已登录小红书。
  - 优先使用带 token 的来源链接进行导航。
- 如果视频未合并：
  - 安装 `ffmpeg` 并确保在 `PATH` 中可执行。
- 如果目录中有历史文件：
  - 加 `--overwrite true` 重新执行。

## 8) 后续维护建议

页面变化时建议优先修复：
1. `__INITIAL_STATE__` 提取路径
2. DOM 兜底规则（保持最小化）
3. 输出契约（`post.md` + 图片 + 合并后视频 + 无 manifest）
