import assert from "node:assert/strict";
import test from "node:test";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { foldPlaceholderLabel } from "../src/features/detail/fold-placeholder.ts";

function stateWith(doc, extension) {
  const state = EditorState.create({ doc, extensions: [extension] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function labeled(state, name) {
  const node = ensureSyntaxTree(state, state.doc.length, 5000)?.topNode.cursor();
  if (!node) return "…";
  do {
    if (node.name === name) {
      return foldPlaceholderLabel(state, { from: node.from + 1, to: node.to });
    }
  } while (node.next());
  return "…";
}

test("json fold placeholder counts fields and items", () => {
  const state = stateWith('{"a":1,"b":[true,null,"x"]}', json());
  assert.equal(labeled(state, "Object"), "{ 2 个字段 }");
  assert.equal(labeled(state, "Array"), "[ 3 项 ]");
});

test("yaml fold placeholder counts mapping pairs and sequence items", () => {
  const state = stateWith("name: Nook\nitems:\n  - 1\n  - true\n", yaml());
  assert.equal(labeled(state, "BlockMapping"), "{ 2 个字段 }");
  assert.equal(labeled(state, "BlockSequence"), "[ 2 项 ]");
});
