# Nook — 安静的本地资料库

一个运行在 macOS 上的个人资料库：笔记、文件、链接统一管理，全部数据保存在本机，
不依赖任何服务器。灵感来自线性与纸质目录卡——排版与细节见 `docs/ARCHITECTURE.md`。

## 功能（MVP）

- **笔记**：创建/编辑/删除，Markdown 存储，防抖自动保存
- **阅读**：安全 GFM 阅读态，未保存草稿恢复
- **文件**：Finder 拖拽 / 菜单导入（复制进库、源文件不动）、文件夹递归导入自动建集合、SHA-256 去重
- **组织**：层级集合（多对多）、彩色标签、收藏、最近、未分类、回收站（软删除可恢复）
- **搜索**：列表内搜索 + `Cmd+K` 全局命令面板
- **预览**：图片/PDF 内置预览、`Space` 快速查看、系统 QuickLook、默认应用打开
- **视图**：列表 / 缩略图网格切换
- **多选批量**：加标签 / 加入集合 / 收藏 / 删除
- **键盘优先**：全量快捷键见下方；明暗主题跟随系统

## 开发

```bash
pnpm install
pnpm tauri dev        # 开发模式（热更新）
pnpm build            # 前端类型检查 + 构建
pnpm run package      # 打包唯一的 .app 并复制到 dist/
```

Rust 侧（`src-tauri/`）：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

## 快捷键

| 快捷键 | 动作 |
|---|---|
| `Cmd+N` / `Cmd+Shift+N` | 新建笔记 / 导入文件 |
| `Cmd+K` | 命令面板（全局搜索 + 动作） |
| `Cmd+F` | 聚焦搜索 |
| `Cmd+1/2/3` | 收藏 / 最近 / 未分类 |
| `Space` | 快速查看（再按关闭） |
| `Enter` | 打开选中项 |
| `↑` / `↓` | 列表导航 |
| `Cmd+[` / `Cmd+]` | 后退 / 前进 |
| `Delete` | 移到回收站 |
| `Cmd+,` | 设置 |

## 数据位置

- 数据库与库内文件：`~/Library/Application Support/com.nookspace.app/`
- 缩略图缓存：`~/Library/Caches/com.nookspace.app/`

## 文档

- `docs/PRODUCT.md` — 产品文档（最终形态规格 + 路线图）
- `docs/ARCHITECTURE.md` — 模块与接缝
- `docs/adr/` — 关键决策记录
- `CONTEXT.md` — 领域词汇表
