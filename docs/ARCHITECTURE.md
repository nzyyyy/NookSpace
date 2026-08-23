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
│  search/preview/import 逻辑都收敛在 store/library.ts         │
└──────────────────────────┬──────────────────────────────────┘
                           │ ~30 个 command（薄适配器）
┌──────────────────────────▼──────────────────────────────────┐
│  src-tauri/src/library/   ★ 深模块：Library struct           │
│  db.rs    rusqlite(bundled) + 版本化迁移                     │
│  mod.rs   items/collections/tags/trash/attachments 查询与变更│
│  import.rs  复制 · sha256 去重 · 文件夹→集合 · 冲突处理       │
│  native.rs  qlmanage 预览/缩略图 · 默认应用打开              │
│  commands.rs  参数适配，无业务逻辑                            │
└─────────────────────────────────────────────────────────────┘
```

- **深度**：前端学 ~30 个命令获得整个资料库（杠杆）；schema/迁移/去重逻辑集中一处（局部性）。
- **接缝**：DB（rusqlite → 未来 FTS）、预览（内置 → qlmanage → 未来插件）、
  导入策略都在 `Library` 内部，React 层永不感知。
- **异步**：command 均 `async fn` + `spawn_blocking`，DB 阻塞不卡 UI。
- **状态**：Zustand 只管 UI 状态与轻量缓存；数据经 service 层（store 内动作）。

## 数据

- SQLite：`~/Library/Application Support/com.nookspace.app/nook.db`（WAL）
- 库内文件：`files/<uuid>/<原名>`（导入即复制，源文件不动）
- 缩略图：`~/Library/Caches/com.nookspace.app/thumb/<id>.png`
- 统一 Item 模型；`meta` JSON 列存类型扩展（如 `sourcePath`、`sha256`）
- 中文搜索路径：LIKE → trigram → jieba（见 `docs/adr/0004`），保留原文列

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
├── lib.rs / commands.rs / library/{mod,db,models,import,native}.rs
```

## 常用命令

```bash
pnpm tauri dev        # 开发（Vite 1420 + 调试窗口）
pnpm build            # tsc + vite build
cargo check -p ...    # 在 src-tauri 下：cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build      # 打包 .app
```
