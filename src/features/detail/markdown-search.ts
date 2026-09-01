import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

export interface MarkdownSearchOptions {
  search: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export interface MarkdownSearchMatch {
  blockIndex: number;
  from: number;
  to: number;
}

export function searchMarkdownBlocks(
  blocks: readonly { searchText: string }[],
  options: MarkdownSearchOptions,
) {
  if (!options.search) return { valid: true, matches: [] as MarkdownSearchMatch[] };
  const query = new SearchQuery(options);
  if (!query.valid) return { valid: false, matches: [] as MarkdownSearchMatch[] };

  const state = EditorState.create({ doc: blocks.map((block) => block.searchText).join("\n") });
  const matches: MarkdownSearchMatch[] = [];
  let offset = 0;
  blocks.forEach((block, blockIndex) => {
    const end = offset + block.searchText.length;
    const cursor = query.getCursor(state, offset, end);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      if (next.value.to > next.value.from) {
        matches.push({
          blockIndex,
          from: next.value.from - offset,
          to: next.value.to - offset,
        });
      }
    }
    offset = end + 1;
  });
  return { valid: true, matches };
}
