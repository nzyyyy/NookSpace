import assert from "node:assert/strict";
import test from "node:test";
import {
  createSerialNoteSaver,
  readNoteDraft,
  settleNoteDraft,
  writeNoteDraft,
} from "../src/lib/note-draft.ts";

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("draft recovery only uses the matching database version", () => {
  const store = storage();
  const draft = { id: "n", title: "new", content: "body", baseUpdatedAt: "1" };
  writeNoteDraft(store, draft);
  assert.deepEqual(readNoteDraft(store, { ...draft, title: "old" }), draft);
  assert.equal(readNoteDraft(store, { ...draft, title: "old", baseUpdatedAt: "2" }), null);
  settleNoteDraft(store, { ...draft, title: "older" }, "2");
  assert.equal(readNoteDraft(store, { ...draft, title: "old", baseUpdatedAt: "2" })?.title, "new");
  settleNoteDraft(store, { ...draft, baseUpdatedAt: "2" }, "3");
  assert.equal(readNoteDraft(store, { ...draft, baseUpdatedAt: "3" }), null);
});

test("serial saver never overlaps and saves the newest queued draft", async () => {
  const pending = [];
  const calls = [];
  const saver = createSerialNoteSaver({
    delay: 60_000,
    save: (draft) => {
      calls.push(draft.content);
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  saver.schedule({ id: "n", title: "", content: "one", baseUpdatedAt: "1" });
  const flushing = saver.flush();
  saver.schedule({ id: "n", title: "", content: "two", baseUpdatedAt: "1" });
  assert.deepEqual(calls, ["one"]);
  pending.shift()("2");
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["one", "two"]);
  pending.shift()("3");
  await flushing;
});

test("failed saves keep the recovery draft", async () => {
  const store = storage();
  const draft = { id: "n", title: "new", content: "body", baseUpdatedAt: "1" };
  writeNoteDraft(store, draft);
  let failed = false;
  const saver = createSerialNoteSaver({
    delay: 60_000,
    save: async () => null,
    onFailed: () => { failed = true; },
  });
  saver.schedule(draft);
  await saver.flush();
  assert.equal(failed, true);
  assert.deepEqual(readNoteDraft(store, { ...draft, title: "old" }), draft);
});
