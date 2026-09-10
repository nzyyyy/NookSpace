import test from "node:test";
import assert from "node:assert/strict";
import { createZoomMath, createReadingZoomSession, installReadingZoom } from "../src/features/detail/reading-zoom.ts";
import { htmlReadingScale, initializeHtmlZoom } from "../src/features/detail/html-reading-zoom.ts";

const math = createZoomMath();
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("zoom preserves document anchors and clamps only at document edges", () => {
  for (const scale of [1.1, 1.5, 2, 4]) {
    const offset = math.offset(600, 125, 1, scale, 10000);
    near(math.logical(offset + 125, scale), 725);
    near(math.offset(offset, 125, scale, 1, 10000), 600);
    near(math.logical(400, scale), 400 / scale);
  }
  assert.equal(math.offset(0, 100, 4, 1, 0), 0);
  assert.equal(math.offset(900, 100, 1, 4, 500), 500);
  assert.deepEqual([0, 1, 2, 10, NaN, Infinity].map(math.scale), [1, 1, 2, 4, 1, 1]);
  assert.equal(math.wheelAllowed(true, 0, 1000), false);
  assert.equal(math.wheelAllowed(false, 1000, 1050), false);
  assert.equal(math.wheelAllowed(false, 1000, 1200), true);
});

// A small scrolling surface lets the actual controller run without a browser dependency.
function surface(t, scrollport = false) {
  const frames = new Map();
  const observers = [];
  let nextFrame = 0;
  class Element extends EventTarget {
    style = { setProperty(name, value) { this[name] = value; } };
    dataset = {};
    classList = {
      names: new Set(),
      add(...names) { names.forEach((name) => this.names.add(name)); },
      remove(...names) { names.forEach((name) => this.names.delete(name)); },
      contains(name) { return this.names.has(name); },
    };
    clientWidth = 500;
    clientHeight = 300;
    offsetHeight = 2000;
    offsetWidth = 500;
    offsetLeft = 0;
    offsetTop = 0;
    scrollHeight = 2000;
    scrollWidth = 500;
    scrollTop = 0;
    scrollLeft = 0;
    ignored = false;
    getBoundingClientRect() { return { left: 10, top: 20, width: this.clientWidth, height: this.clientHeight }; }
    getAttribute() { return null; }
    removeAttribute() {}
    closest() { return this.ignored ? this : null; }
  }
  t.mock.method(globalThis, "requestAnimationFrame", (callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  t.mock.method(globalThis, "cancelAnimationFrame", (id) => frames.delete(id));
  t.mock.method(globalThis, "getComputedStyle", () => ({ marginLeft: "0", marginRight: "0", marginTop: "0", marginBottom: "0" }));
  const previousElement = globalThis.Element;
  const previousObserver = globalThis.ResizeObserver;
  globalThis.Element = Element;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  t.after(() => { globalThis.Element = previousElement; globalThis.ResizeObserver = previousObserver; });
  const viewport = new Element();
  viewport.style.position = "absolute";
  const content = new Element();
  const space = new Element();
  if (!scrollport) {
    Object.defineProperty(viewport, "scrollHeight", { get: () => parseFloat(space.style.height) || 2000 });
    Object.defineProperty(viewport, "scrollWidth", { get: () => Math.max(500, parseFloat(space.style.width) || 500) });
  } else {
    Object.defineProperty(content, "clientWidth", { get: () => parseFloat(content.style.width) || 500 });
    Object.defineProperty(content, "clientHeight", { get: () => parseFloat(content.style.height) || 300 });
  }
  const changes = [];
  // Serialization is also how the sandboxed HTML reader receives this function.
  const install = new Function(`return (${installReadingZoom.toString()})`)();
  const zoom = install(viewport, content, space, math, (scale) => changes.push(scale), { scrollport });
  t.after(() => zoom.destroy());
  const flush = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach((callback) => callback()); };
  const emit = (type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: 135, clientY: 145, deltaX: 0, deltaY: 0, deltaMode: 0, ...values });
    viewport.dispatchEvent(event);
    return event;
  };
  return { zoom, viewport, content, space, emit, flush, frames, changes, observers };
}

// Node has EventTarget but no layout/animation globals.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.getComputedStyle ??= () => ({});

test("controller coalesces frames, preserves anchors, deduplicates WebKit then wheel, and resets", (t) => {
  const s = surface(t);
  assert.equal(s.viewport.classList.contains("reading-zoom-overlay"), true);
  s.viewport.dispatchEvent(new Event("scroll"));
  assert.equal(s.viewport.classList.contains("is-scrolling"), true);
  assert.equal(s.viewport.style.position, "absolute", "keep the reading viewport constrained to its flex parent");
  s.viewport.scrollTop = 600;
  s.emit("gesturestart");
  s.emit("gesturechange", { scale: 1.5 });
  s.emit("gesturechange", { scale: 2 });
  s.emit("wheel", { ctrlKey: true, deltaY: -Math.log(2) * 100 });
  assert.equal(s.frames.size, 1);
  s.flush();
  assert.equal(s.zoom.getScale(), 2);
  near((s.viewport.scrollTop + 125) / 2, 725);
  assert.equal(s.space.style.height, "4000px");
  s.emit("gestureend");
  s.emit("wheel", { ctrlKey: true, deltaY: -50 });
  assert.equal(s.zoom.getScale(), 2);
  assert.equal(s.emit("wheel", { deltaY: 20 }).defaultPrevented, false, "normal scrolling stays native");
  s.zoom.reset();
  assert.equal(s.zoom.getScale(), 1);
  assert.equal(s.content.style.transform, "scale(1)");
  assert.equal(s.space.style.height, "2000px");
});

