# Content Admin · 美术 Web 配置工具

本地暗主题 Web UI，美术不需要会 git 也能改 chip / sprite / layout，然后一键 Publish。

## 启动

```bash
cd ~/dev/disney-solitaire-content-poc/admin
python3 server.py
```

自动浏览器打开 http://127.0.0.1:8767/admin/

需要：
- Python 3.x（stdlib only，无 pip 依赖）
- git CLI 配置完成 + GitHub 访问权（SSH key 或 PAT）
- 本机 git 用户能 push 到 marseilles2019/disney-solitaire-content-poc

## 功能

| 区域 | 状态 |
|---|---|
| HomeMap 章节条配置 | ✅ 完整 — chip_spacing / padding / chip PNG 替换 |
| 媒体库 Media Library | ✅ 完整 — 浏览 + 多文件上传 |
| 卡牌资源 / 章节背景 / 关卡数据 / 本地化文案 | ⚠️ Placeholder · Phase 5+ |
| Publish | ✅ 完整 — modal 预览 + auto-bump manifest.version + git push |

## Workflow

1. 美术启动 server → 浏览器打开 admin UI
2. 在 HomeMap 改 spacing / 替换 chip PNG
3. 字段改动 2 秒后 auto-save 到本地 file system (git dirty 但 not committed)
4. 全部完事后点 **Publish**
5. 看 modal 确认要改动的 file 列表 → Confirm
6. server 跑 `git add public/ + git commit + git push origin main`
7. Toast 显示新 commit hash + new manifest version

## 限制

- **本机 only** — 跑在 localhost:8767，不绑 0.0.0.0
- **单用户** — 无 lock；多人同时改会冲突
- **不能上传 .otf/.ttf 字体或 .anim 动画** — 这俩需 dev 在 Unity 端 build 进 Resources/ (见 Phase 4c/4d 设计)
- **没有撤销** — git 历史可 revert，但 admin 不提供 UI undo

## 测试

后端 stdlib unittest:
```bash
cd ~/dev/disney-solitaire-content-poc/admin
python3 -m unittest test_server.py -v
```

端到端手验记录见 SMOKE-TEST.md。

## 故障排查

| 症状 | 修法 |
|---|---|
| Publish 失败 "git_push_failed" | `cd ~/dev/disney-solitaire-content-poc && git pull --rebase` 然后重试 |
| Upload 失败 "size_too_large" | 文件超 10 MB；先压缩 |
| Publish 后 Unity 看不到变化 | 等 jsDelivr propagation (~10s) + 删 Unity persistentDataPath/content_cache + 重 Play |
| Port 8767 被占 | `CONTENT_ADMIN_PORT=8769 python3 server.py` 换端口 |
