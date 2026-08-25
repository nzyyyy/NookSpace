# NookSpace 架构

本地优先的个人资料库（macOS / Tauri 2）。业务逻辑在 React + TypeScript 层，
Rust 层是一个"深模块"——所有 SQLite 与文件系统行为都藏在 `Library` 之后。

## 模块与接缝

```
┌─────────────────────────────────────────────────────────────┐
│  React 层                                                    │
│  features/   sidebar · list · detail · palette · quicklook   │
│  stores/     library(数据+动作) · ui(面板) · theme           │
│  core/ipc.ts  typed invoke —— 到 Rust 的唯一接缝             │
│  搜索状态、保存视图与资料库动作收敛在 store/library.ts       │
└──────────────────────────┬──────────────────────────────────┘
                           │ ~30 个 command（薄适配器）
┌──────────────────────────▼──────────────────────────────────┐
│  src-tauri/src/library/   ★ 深模块：Library struct           │
│  db.rs    rusqlite(bundled/backup) + 版本化迁移              │
│  mod.rs   items/collections/tags/trash/attachments 查询与变更│
│  search.rs  搜索语法 · FTS/LIKE · PDF 原生文本索引           │
│  saved.rs   保存视图 CRUD                                    │
│  import.rs  复制 · sha256 去重 · 文件夹→集合 · 冲突处理       │
│  transfer.rs  在线备份 · 导出 · 移动 · 校验切换              │
│  native.rs  非音视频 QuickLook/缩略图 · 默认应用打开         │
│  commands.rs  参数适配，无业务逻辑                            │
└─────────────────────────────────────────────────────────────┘
```

- **深度**：前端学 ~30 个命令获得整个资料库（杠杆）；schema/迁移/去重逻辑集中一处（局部性）。
- **接缝**：DB/FTS/PDF 提取、预览边界、导入与资料库迁移策略都在 `Library`
  内部，React 层只接收 `ListResult`、纯文本片段和状态。
- **异步**：command 均 `async fn` + `spawn_blocking`，DB 阻塞不卡 UI。
- **状态**：Zustand 只管 UI 状态与轻量缓存；数据经 service 层（store 内动作）。

## 数据

- 默认资料库：`~/Library/Application Support/com.nookspace.app/`（SQLite WAL + `files/`）
- 固定启动目录保存 `library-location` 指针；移动/切换后资料库可在其他绝对路径。指针失效时启动失败，不创建空库或静默回退。
- 库内文件：`files/<uuid>/<名.ext>`（导入即复制；新建笔记同为 File，默认 `.md`）
- 缩略图：`~/Library/Caches/com.nookspace.app/thumb/<id>.png`
- 统一 Item 模型（File / Link）；`items.content` 是文本 File 的搜索副本；`meta` JSON 列存类型扩展（如 `sourcePath`、`sha256`）
- 中文搜索路径：三字符以上 FTS5 trigram，1–2 字符 LIKE；PDF 原生文本保留在 `items.extracted_text`，扫描件不做 OCR
- 002 迁移创建外部内容 `items_fts` 和同步触发器；列表最多返回 500 条，命令面板传入 20 条限制
- 备份/移动在临时目录完成 SQLite 完整性与逐文件 SHA-256 校验后原子改名；缩略图缓存不进入资料库副本

## 目录

```
src/
├── app/        壳（三栏、主题、拖拽、快捷键、历史）
├── core/       ipc.ts（类型 + invoke）
├── stores/     library.ts（领域动作）/ ui.ts / theme.ts
├── features/   sidebar · list · detail · palette · quicklook · empty · settings
├── hooks/      useShortcuts
├── lib/        format.ts（日期/大小/mono 元数据行）
├── components/ ui/（shadcn 重写为 Nook token）
└── index.css   设计 token（石色 + 松绿，light/dark）
src-tauri/src/
├── lib.rs / commands.rs
└── library/{mod,db,models,import,native,search,saved,transfer}.rs
```

## 常用命令

```bash
pnpm tauri dev        # 开发（Vite 1420 + 调试窗口）
pnpm build            # tsc + vite build
cargo check -p ...    # 在 src-tauri 下：cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build      # 打包 .app
```
