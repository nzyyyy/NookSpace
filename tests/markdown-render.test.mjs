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
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /class="task-list"/);
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /class="language-ts"/);
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
