# 0004 — 中文检索路径：LIKE → trigram → jieba，保留原文列

**状态**：已接受（2025-08）

## 背景

中文没有空格分词，SQLite FTS5 的内置 tokenizer（simple/unicode61）会把连续中文
当成一个词，检索不可用；ICU tokenizer 需要自定义编译 SQLite（rusqlite bundled
未启用），成本高。

## 决策

- **MVP**：`LIKE '%q%'` 匹配 标题 + 笔记内容 + URL（中文无压力，数据量小足够快）。
- **近期升级**：FTS5 `trigram` tokenizer（子串搜索可用，查询 <3 字符回退 LIKE）。
- **远期**：jieba-rs 分词 + `simple` tokenizer 重建索引，获得最佳精度。
- **关键**：`items.content` 始终保留**原文**，任何阶段都可重建 FTS 表，无需重新录入。

## 备选

- 一开始就上 ICU tokenizer：需 fork/patch libsqlite3-sys，维护负担大 —— 拒绝。

## 后果

- 搜索相关代码收敛在 `list_items` 的 `query` 分支；未来替换 FTS 表只改这一处。
- 需要全文检索时，数据零成本可迁移。
