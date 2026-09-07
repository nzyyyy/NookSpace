import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKDOWN_BLOCK_BATCH_SIZE,
  MAX_MARKDOWN_BLOCK_CHARS,
  MAX_RENDERED_MARKDOWN_BLOCKS,
  markdownBlockBatches,
  renderMarkdownBlocks,
} from "../src/features/detail/markdown-render.ts";

test("renders common GFM blocks and keeps nested lists together", () => {
  const blocks = renderMarkdownBlocks(`# 标题

- [x] 完成 **粗体**
  - 子项
- [ ] 待办

| A | B |
| - | - |
| 1 | 2 |

> 引用

\`\`\`ts
const value = 1;
\`\`\``);
  const html = blocks.map((block) => block.html).join("");

  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "bullet_list", "table", "blockquote", "fence"]);
  assert.equal(blocks.filter((block) => block.kind === "bullet_list").length, 1);
  assert.match(html, /<h1 id="标题">标题<\/h1>/);
  assert.match(html, /class="task-list"/);
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /class="language-ts"/);
  assert.match(blocks.map((block) => block.searchText).join(""), /完成 粗体/);
  assert.doesNotMatch(blocks.map((block) => block.searchText).join(""), /\*\*粗体\*\*/);
});

test("indexes only rendered Markdown text", () => {
  const blocks = renderMarkdownBlocks(`[显示文字](https://example.com/hidden) **粗体** & <tag>

\`inline\`

![远程图片](https://example.com/image.png) ![不可用](./image.png)`);
  const text = blocks.map((block) => block.searchText).join("");

  assert.match(text, /显示文字/);
  assert.match(text, /粗体/);
  assert.match(text, /& <tag>/);
  assert.match(text, /inline/);
  assert.match(text, /图片不可用：不可用/);
  assert.doesNotMatch(text, /example\.com|\*\*|远程图片/);
});

test("escapes raw HTML and limits links and images to allowed protocols", () => {
  const html = renderMarkdownBlocks(`<script>alert(1)</script>

[外链](https://example.com) [相对](./local.md) [危险](javascript:alert(1))

![远程](https://example.com/a.png) ![本地](./a.png) ![明文](http://example.com/a.png)`)
    .map((block) => block.html)
    .join("");

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-markdown-link="external"/);
  assert.match(html, /markdown-unavailable-link/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(html, /loading="lazy"/);
  assert.equal((html.match(/markdown-image-unavailable/g) ?? []).length, 2);
});

test("renders same-document anchors with unique heading ids", () => {
  const blocks = renderMarkdownBlocks(`[章节](#一项目定位它为模型补齐了什么)

# 一、项目定位：它为模型补齐了什么

## **重复** 标题

## 重复 标题`);
  const html = blocks.map((block) => block.html).join("");

  assert.match(html, /href="#%E4%B8%80%E9%A1%B9%E7%9B%AE%E5%AE%9A%E4%BD%8D%E5%AE%83%E4%B8%BA%E6%A8%A1%E5%9E%8B%E8%A1%A5%E9%BD%90%E4%BA%86%E4%BB%80%E4%B9%88"[^>]*data-markdown-link="anchor"/);
  assert.match(html, /id="一项目定位它为模型补齐了什么"/);
  assert.match(html, /id="重复-标题"/);
  assert.match(html, /id="重复-标题-1"/);
  assert.deepEqual(blocks.flatMap((block) => block.anchorIds ?? []), [
    "一项目定位它为模型补齐了什么",
    "重复-标题",
    "重复-标题-1",
  ]);
});

test("marks Mermaid fences for client-side diagram rendering", () => {
  const [block] = renderMarkdownBlocks(`\`\`\`mermaid
flowchart TB
  A --> B
\`\`\``);

  assert.equal(block.kind, "fence");
  assert.equal(block.mermaidSource, "flowchart TB\n  A --> B\n");
  assert.match(block.html, /language-mermaid/);
});

test("splits pathological single blocks without splitting surrogate pairs", () => {
  const source = `${"a".repeat(MAX_MARKDOWN_BLOCK_CHARS - 1)}😀tail`;
  const blocks = renderMarkdownBlocks(source);

  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block) => block.oversized));
  assert.ok(blocks.every((block) => block.sourceLength <= MAX_MARKDOWN_BLOCK_CHARS));
  assert.match(blocks[0].html, /已按纯文本分段显示/);
  assert.doesNotMatch(blocks[0].html, /�/);
  assert.match(blocks[1].html, /😀tail/);
});

test("batches rendered blocks with a fixed upper bound", () => {
  const source = Array.from({ length: MARKDOWN_BLOCK_BATCH_SIZE * 2 + 1 }, (_, index) => `段落 ${index}`).join("\n\n");
  const blocks = renderMarkdownBlocks(source);
  const batches = markdownBlockBatches(blocks);

  assert.deepEqual(batches.map((batch) => batch.length), [MARKDOWN_BLOCK_BATCH_SIZE, MARKDOWN_BLOCK_BATCH_SIZE, 1]);
  assert.throws(() => markdownBlockBatches(blocks, 0));
});

test("falls back to bounded plain-text chunks when a document has too many blocks", () => {
  const source = Array.from({ length: MAX_RENDERED_MARKDOWN_BLOCKS + 1 }, () => "x").join("\n\n");
  const blocks = renderMarkdownBlocks(source);

  assert.ok(blocks.length < 10);
  assert.ok(blocks.every((block) => block.oversized));
  assert.match(blocks[0].html, /块数量过多/);
});
