import assert from "node:assert/strict";
import test from "node:test";
import { prettyJson, parseCsv } from "../src/lib/text-views.ts";
import { canonicalFormat, displayStem, isSwitchableText } from "../src/lib/file-types.ts";

test("pretty json formats valid input and keeps invalid text", () => {
  assert.deepEqual(prettyJson('{"a":1}'), { ok: true, text: '{\n  "a": 1\n}' });
  assert.deepEqual(prettyJson("{nope"), { ok: false, text: "{nope" });
});

test("csv parser splits quoted fields and rejects unclosed quotes", () => {
  assert.deepEqual(parseCsv('a,b\n1,"x,y"'), [["a", "b"], ["1", "x,y"]]);
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
