export function createZoomMath() {
  const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, Math.max(0, maximum)));
  return {
    scale: (value: number) => Number.isFinite(value) ? Math.max(1, Math.min(4, value)) : 1,
    offset: (offset: number, anchor: number, before: number, after: number, maximum: number) =>
      clamp((offset + anchor) * after / before - anchor, maximum),
    clamp,
    logical: (pixels: number, scale: number) => pixels / scale,
    wheelAllowed: (gestureActive: boolean, endedAt: number, now: number) => !gestureActive && now - endedAt > 100,
  };
}

export interface ReadingZoom {
  getScale: () => number;
  setScale?: (scale: number) => void;
  reset: () => void;
  destroy: () => void;
}

export function createReadingZoomSession() {
  const controllers: ReadingZoom[] = [];
  const listeners = new Set<() => void>();
  let snapshot: number | null = null;
  let lastScale = 1;
  const changed = () => {
    snapshot = controllers[controllers.length - 1]?.getScale() ?? null;
    if (snapshot !== null) lastScale = snapshot;
    listeners.forEach((listener) => listener());
  };
  return {
    changed,
    getSnapshot: () => snapshot,
    getInitialScale: () => lastScale,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset: () => { lastScale = 1; controllers.forEach((controller) => controller.reset()); changed(); },
    register: (controller: ReadingZoom) => {
      controllers.push(controller);
      changed();
      return () => {
        const index = controllers.indexOf(controller);
        if (index < 0) return;
        const wasActive = index === controllers.length - 1;
        if (wasActive) lastScale = controller.getScale();
        controllers.splice(index, 1);
        if (wasActive) controllers[controllers.length - 1]?.setScale?.(lastScale);
        changed();
      };
    },
  };
}

