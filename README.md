# JeromeJtw.github.io

JeromeJtw 的个人知识管理、工程项目与创作作品网站。

## 信息架构

- 知识领域：UE、AI、C++ 多线程与并发、摄影、文学阅读与写作。
- 学习日志：跨领域统一时间线，通过 Frontmatter 标记领域与系列。
- 项目与作品：跨领域聚合，项目正文保留在最合适的领域内。
- UE 面试展示：为 UE 客户端岗位提供独立、聚焦的精选入口。

## 技术栈

- VitePress 1.6.4
- Vue 3.5.39
- Mermaid 11.16.0
- vitepress-plugin-mermaid 2.0.17
- pnpm 11.13.0
- GitHub Actions + GitHub Pages

## 本地运行

```powershell
pnpm.cmd install
pnpm.cmd docs:dev
```

生产构建：

```powershell
pnpm.cmd docs:build
pnpm.cmd docs:preview
```

## 内容边界

- 网站技术框架由 Codex 维护。
- 学习博客正文由 JeromeJtw 亲自撰写。
- 公开内容不得包含 Token、密码、私有路径、前公司内部信息或许可不明确的资产。
- 大型视频、RAW 原片和全尺寸媒体不提交到本仓库；网站只保存压缩展示素材、说明和外部链接。

## 写作入口

- 写作流程：`docs/journal/writing.md`
- 日志模板：`docs/drafts/day-log-template.md`
- 全站内容：`docs/`
