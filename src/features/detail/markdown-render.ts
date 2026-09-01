import MarkdownIt, { type Env, type Token } from "markdown-it";

export const MAX_MARKDOWN_BLOCK_CHARS = 64 * 1024;
export const MAX_RENDERED_MARKDOWN_BLOCKS = 20_000;
export const MARKDOWN_BLOCK_BATCH_SIZE = 200;

export interface MarkdownBlock {
  key: string;
  html: string;
  searchText: string;
  kind: string;
  estimatedHeight: number;
  sourceLength: number;
  oversized: boolean;
}

export type MarkdownWorkerMessage =
  | { type: "batch"; blocks: MarkdownBlock[]; total: number }
  | { type: "done"; total: number }
  | { type: "error"; message: string };

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

function externalProtocol(url: string) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function httpsImage(url: string) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const defaultText = markdown.renderer.rules.text;
markdown.renderer.rules.text = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const checked = token.meta?.taskChecked;
  if (typeof checked !== "boolean") {
    return defaultText(tokens, index, options, env, renderer);
  }
  return `<input type="checkbox" disabled aria-label="${checked ? "已完成" : "未完成"}"${checked ? " checked" : ""}> ${markdown.utils.escapeHtml(token.content)}`;
};

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  const href = String(token.attrGet("href") ?? "");
  if (externalProtocol(href)) {
    token.attrJoin("class", "markdown-external-link");
    token.attrSet("rel", "noreferrer");
    token.attrSet("data-markdown-link", "external");
  } else {
    const hrefIndex = token.attrIndex("href");
    if (hrefIndex >= 0) token.attrs?.splice(hrefIndex, 1);
    token.attrJoin("class", "markdown-unavailable-link");
    token.attrSet("aria-disabled", "true");
  }
  return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const source = String(token.attrGet("src") ?? "");
  const alt = renderer.renderInlineAsText(token.children ?? [], options, env);
  const escapedAlt = markdown.utils.escapeHtml(alt || "未命名图片");
  if (!httpsImage(source)) {
    return `<span class="markdown-image-unavailable" role="img" aria-label="图片不可用：${escapedAlt}">图片不可用：${escapedAlt}</span>`;
  }
  const title = String(token.attrGet("title") ?? "");
  return `<img src="${markdown.utils.escapeHtml(markdown.normalizeLink(source))}" alt="${escapedAlt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${title ? ` title="${markdown.utils.escapeHtml(title)}"` : ""}>`;
};

function markTaskItems(tokens: Token[]) {
  const lists: Token[] = [];
  const items: Token[] = [];
  for (const token of tokens) {
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      lists.push(token);
    } else if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      lists.pop();
    } else if (token.type === "list_item_open") {
      items.push(token);
    } else if (token.type === "list_item_close") {
      items.pop();
    } else if (token.type === "inline" && items.length > 0) {
      const first = token.children?.[0];
      if (!first || first.type !== "text") continue;
      const match = /^\[([ xX])\]\s+/.exec(first.content);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      first.meta = { ...first.meta, taskChecked: match[1].toLowerCase() === "x" };
      items[items.length - 1]?.attrJoin("class", "task-list-item");
      lists[lists.length - 1]?.attrSet("class", "task-list");
    }
  }
}

function tokenGroups(tokens: Token[]) {
  const groups: Token[][] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    depth += tokens[index].nesting;
    if (depth === 0) {
      groups.push(tokens.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < tokens.length) groups.push(tokens.slice(start));
  return groups;
}

function lineOffsets(source: string) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function sourceRange(group: Token[], offsets: number[], sourceLength: number) {
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  for (const token of group) {
    if (!token.map) continue;
    startLine = Math.min(startLine, token.map[0]);
    endLine = Math.max(endLine, token.map[1]);
  }
  if (!Number.isFinite(startLine)) return { from: 0, to: 0, lines: 1 };
  return {
    from: offsets[startLine] ?? sourceLength,
    to: offsets[endLine] ?? sourceLength,
    lines: Math.max(1, endLine - startLine),
  };
}

function estimateHeight(kind: string, lines: number, html: string) {
  if (kind === "heading") return 52;
  if (html.includes("<img ")) return 280;
  const lineHeight = kind === "fence" || kind === "code_block" ? 22 : 28;
  return Math.max(36, Math.min(800, lines * lineHeight + 16));
}

function safeChunkEnd(source: string, start: number) {
  let end = Math.min(source.length, start + MAX_MARKDOWN_BLOCK_CHARS);
  const code = source.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff && end < source.length) end -= 1;
  return end;
}

function oversizedBlocks(
  source: string,
  baseKey: string,
  warning = "此 Markdown 块过大，已按纯文本分段显示。",
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (let start = 0, part = 0; start < source.length; part += 1) {
    const end = safeChunkEnd(source, start);
    const text = markdown.utils.escapeHtml(source.slice(start, end));
    blocks.push({
      key: `${baseKey}-part-${part}`,
      html: `${part === 0 ? `<p class="markdown-block-warning">${warning}</p>` : ""}<pre class="markdown-oversized-block">${text}</pre>`,
      searchText: source.slice(start, end),
      kind: "oversized",
      estimatedHeight: 480,
      sourceLength: end - start,
      oversized: true,
    });
    start = end;
  }
  return blocks;
}

export function renderMarkdownBlocks(source: string): MarkdownBlock[] {
  const env: Env = {};
  const tokens = markdown.parse(source, env);
  markTaskItems(tokens);
  const offsets = lineOffsets(source);
  const groups = tokenGroups(tokens);
  if (groups.length > MAX_RENDERED_MARKDOWN_BLOCKS) {
    // ponytail: cap DOM bookkeeping; raise this only if real documents need more semantic blocks.
    return oversizedBlocks(source, "document", "Markdown 块数量过多，已按纯文本分段显示。");
  }
  return groups.flatMap((group, index) => {
    const range = sourceRange(group, offsets, source.length);
    const blockSource = source.slice(range.from, range.to);
    const key = `${range.from}-${index}`;
    if (blockSource.length > MAX_MARKDOWN_BLOCK_CHARS) {
      // ponytail: preserve responsiveness for pathological single blocks; add incremental inline parsing if this fallback becomes common.
      return oversizedBlocks(blockSource, key);
    }
    const kind = group[0]?.type.replace(/_(?:open|close)$/, "") ?? "paragraph";
    const html = markdown.renderer.render(group, markdown.options, env);
    return [{
      key,
      html,
      searchText: markdown.utils.unescapeAll(html.replace(/<[^>]*>/g, "")),
      kind,
      estimatedHeight: estimateHeight(kind, range.lines, html),
      sourceLength: blockSource.length,
      oversized: false,
    }];
  });
}

export function markdownBlockBatches(
  blocks: MarkdownBlock[],
  size = MARKDOWN_BLOCK_BATCH_SIZE,
) {
  if (!Number.isInteger(size) || size < 1) throw new Error("Markdown 批次大小必须为正整数");
  const batches: MarkdownBlock[][] = [];
  for (let index = 0; index < blocks.length; index += size) {
    batches.push(blocks.slice(index, index + size));
  }
  return batches;
}