// Keep this function self-contained: the sandboxed HTML reader runs the same controller.
export function installReadingZoom(
  viewport: HTMLElement,
  content: HTMLElement,
  space: HTMLElement,
  math: ReturnType<typeof createZoomMath>,
  onChange: (scale: number) => void,
  options: { initialScale?: number; scrollport?: boolean; contentInset?: number; onMeasure?: () => void } = {},
): ReadingZoom {
  const scrollport = Boolean(options.scrollport);
  let scale = math.scale(options.initialScale ?? 1);
  let appliedScale = 1;
  let frame = 0;
  let gestureActive = false;
  let gestureUsesWheel = false;
  let wheelAt = -Infinity;
  let gestureStartScale = 1;
  let gestureEndedAt = -Infinity;
  let pendingAnchor: { x: number; y: number } | null = null;
  let disposed = false;
  const original = [viewport, content, space].map((element) => element.getAttribute("style"));
  const scroller = scrollport ? content : viewport;
  let width = viewport.clientWidth;

  const notify = () => {
    viewport.dataset.readingScale = String(scale);
    viewport.dispatchEvent(new CustomEvent("readingzoomchange", { detail: scale }));
    options.onMeasure?.();
    onChange(scale);
  };
  const render = () => {
    frame = 0;
    if (disposed) return;
    const oldLeft = scroller.scrollLeft;
    const oldTop = scroller.scrollTop;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    width = viewport.clientWidth;
    content.style.setProperty("--reading-viewport-height", `${viewport.clientHeight}px`);
    if (scrollport) {
      // CodeMirror owns its scrolling and virtualized geometry in unscaled CSS pixels.
      content.style.width = `${width / scale}px`;
      content.style.height = `${viewport.clientHeight / scale}px`;
      space.style.minWidth = `${Math.max(0, width - (options.contentInset ?? 0))}px`;
      content.style.transform = `scale(${scale})`;
    } else {
      const style = getComputedStyle(content);
      const margins = (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      content.style.boxSizing = "border-box";
      content.style.width = `${Math.max(0, width - margins)}px`;
      content.style.transform = `scale(${scale})`;
      space.style.width = `${Math.max(width, Math.max(content.offsetWidth, content.scrollWidth) * scale + margins)}px`;
      const verticalMargins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      space.style.height = `${Math.max(content.offsetHeight, content.scrollHeight) * scale + verticalMargins}px`;
    }
    const maxX = scroller.scrollWidth - scroller.clientWidth;
    const maxY = scroller.scrollHeight - scroller.clientHeight;
    if (anchor) {
      scroller.scrollLeft = scrollport
        ? math.clamp(oldLeft + anchor.x / appliedScale - anchor.x / scale, maxX)
        : math.offset(oldLeft, anchor.x - content.offsetLeft, appliedScale, scale, maxX);
      scroller.scrollTop = scrollport
        ? math.clamp(oldTop + anchor.y / appliedScale - anchor.y / scale, maxY)
        : math.offset(oldTop, anchor.y - content.offsetTop, appliedScale, scale, maxY);
    } else {
      scroller.scrollLeft = math.clamp(oldLeft, maxX);
      scroller.scrollTop = math.clamp(oldTop, maxY);
    }
    const changed = appliedScale !== scale;
    appliedScale = scale;
    if (changed) notify();
    else options.onMeasure?.();
  };
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(render); };
  const excluded = (event: Event) => event.defaultPrevented
    || (event.target instanceof Element && Boolean(event.target.closest(".markdown-mermaid, [data-reading-zoom-ignore]")));
  const zoom = (next: number, x: number, y: number) => {
    if (!Number.isFinite(next) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const rect = viewport.getBoundingClientRect();
    // Preserve the first anchor across events coalesced into this frame.
    pendingAnchor ??= { x: math.clamp(x - rect.left, rect.width), y: math.clamp(y - rect.top, rect.height) };
    scale = math.scale(next);
    schedule();
  };
  const wheel = (event: WheelEvent) => {
    if (excluded(event)) return;
    if (event.ctrlKey) {
      event.preventDefault();
      if (math.wheelAllowed(gestureActive && !gestureUsesWheel, gestureEndedAt, performance.now())) {
        wheelAt = performance.now();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        zoom(scale * Math.exp(-event.deltaY * unit * 0.01), event.clientX, event.clientY);
      }
    } else if (scrollport && scale > 1) {
      // Use the OS momentum deltas once, with no second inertia animation.
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      scroller.scrollLeft += event.deltaX * unit / scale;
      scroller.scrollTop += event.deltaY * unit / scale;
    }
  };
  type Gesture = Event & { scale: number; clientX: number; clientY: number };
  const start = (event: Event) => {
    if (excluded(event)) return;
    event.preventDefault();
    gestureActive = true;
    gestureUsesWheel = performance.now() - wheelAt <= 100;
    gestureStartScale = scale;
  };
  const change = (event: Event) => {
    if (!gestureActive || excluded(event)) return;
    event.preventDefault();
    if (gestureUsesWheel) return;
    const gesture = event as Gesture;
    zoom(gestureStartScale * gesture.scale, gesture.clientX, gesture.clientY);
  };
  const end = (event: Event) => {
    if (!gestureActive) return;
    event.preventDefault();
    gestureActive = false;
    gestureEndedAt = performance.now();
  };

  viewport.style.overflow = scrollport ? "hidden" : "auto";
  if (getComputedStyle(viewport).position === "static") viewport.style.position = "relative";
  viewport.style.overscrollBehavior = "contain";
  viewport.style.overflowAnchor = "none";
  viewport.style.scrollBehavior = "auto";
  content.style.scrollBehavior = "auto";
  content.style.transition = "none";
  content.style.transformOrigin = "0 0";
  content.style.position = "absolute";
  content.style.top = "0";
  content.style.left = "0";
  if (!scrollport) space.style.position = "relative";
  viewport.classList.add("reading-zoom-overlay");
  const doc = viewport.ownerDocument;
  if (doc?.head && !doc.getElementById("reading-zoom-overlay")) {
    const sheet = doc.createElement("style");
    sheet.id = "reading-zoom-overlay";
    sheet.textContent = ".reading-zoom-overlay{scrollbar-width:thin;scrollbar-color:transparent transparent}"
      + ".reading-zoom-overlay.is-scrolling,.reading-zoom-overlay:hover{scrollbar-color:color-mix(in oklab,CanvasText 35%,transparent) transparent}"
      + ".reading-zoom-overlay::-webkit-scrollbar{width:9px;height:9px}"
      + ".reading-zoom-overlay::-webkit-scrollbar-track,.reading-zoom-overlay::-webkit-scrollbar-corner{background:transparent}"
      + ".reading-zoom-overlay::-webkit-scrollbar-thumb{background:transparent;border-radius:99px;border:2px solid transparent;background-clip:content-box}"
      + ".reading-zoom-overlay.is-scrolling::-webkit-scrollbar-thumb,.reading-zoom-overlay:hover::-webkit-scrollbar-thumb{background-color:color-mix(in oklab,CanvasText 32%,transparent)}";
    doc.head.append(sheet);
  }
  let hideBars = 0;
  const revealBars = () => {
    viewport.classList.add("is-scrolling");
    clearTimeout(hideBars);
    hideBars = setTimeout(() => viewport.classList.remove("is-scrolling"), 700);
  };
  viewport.addEventListener("scroll", revealBars, { passive: true });
  viewport.addEventListener("wheel", wheel, { passive: false });
  viewport.addEventListener("gesturestart", start, { passive: false });
  viewport.addEventListener("gesturechange", change, { passive: false });
  viewport.addEventListener("gestureend", end, { passive: false });
  const observer = new ResizeObserver(schedule);
  observer.observe(viewport);
  observer.observe(scrollport ? space : content);
  render();
  notify();

  return {
    getScale: () => scale,
    setScale: (next) => {
      pendingAnchor = { x: 0, y: 0 };
      scale = math.scale(next);
      if (frame) cancelAnimationFrame(frame);
      render();
    },
    reset: () => {
      pendingAnchor = { x: 0, y: 0 };
      scale = 1;
      gestureActive = false;
      if (frame) cancelAnimationFrame(frame);
      render();
    },
    destroy: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(hideBars);
      observer.disconnect();
      viewport.removeEventListener("scroll", revealBars);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("gesturestart", start);
      viewport.removeEventListener("gesturechange", change);
      viewport.removeEventListener("gestureend", end);
      viewport.classList.remove("reading-zoom-overlay", "is-scrolling");
      [viewport, content, space].forEach((element, index) => {
        if (original[index] === null) element.removeAttribute("style");
        else element.setAttribute("style", original[index]!);
      });
      delete viewport.dataset.readingScale;
    },
  };
}
