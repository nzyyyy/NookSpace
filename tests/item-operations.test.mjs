import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createStore } from "zustand/vanilla";

// Exercise the real store with only native IPC and browser services replaced.
const source = ts.transpileModule(readFileSync(new URL("../src/stores/library.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const idsOf = (values) => Array.from(values);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function setup(overrides = {}) {
  const notices = [];
  const ipc = {
    listItems: async () => ({ entries: [], truncated: false }),
    deleteItems: async (ids) => ids,
    restoreItems: async () => {},
    purgeItems: async () => {},
    trashCount: async () => 501,
    emptyTrash: async () => {},
    listCollections: async () => [],
    listTags: async () => [],
    listSavedViews: async () => [],
    ...overrides,
  };
  const exports = {};
  const mocks = {
    zustand: { create: createStore },
    "@/core/ipc": { ipc },
    "@/lib/collections": {},
    "@/lib/file-types": {},
    "@/lib/unlock-duration": {},
    sonner: { toast: Object.fromEntries(["success", "info", "error", "warning"].map((kind) => [kind,
      (message, options) => notices.push({ kind, message, options }),
    ])) },
  };
  runInNewContext(source, {
    exports,
    require: (name) => { assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name]; },
    window: { dispatchEvent() {} },
    CustomEvent: class {},
    setTimeout, clearTimeout,
  });
  return { store: exports.useLibrary, ipc, notices };
}

test("stale detail responses neither replace the current item nor stop its loading state", async () => {
  const a = deferred();
  const b = deferred();
  const { store } = setup({ getItem: (id) => ({ a, b })[id].promise });
  store.setState({ items: [
    { id: "a", effectiveLocked: false },
    { id: "b", effectiveLocked: false },
  ] });

  const first = store.getState().select("a");
  const second = store.getState().select("b");
  a.resolve({ item: { id: "a" }, attachments: [] });
  await first;
  assert.equal(store.getState().detail, null);
  assert.equal(store.getState().detailLoading, true);
  b.resolve({ item: { id: "b" }, attachments: [] });
  await second;
  assert.equal(store.getState().detail.item.id, "b");
  assert.equal(store.getState().detailLoading, false);
});

test("a slower old detail response cannot overwrite a newer completed selection", async () => {
  const a = deferred();
  const b = deferred();
  const { store } = setup({ getItem: (id) => ({ a, b })[id].promise });
  store.setState({ items: [
    { id: "a", effectiveLocked: false },
    { id: "b", effectiveLocked: false },
  ] });

  const first = store.getState().select("a");
  const second = store.getState().select("b");
  b.resolve({ item: { id: "b" }, attachments: [] });
  await second;
  a.resolve({ item: { id: "a" }, attachments: [] });
  await first;
  assert.equal(store.getState().detail.item.id, "b");
});

test("changing views clears an invalidated detail loading state", () => {
  const { store } = setup();
  store.setState({ selectedId: "a", detailLoading: true });
  store.getState().setView({ kind: "favorites" });
  assert.equal(store.getState().selectedId, null);
  assert.equal(store.getState().detailLoading, false);
});

test("refresh detail and locked-session responses cannot overwrite a newer or cleared detail", async () => {
  const a = deferred();
  const b = deferred();
  const locked = deferred();
  const { store } = setup({
    getItem: (id) => ({ a, b, locked })[id].promise,
    getLockSession: async () => ({ unlocked: false, remainingMs: 0 }),
  });
  store.setState({
    selectedId: "a",
    detail: { item: { id: "a" }, attachments: [] },
    items: [
      { id: "a", effectiveLocked: true },
      { id: "b", effectiveLocked: false },
    ],
    lockSession: { unlocked: true, remainingMs: 1000 },
  });

  const refreshing = store.getState().refresh();
  await tick();
  const selecting = store.getState().select("b");
  b.resolve({ item: { id: "b" }, attachments: [] });
  await selecting;
  a.resolve({ item: { id: "a" }, attachments: [] });
  await refreshing;
  assert.equal(store.getState().detail.item.id, "b");

  store.setState({
    selectedId: null,
    detail: null,
    items: [{ id: "locked", effectiveLocked: true }],
    lockSession: { unlocked: true, remainingMs: 1000 },
  });
  store.getState().select("locked");
  await store.getState().syncLockSession();
  locked.resolve({ item: { id: "locked" }, attachments: [] });
  await tick();
  assert.equal(store.getState().detail, null);
});

test("attachment mutations only update the detail that initiated them", async () => {
  const adding = deferred();
  const removing = deferred();
  const { store } = setup({
    addAttachments: () => adding.promise,
    removeAttachment: () => removing.promise,
  });
  store.setState({ selectedId: "a", detail: { item: { id: "a" }, attachments: [] } });
  const add = store.getState().addAttachments("a", ["file"]);
  store.setState({ selectedId: "b", detail: { item: { id: "b" }, attachments: [] } });
  adding.resolve({ item: { id: "a" }, attachments: [{ id: "file" }] });
  await add;
  assert.equal(store.getState().detail.item.id, "b");

  const remove = store.getState().removeAttachment("a", "file");
  removing.resolve({ item: { id: "a" }, attachments: [] });
  await remove;
  assert.equal(store.getState().detail.item.id, "b");
});

test("attachment responses cannot restore locked detail", async () => {
  const adding = deferred();
  const { store } = setup({
    addAttachments: () => adding.promise,
    getLockSession: async () => ({ unlocked: false, remainingMs: 0 }),
  });
  store.setState({
    selectedId: "private",
    detail: { item: { id: "private" }, attachments: [] },
    items: [{ id: "private", effectiveLocked: true }],
    lockSession: { unlocked: true, remainingMs: 1000 },
  });
  const pending = store.getState().addAttachments("private", ["file"]);
  await store.getState().syncLockSession();
  adding.resolve({ item: { id: "private", effectiveLocked: true }, attachments: [] });
  await pending;
  assert.equal(store.getState().detail, null);
});

test("delete waits for completion, blocks duplicate calls and preserves selection on failure", async () => {
  let reject;
  let calls = 0;
  const { store, notices } = setup({ deleteItems: () => {
    calls++;
    return new Promise((_, fail) => { reject = fail; });
  } });
  store.setState({ multiIds: ["a", "b"], selectedId: "a" });
  const pending = store.getState().deleteItems(["a", "b"]);
  await tick();
  assert.equal(await store.getState().deleteItems(["a", "b"]), false);
  assert.equal(calls, 1);
  assert.equal(notices.length, 0);
  reject(new Error("磁盘错误"));
  assert.equal(await pending, false);
  assert.deepEqual(idsOf(store.getState().multiIds), ["a", "b"]);
  assert.equal(store.getState().selectedId, "a");
  assert.match(notices[0].message, /删除失败.*磁盘错误/);
  assert.equal(store.getState().operationBusy, false);
});

test("separate deletion notices undo only each operation's actual deleted IDs", async () => {
  const restored = [];
  const { store, notices } = setup({
    deleteItems: async (ids) => ids.filter((id) => id !== "already-trashed"),
    restoreItems: async (ids) => { restored.push(idsOf(ids)); },
  });
  await store.getState().deleteItems(["a", "already-trashed"]);
  await store.getState().deleteItems(["b", "c"]);
  const undo = notices.filter((notice) => notice.options?.action?.label === "撤销");
  assert.equal(undo.length, 2);
  assert.equal(undo[0].options.duration, 10000);
  undo[1].options.action.onClick();
  await tick();
  undo[0].options.action.onClick();
  await tick();
  assert.deepEqual(restored, [["b", "c"], ["a"]]);
});

test("committed deletion with failed refresh is successful and only retry-refresh is offered", async () => {
  let calls = 0;
  const { store, notices } = setup({
    deleteItems: async (ids) => { calls++; return ids; },
    listItems: async () => { throw new Error("读取失败"); },
  });
  assert.equal(await store.getState().deleteItems(["a"]), true);
  const warning = notices.find((notice) => notice.kind === "warning");
  assert.match(warning.message, /操作已成功.*列表刷新失败/);
  warning.options.action.onClick();
  await tick();
  assert.equal(calls, 1);
  assert.equal(notices.some((notice) => notice.kind === "error"), false);
});

test("purge and empty require confirmation; empty uses backend total despite list filtering", async () => {
  let purges = 0;
  const counts = [];
  const { store, notices } = setup({
    purgeItems: async () => { purges++; },
    emptyTrash: async (count) => { counts.push(count); throw new Error("回收站数量已变化，请重新确认后清空"); },
  });
  store.setState({ query: "one file", items: [{ id: "a" }], multiIds: ["a"] });
  let pending = store.getState().purgeItems(["a"]);
  assert.equal(store.getState().destructiveConfirmation.count, 1);
  assert.equal(purges, 0);
  store.getState().destructiveConfirmation.resolve(false);
  assert.equal(await pending, false);
  assert.equal(purges, 0);
  assert.deepEqual(idsOf(store.getState().multiIds), ["a"]);
  pending = store.getState().purgeItems(["a", "b"]);
  assert.equal(store.getState().destructiveConfirmation.count, 2);
  store.getState().destructiveConfirmation.resolve(true);
  assert.equal(await pending, true);
  assert.equal(purges, 1);
  pending = store.getState().emptyTrash();
  await tick();
  assert.equal(store.getState().destructiveConfirmation.count, 501);
  assert.equal(await store.getState().emptyTrash(), false);
  store.getState().destructiveConfirmation.resolve(true);
  assert.equal(await pending, false);
  assert.deepEqual(counts, [501]);
  assert.match(notices.at(-1).message, /数量已变化/);
});

test("undo failure remains an error and does not clear selection", async () => {
  const { store, notices } = setup({ restoreItems: async () => { throw new Error("需要先解锁"); } });
  await store.getState().deleteItems(["a"]);
  store.setState({ multiIds: ["b"] });
  notices[0].options.action.onClick();
  await tick();
  assert.match(notices.at(-1).message, /恢复失败.*需要先解锁/);
  assert.deepEqual(idsOf(store.getState().multiIds), ["b"]);
});

test("batch tags add/remove idempotently, preserve other tags and retain failed selections", async () => {
  const documents = new Map([
    ["a", { id: "a", title: "A", content: "", tags: [{ id: "tag" }, { id: "other" }] }],
    ["b", { id: "b", title: "B", content: "", tags: [{ id: "other" }] }],
    ["c", { id: "c", title: "C", content: "", tags: [] }],
  ]);
  const writes = [];
  const { store, notices } = setup({
    getItem: async (id) => ({ item: documents.get(id) }),
    setItemTags: async (id, tags) => {
      writes.push([id, idsOf(tags)]);
      if (id === "c") throw new Error("只读文件");
      const item = { ...documents.get(id), tags: tags.map((id) => ({ id })) };
      documents.set(id, item);
      return item;
    },
    listItems: async () => ({ entries: Array.from(documents.values(), (item) => ({ item })), truncated: false }),
  });
  store.setState({ items: [...documents.values()], multiIds: ["a", "b", "c"] });
  assert.equal(await store.getState().updateBatchTags(["a", "b", "c"], "tag", "add"), false);
  assert.deepEqual(writes, [["b", ["other", "tag"]], ["c", ["tag"]]]);
  assert.deepEqual(idsOf(store.getState().multiIds), ["c"]);
  assert.equal(store.getState().batchTagFailures[0].title, "C");
  assert.equal(store.getState().batchTagFailures[0].reason, "Error: 只读文件");
  notices.find((notice) => notice.kind === "error").options.action.onClick();
  assert.equal(store.getState().batchTagDetailsOpen, true);
  writes.length = 0;
  assert.equal(await store.getState().updateBatchTags(["a", "b"], "tag", "add"), true);
  assert.equal(writes.length, 0);
  assert.equal(await store.getState().updateBatchTags(["a", "b", "c"], "tag", "remove"), true);
  assert.deepEqual(writes, [["a", ["other"]], ["b", ["other"]]]);
  writes.length = 0;
  await store.getState().updateBatchTags(["a", "b", "c"], "tag", "remove");
  assert.equal(writes.length, 0);
});

test("single-file tag failure is reported and pending writes cannot be submitted twice", async () => {
  let reject;
  let calls = 0;
  const { store, notices } = setup({ setItemTags: () => {
    calls++;
    return new Promise((_, fail) => { reject = fail; });
  } });
  const pending = store.getState().setItemTags("a", ["tag"]);
  assert.equal(await store.getState().setItemTags("a", []), false);
  assert.equal(await store.getState().updateBatchTags(["a"], "tag", "add"), false);
  assert.equal(notices.length, 0);
  reject(new Error("写入失败"));
  assert.equal(await pending, false);
  assert.equal(calls, 1);
  assert.match(notices[0].message, /更新标签失败.*写入失败/);
});
