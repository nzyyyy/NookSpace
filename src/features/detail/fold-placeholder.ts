import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const OBJECT = new Set(["Object", "BlockMapping", "FlowMapping"]);
const ARRAY = new Set(["Array", "BlockSequence", "FlowSequence"]);
const OBJECT_CHILD = new Set(["Property", "Pair"]);
const ARRAY_CHILD = new Set(["Object", "Array", "String", "Number", "True", "False", "Null", "Item"]);

function countChildren(node: SyntaxNode, names: Set<string>) {
  let count = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (names.has(child.name)) count += 1;
  }
  return count;
}

export function foldPlaceholderLabel(state: EditorState, range: { from: number; to: number }): string {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1);
  while (node) {
    if (OBJECT.has(node.name)) return `{ ${countChildren(node, OBJECT_CHILD)} 个字段 }`;
    if (ARRAY.has(node.name)) return `[ ${countChildren(node, ARRAY_CHILD)} 项 ]`;
    node = node.parent;
  }
  return "…";
}