test("wheel-first duplicate gestures and nested charts do not double-zoom", (t) => {
  const s = surface(t);
  s.emit("wheel", { ctrlKey: true, deltaY: -Math.log(2) * 100 });
  s.emit("gesturestart");
  s.emit("gesturechange", { scale: 2 });
  s.flush();
  near(s.zoom.getScale(), 2);
  s.viewport.ignored = true;
  assert.equal(s.emit("wheel", { ctrlKey: true, deltaY: -100 }).defaultPrevented, false);
  near(s.zoom.getScale(), 2);
});

test("CodeMirror scrollport uses logical pixels and consumes momentum once", (t) => {
  const s = surface(t, true);
  s.content.scrollTop = 600;
  s.emit("gesturestart");
  s.emit("gesturechange", { scale: 2 });
  s.flush();
  near(s.content.scrollTop + 125 / 2, 725);
  assert.equal(s.content.style.height, "150px");
  const before = s.content.scrollTop;
  assert.equal(s.emit("wheel", { deltaY: 40 }).defaultPrevented, true);
  assert.equal(s.content.scrollTop, before + 20);
});

test("resize/content changes update bounds; disposal cancels queued work and listeners", (t) => {
  const s = surface(t);
  s.zoom.setScale(4);
  s.viewport.scrollTop = 6000;
  s.content.offsetHeight = s.content.scrollHeight = 500;
  s.observers[0].callback();
  s.flush();
  assert.equal(s.viewport.scrollTop, 1700);
  s.emit("wheel", { ctrlKey: true, deltaY: 10 });
  s.zoom.destroy();
  assert.equal(s.frames.size, 0);
  assert.equal(s.observers[0].disconnected, true);
  assert.equal(s.emit("wheel", { ctrlKey: true, deltaY: -100 }).defaultPrevented, false);
});

test("HTML zoom mounts a non-root scrollport instead of locking html to 100vh", (t) => {
  assert.equal(initializeHtmlZoom.toString().includes("100vh"), false);
  class Node {
    constructor() { this.children = []; this.style = {}; this.parent = null; }
    get firstChild() { return this.children[0] ?? null; }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        node.parent = this;
        this.children.push(node);
      }
    }
    setAttribute() {}
  }
  const html = new Node();
  const body = new Node();
  const page = new Node();
  body.append(page);
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = {
    documentElement: html,
    body,
    readyState: "complete",
    createElement: () => new Node(),
    addEventListener() {},
  };
  globalThis.window = { addEventListener() {} };
  globalThis.getComputedStyle = () => ({ position: "static" });
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.getComputedStyle = previous.getComputedStyle;
  });
  const mounts = [];
  initializeHtmlZoom((viewport, content, space) => {
    mounts.push({ viewport, content, space });
    return { reset() {}, destroy() {} };
  }, () => ({}));
  assert.equal(mounts.length, 1);
  const { viewport, content, space } = mounts[0];
  assert.notEqual(viewport, html);
  assert.equal(viewport.parent, body);
  assert.equal(space.parent, viewport);
  assert.equal(content.parent, viewport);
  assert.equal(page.parent, content);
  assert.equal(html.style.height, "100%");
  assert.equal(html.style.overflow, "hidden");
  assert.equal(html.children.length, 0);
});

test("HTML bridge rejects other frames and invalid zoom values", () => {
  const frame = {};
  const event = (scale, source = frame) => ({ source, data: { type: "nookspace-reading-scale", scale } });
  assert.equal(htmlReadingScale(event(2), frame), 2);
  for (const value of [0, 5, "2", NaN, Infinity, null]) assert.equal(htmlReadingScale(event(value), frame), null);
  assert.equal(htmlReadingScale(event(2, {}), frame), null);
  assert.equal(htmlReadingScale(event(2), null), null);
});

test("search overlays share scale, editing resets it, and another document starts at 100%", () => {
  const session = createReadingZoomSession();
  const controller = (initial) => {
    let scale = initial;
    return { getScale: () => scale, setScale: (next) => { scale = next; }, reset: () => { scale = 1; }, destroy() {} };
  };
  const table = controller(2);
  const unregisterTable = session.register(table);
  const search = controller(session.getInitialScale());
  const unregisterSearch = session.register(search);
  search.setScale(3);
  session.changed();
  assert.equal(session.getSnapshot(), 3);
  unregisterSearch();
  assert.equal(table.getScale(), 3);
  assert.equal(session.getSnapshot(), 3);
  unregisterTable();
  session.reset();
  assert.equal(session.getSnapshot(), null);
  assert.equal(session.getInitialScale(), 1);
  assert.equal(createReadingZoomSession().getInitialScale(), 1);
});
