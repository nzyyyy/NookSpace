import assert from "node:assert/strict";
import test from "node:test";
import { searchMarkdownBlocks } from "../src/features/detail/markdown-search.ts";

const blocks = [
  { searchText: "Alpha alpha alphabet" },
  { searchText: "第二块 alpha" },
];

test("searches rendered blocks with CodeMirror query semantics", () => {
  const plain = searchMarkdownBlocks(blocks, {
    search: "alpha",
    caseSensitive: false,
    regexp: false,
    wholeWord: true,
  });
  assert.equal(plain.valid, true);
  assert.deepEqual(plain.matches, [
    { blockIndex: 0, from: 0, to: 5 },
    { blockIndex: 0, from: 6, to: 11 },
    { blockIndex: 1, from: 4, to: 9 },
  ]);

  const regexp = searchMarkdownBlocks(blocks, {
    search: "Alpha|第二块",
    caseSensitive: true,
    regexp: true,
    wholeWord: false,
  });
  assert.deepEqual(regexp.matches, [
    { blockIndex: 0, from: 0, to: 5 },
    { blockIndex: 1, from: 0, to: 3 },
  ]);
});

test("rejects invalid and zero-width regular expressions", () => {
  const invalid = searchMarkdownBlocks(blocks, {
    search: "[",
    caseSensitive: false,
    regexp: true,
    wholeWord: false,
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.matches, []);

  const zeroWidth = searchMarkdownBlocks(blocks, {
    search: "^",
    caseSensitive: false,
    regexp: true,
    wholeWord: false,
  });
  assert.deepEqual(zeroWidth.matches, []);
});

test("does not match across Markdown block boundaries", () => {
  const result = searchMarkdownBlocks(
    [{ searchText: "结尾" }, { searchText: "开头" }],
    { search: "结尾\n开头", caseSensitive: false, regexp: false, wholeWord: false },
  );
  assert.deepEqual(result.matches, []);
});
