# 0003 — 自定义 Rust commands + rusqlite（bundled），不用 tauri-plugin-sql

**状态**：已接受（2025-08）

## 背景

SQLite 访问层是架构的基石：迁移、事务、未来全文检索都依赖它。

## 决策

用 **rusqlite `bundled`** 编译自带 SQLite（FTS3/FTS5/JSON1/RTREE 由构建参数保证），
所有 DB 操作收敛在 `src-tauri/src/library/` 这一个深模块里，
通过 ~28 个薄 command 暴露给前端；事务与迁移完全自管。

## 备选

- **tauri-plugin-sql（sqlx）**：上手快、SQL 写在 JS 层，但它链 **系统 SQLite**，
  FTS5 是否可用取决于 macOS 版本（不可控）；事务与迁移能力受限。

## 后果

- FTS5 可用性确定，未来全文检索零迁移。
- Rust 层保持"薄"：commands 只是参数适配，业务逻辑仍在 TS service 层。
- 每个 command 都是 `async fn` + `spawn_blocking`，DB 阻塞不会卡住 UI 线程。
