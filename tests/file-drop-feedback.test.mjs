import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createStore } from "zustand/vanilla";

const source = ts.transpileModule(readFileSync(new URL("../src/features/list/FileDropFeedback.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const success = { imported: [{}], skipped: [] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Run the actual event listener with native events, React state and time controlled.
function setup(importResult = () => Promise.resolve(success), { platform = "MacIntel", pixelRatio = 2 } = {}) {
  let handler, cleanup, feedback = null, unregisters = 0, renders = 0;
  const timers = new Map();
  const calls = [];
  const notices = [];
  const store = createStore(() => ({
    view: { kind: "collection", id: "books" },
    collections: [{ id: "books", name: "阅读" }],
    importPaths: (paths) => { calls.push({ paths, view: store.getState().view }); return importResult(); },
  }));
  const modules = {
    react: {
      useState: () => [null, (next) => { feedback = next; renders++; }],
      useEffect: (effect) => { cleanup = effect(); },
    },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({
      onDragDropEvent: (listener) => { handler = listener; return Promise.resolve(() => { unregisters++; }); },
    }) },
    "@/stores/library": { useLibrary: store },
    "lucide-react": {},
    sonner: { toast: Object.fromEntries(["success", "warning", "info", "error"].map((kind) => [kind,
      (message) => notices.push({ kind, message }),
    ])) },
  };
  const exports = {};
  const pane = {
    getBoundingClientRect: () => ({ left: 200, right: 480, top: 0, bottom: 600, width: 280, height: 600 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 48 }) }),
  };
  runInNewContext(source, {
    exports,
    require: (name) => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
    navigator: { platform },
    window: { devicePixelRatio: pixelRatio },
    setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; },
    clearTimeout: (id) => timers.delete(id),
  });
  exports.FileDropFeedback({ paneRef: { current: pane } });
  return {
    store, pane, calls, notices, timers,
    get feedback() { return feedback; },
    get renders() { return renders; },
    get unregisters() { return unregisters; },
    emit: (type, position = { x: 300, y: 100 }, paths = ["/new.txt"]) => handler({ payload: { type, position, paths } }),
    cleanup: () => cleanup(),
  };
}

test("macOS Retina logical coordinates exclude toolbar and other panes; hover, exit and cancel never import", async () => {
  const app = setup();
  await app.emit("enter");
  assert.equal(app.feedback.label, "松开加入『阅读』");
  await app.emit("over");
  assert.equal(app.renders, 1, "moving inside the same target does not render again");
  await app.emit("over", { x: 300, y: 25 });
  assert.equal(app.feedback, null);
  await app.emit("over", { x: 500, y: 100 });
  assert.equal(app.feedback, null);
  await app.emit("over");
  await app.emit("leave");
  assert.equal(app.feedback, null);
  app.store.setState({ view: { kind: "recent" } });
  await app.emit("enter");
  assert.equal(app.feedback.label, "松开导入文件库");
  assert.equal(app.calls.length, 0);
  app.cleanup();
});

test("list edges stay fixed on macOS 1x/2x and physical-coordinate Windows 1x/2x", async () => {
  for (const [platform, pixelRatio, units] of [
    ["MacIntel", 1, 1], ["MacIntel", 2, 1],
    ["Win32", 1, 1], ["Win32", 2, 2],
  ]) {
    const app = setup(undefined, { platform, pixelRatio });
    for (const type of ["enter", "over", "drop"]) {
      for (const [x, y, inside] of [
        [200, 48, true], [479, 599, true],
        [199, 100, false], [480, 100, false],
        [300, 47, false], [300, 600, false],
      ]) {
        await app.emit(type, { x: x * units, y: y * units });
        assert.equal(Boolean(app.feedback), inside, `${platform} ${pixelRatio}x ${type} at ${x},${y}`);
      }
    }
    app.cleanup();
  }
});

test("one drop imports once, retains progress on leave, then confirms for 600ms", async () => {
  let complete;
  const app = setup(() => new Promise((resolve) => { complete = resolve; }));
  await app.emit("enter");
  const pending = app.emit("drop");
  assert.equal(app.feedback.phase, "importing");
  await app.emit("leave");
  assert.equal(app.feedback.phase, "importing");
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].view.id, "books");
  complete(success);
  await pending;
  assert.equal(app.feedback.phase, "success");
  assert.equal([...app.timers.values()][0], 600);
  [...app.timers.keys()][0]();
  assert.equal(app.feedback, null);
  app.cleanup();
});

test("partial success confirms; skipped, empty and failed imports never confirm", async () => {
  for (const [result, phase, notice] of [
    [{ imported: [{}], skipped: [{ reason: "已在库中" }] }, "success", "success"],
    [{ imported: [], skipped: [{ reason: "已在库中" }] }, undefined, "warning"],
    [{ imported: [], skipped: [] }, undefined, "info"],
    [null, undefined, "error"],
  ]) {
    const app = setup(() => Promise.resolve(result));
    await app.emit("drop");
    assert.equal(app.feedback?.phase, phase);
    assert.equal(app.notices[0].kind, notice);
    app.cleanup();
  }
  const app = setup(() => Promise.reject(new Error("IPC failed")));
  await app.emit("drop");
  assert.equal(app.feedback, null);
  assert.equal(app.notices[0].kind, "error");
  app.cleanup();
});

test("old imports cannot overwrite a newer drag or a changed view", async () => {
  for (const change of [async (app) => app.emit("enter"), async (app) => app.store.setState({ view: { kind: "recent" } })]) {
    let complete;
    const app = setup(() => new Promise((resolve) => { complete = resolve; }));
    const pending = app.emit("drop");
    await change(app);
    const feedback = app.feedback;
    complete(success);
    await pending;
    assert.equal(app.feedback, feedback);
    assert.equal(app.timers.size, 0);
    app.cleanup();
  }
});

test("outside-list imports keep existing routing, hidden panes and empty drops have no overlay", async () => {
  const app = setup();
  await app.emit("drop", { x: 1000, y: 200 });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].view.id, "books");
  assert.equal(app.feedback, null);
  await app.emit("drop", undefined, []);
  assert.equal(app.calls.length, 1);
  app.pane.getBoundingClientRect = () => ({ width: 0, height: 0 });
  await app.emit("enter");
  assert.equal(app.feedback, null);
  app.cleanup();
});

test("unmount releases late listeners and ignores pending imports and queued events", async () => {
  let complete;
  const app = setup(() => new Promise((resolve) => { complete = resolve; }));
  const pending = app.emit("drop");
  app.cleanup();
  complete(success);
  await pending;
  await tick();
  await app.emit("drop");
  assert.equal(app.unregisters, 1);
  assert.equal(app.calls.length, 1);
  assert.equal(app.notices.length, 0);
  assert.equal(app.timers.size, 0);
});
