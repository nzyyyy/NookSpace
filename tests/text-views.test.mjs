import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/lib/text-views.ts";
import { parseStructuredDocuments } from "../src/lib/structured-data.ts";
import { canonicalFormat, displayStem, isSwitchableText } from "../src/lib/file-types.ts";

test("structured json parses values and limits oversized trees", () => {
  assert.deepEqual(parseStructuredDocuments("json", '{"a":[1,true,null]}'), {
    ok: true,
    documents: [{ a: [1, true, null] }],
  });
  assert.equal(parseStructuredDocuments("json", "{nope").ok, false);
  assert.equal(parseStructuredDocuments("json", JSON.stringify(Array(9_999).fill(null))).ok, true);
  assert.deepEqual(
    parseStructuredDocuments("json", JSON.stringify(Array(10_000).fill(null))),
    { ok: false, reason: "tooLarge", message: "结构超过 10,000 个节点" },
  );
});

test("structured yaml parses nested and multiple documents", () => {
  assert.deepEqual(parseStructuredDocuments("yaml", "name: Nook\nitems:\n  - 1\n  - true\n---\nnull\n"), {
    ok: true,
    documents: [{ name: "Nook", items: [1, true] }, null],
  });
  assert.equal(parseStructuredDocuments("yaml", "items: [1").ok, false);
  assert.deepEqual(parseStructuredDocuments("yaml", "self: &self [*self]\n"), {
    ok: false,
    reason: "invalid",
    message: "循环别名无法展示",
  });
});

test("csv parser splits quoted fields and rejects unclosed quotes", () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,"x,y"\r\n2,"x""y\nline"\r\n'), [
    ["a", "b"],
    ["1", "x,y"],
    ["2", 'x"y\nline'],
  ]);
  assert.equal(parseCsv('"unclosed'), null);
  assert.deepEqual(parseCsv(""), []);
});

test("switchable text formats strip stems", () => {
  assert.equal(canonicalFormat("markdown"), "md");
  assert.equal(isSwitchableText("files/x/note.md"), true);
  assert.equal(isSwitchableText("photo.png"), false);
  assert.equal(displayStem("data.csv", "files/1/data.csv"), "data");
  assert.equal(displayStem("无标题", "files/1/无标题.md"), "无标题");
});
