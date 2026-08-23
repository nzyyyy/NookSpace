import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTextFileDraft,
  createSerialTextFileDraftWriter,
} from "../src/lib/text-file-draft.ts";

const document = { content: "disk", version: "v1" };
const draft = {
  itemId: "file",
  content: "draft",
  baseVersion: "v1",
  encoding: "utf8",
  lineEnding: "lf",
};

test("text file drafts recover only from the current file version", () => {
  assert.equal(classifyTextFileDraft(document, null), "none");
  assert.equal(classifyTextFileDraft(document, { ...draft, content: "disk" }), "discard");
  assert.equal(classifyTextFileDraft(document, draft), "recover");
  assert.equal(classifyTextFileDraft(document, { ...draft, baseVersion: "old" }), "conflict");
});

test("text file draft writes never overlap and keep only the newest queued draft", async () => {
  const pending = [];
  const calls = [];
  const writer = createSerialTextFileDraftWriter((value) => {
    calls.push(value.content);
    return new Promise((resolve) => pending.push(resolve));
  });

  writer.schedule({ ...draft, content: "one" });
  writer.schedule({ ...draft, content: "two" });
  writer.schedule({ ...draft, content: "three" });
  const flushing = writer.flush();
  assert.deepEqual(calls, ["one"]);
  pending.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["one", "three"]);
  pending.shift()();
  await flushing;
});
