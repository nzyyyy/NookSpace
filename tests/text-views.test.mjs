import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/lib/text-views.ts";

test("csv parser splits quoted fields and rejects unclosed quotes", () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,"x,y"\r\n2,"x""y\nline"\r\n'), [
    ["a", "b"],
    ["1", "x,y"],
    ["2", 'x"y\nline'],
  ]);
  assert.equal(parseCsv('"unclosed'), null);
  assert.deepEqual(parseCsv(""), []);
});
